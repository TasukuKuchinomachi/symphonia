import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE: streams new LogEvents and Task/Grain status changes for a given Task.
 * Implemented with a simple poll loop (every 500ms) — single-user / local app,
 * so we don't need an in-memory pubsub yet.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const encoder = new TextEncoder();
  let cursor: Date | null = null;
  let lastSnapshot = "";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const tick = async () => {
        // 1. push task + grain status snapshot when it changes
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            grains: {
              orderBy: { ordinal: "asc" },
              include: { dependsOn: true, runs: { orderBy: { startedAt: "desc" }, take: 1 } },
            },
            runs: { orderBy: { startedAt: "desc" }, take: 10 },
          },
        });
        if (!task) {
          controller.close();
          return false;
        }
        const snapshot = JSON.stringify({
          status: task.status,
          retryCount: task.retryCount,
          prUrl: task.prUrl,
          reviewNotes: task.reviewNotes,
          grains: task.grains.map((g) => ({
            id: g.id,
            ordinal: g.ordinal,
            title: g.title,
            status: g.status,
            attempts: g.attempts,
            lastError: g.lastError,
            commitSha: g.commitSha,
            dependsOn: g.dependsOn.map((d) => d.dependsOnId),
          })),
        });
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          send("snapshot", JSON.parse(snapshot));
        }

        // 2. push log lines newer than cursor
        const runIds = (
          await prisma.agentRun.findMany({
            where: { OR: [{ taskId }, { grain: { taskId } }] },
            select: { id: true },
            orderBy: { startedAt: "desc" },
            take: 50,
          })
        ).map((r) => r.id);
        if (runIds.length > 0) {
          const logs = await prisma.logEvent.findMany({
            where: { runId: { in: runIds }, ...(cursor ? { ts: { gt: cursor } } : {}) },
            orderBy: { ts: "asc" },
            take: 200,
          });
          if (logs.length > 0) {
            for (const l of logs) {
              send("log", { runId: l.runId, ts: l.ts, channel: l.channel, payload: l.payload });
            }
            cursor = logs[logs.length - 1].ts;
          } else if (!cursor) {
            // initialize cursor so first poll doesn't dump entire history
            cursor = new Date();
          }
        } else if (!cursor) {
          cursor = new Date();
        }
        return true;
      };

      send("hello", { taskId });
      const aborted = { current: false };
      req.signal.addEventListener("abort", () => (aborted.current = true));

      while (!aborted.current) {
        let ok = false;
        try {
          ok = await tick();
        } catch (err) {
          send("error", { message: String(err) });
        }
        if (!ok) break;
        await new Promise((r) => setTimeout(r, 600));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
