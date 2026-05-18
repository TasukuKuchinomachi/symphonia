"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { UITask } from "./KanbanBoard";
import type { GrainStatus, TaskStatus } from "@/lib/types";

interface LogLine {
  runId: string;
  ts: string;
  channel: string;
  payload: string;
}

interface Snapshot {
  status: TaskStatus;
  retryCount: number;
  prUrl: string | null;
  reviewNotes: string | null;
  grains: Array<{
    id: string;
    ordinal: number;
    title: string;
    status: GrainStatus;
    attempts: number;
    lastError: string | null;
    commitSha: string | null;
    dependsOn: string[];
  }>;
}

export default function TaskDetailDrawer({
  taskId,
  initialTask,
  onClose,
}: {
  taskId: string;
  initialTask: UITask;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.addEventListener("snapshot", (e) => {
      try {
        setSnap(JSON.parse((e as MessageEvent).data));
      } catch {}
    });
    es.addEventListener("log", (e) => {
      try {
        const l = JSON.parse((e as MessageEvent).data) as LogLine;
        setLogs((prev) => [...prev.slice(-499), l]);
      } catch {}
    });
    es.addEventListener("error", () => {
      // browser will auto-reconnect; if the page is closing we'll be GC'd
    });
    return () => es.close();
  }, [taskId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.length]);

  const status = snap?.status ?? initialTask.status;
  const grains = snap?.grains ?? initialTask.grains;
  const retryCount = snap?.retryCount ?? initialTask.retryCount;
  const prUrl = snap?.prUrl ?? initialTask.prUrl;
  const reviewNotes = snap?.reviewNotes ?? initialTask.reviewNotes;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto bg-ink-900 shadow-2xl border-l border-ink-700"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-ink-700 bg-ink-900/95 px-5 py-3 backdrop-blur">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-400">{status}</div>
            <h2 className="text-base font-semibold">{initialTask.title}</h2>
            {prUrl && (
              <a href={prUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-emerald-400 hover:underline">
                {prUrl}
              </a>
            )}
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-700">
            close
          </button>
        </header>

        <section className="space-y-4 px-5 py-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-300">Description</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{initialTask.description}</p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-300">Grains</h3>
              <span className="text-xs text-ink-400">
                retry {retryCount}/{initialTask.maxRetries}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {grains.length === 0 && <li className="text-xs text-ink-400">No grains yet. Run Plan to generate.</li>}
              {grains.map((g) => (
                <li
                  key={g.id}
                  className="flex items-start gap-3 rounded border border-ink-700 bg-ink-800 px-3 py-2 text-xs"
                >
                  <span className="w-6 text-right font-mono text-ink-400">{g.ordinal + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          g.status === "MERGED" && "bg-emerald-900/60 text-emerald-300",
                          g.status === "RUNNING" && "bg-accent-600/40 text-accent-500",
                          g.status === "VERIFYING" && "bg-blue-900/60 text-blue-300",
                          g.status === "FAILED" && "bg-red-900/60 text-red-300",
                          g.status === "PENDING" && "bg-ink-700 text-ink-300",
                          g.status === "SKIPPED" && "bg-ink-700 text-ink-400",
                        )}
                      >
                        {g.status}
                      </span>
                      <span className="font-semibold">{g.title}</span>
                      {g.attempts > 1 && <span className="text-[10px] text-amber-400">attempt {g.attempts}</span>}
                    </div>
                    {g.lastError && (
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-red-950/40 px-2 py-1 font-mono text-[10px] text-red-300">
                        {g.lastError.slice(0, 600)}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {reviewNotes && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-300">Review notes</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-200">{reviewNotes}</p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-300">Agent log</h3>
            <div
              ref={logRef}
              className="mt-2 h-80 overflow-y-auto rounded border border-ink-700 bg-black/60 px-3 py-2 font-mono text-[11px] leading-relaxed"
            >
              {logs.length === 0 && <div className="text-ink-500">(waiting for agent output…)</div>}
              {logs.map((l, i) => {
                const pretty = prettyClaudeLine(l.payload);
                return (
                  <div key={i} className={clsx("py-0.5", l.channel === "stderr" && "text-red-400")}>
                    {pretty}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

/** Make stream-json lines from claude readable in the log pane. */
function prettyClaudeLine(payload: string): string {
  try {
    const obj = JSON.parse(payload);
    if (obj.type === "assistant" && obj.message?.content) {
      const text = obj.message.content
        .map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : ""))
        .join("");
      if (text) return `⟶ ${text}`;
    }
    if (obj.type === "user" && obj.message?.content) {
      const txt = Array.isArray(obj.message.content)
        ? obj.message.content
            .map((c: { type: string; text?: string; tool_use_id?: string }) =>
              c.type === "text" ? c.text : c.type === "tool_result" ? "(tool result)" : "",
            )
            .join("")
        : String(obj.message.content);
      if (txt) return `⟵ ${txt.slice(0, 200)}`;
    }
    if (obj.type === "tool_use" || (obj.type === "assistant" && obj.message?.stop_reason === "tool_use")) {
      return `[tool] ${JSON.stringify(obj).slice(0, 160)}`;
    }
    if (obj.type === "system") return `[system] ${obj.subtype ?? ""}`.trim();
    if (obj.type === "result") return `[done] exit=${obj.is_error ? "err" : "ok"}`;
    return payload.slice(0, 240);
  } catch {
    return payload.slice(0, 240);
  }
}
