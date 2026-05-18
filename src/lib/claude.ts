import { spawn } from "node:child_process";
import readline from "node:readline";
import { prisma } from "./db";
import { ENV } from "./env";
import type { AgentKind } from "./types";

export interface ClaudeRunOptions {
  cwd: string;
  prompt: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  addDirs?: string[];
  kind: AgentKind;
  taskId?: string;
  grainId?: string;
  /** when set, captured assistant text is parsed as JSON of this shape */
  expectJson?: boolean;
}

export interface ClaudeRunResult {
  runId: string;
  exitCode: number;
  assistantText: string;
  parsed?: unknown;
}

/**
 * Spawns `claude -p` in stream-json mode, persists every line as a LogEvent,
 * accumulates assistant text, and returns the final result.
 *
 * --bare disables auto memory / hooks / CLAUDE.md auto discovery so the agent
 * starts from a clean slate. We feed it our own system prompt and an explicit
 * --allowed-tools allowlist.
 */
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const run = await prisma.agentRun.create({
    data: {
      kind: opts.kind,
      status: "RUNNING",
      taskId: opts.taskId,
      grainId: opts.grainId,
    },
  });

  const args = [
    "--print",
    "--bare",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
  ];

  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  if (opts.appendSystemPrompt) {
    args.push("--append-system-prompt", opts.appendSystemPrompt);
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push("--allowed-tools", opts.allowedTools.join(" "));
  }
  if (opts.addDirs && opts.addDirs.length > 0) {
    args.push("--add-dir", ...opts.addDirs);
  }

  args.push(opts.prompt);

  const child = spawn(ENV.claudeBin, args, {
    cwd: opts.cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let assistantText = "";
  const logBuffer: Array<{ channel: string; payload: string }> = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = async () => {
    if (logBuffer.length === 0) return;
    const batch = logBuffer.splice(0);
    await prisma.logEvent.createMany({
      data: batch.map((b) => ({ runId: run.id, channel: b.channel, payload: b.payload })),
    });
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      await flush().catch(() => {});
    }, 200);
  };

  const handleStdoutLine = (line: string) => {
    if (!line.trim()) return;
    logBuffer.push({ channel: "stdout", payload: line });
    scheduleFlush();
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant" && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === "text" && typeof block.text === "string") {
            assistantText += block.text;
          }
        }
      }
    } catch {
      // non-JSON line; keep raw
    }
  };

  const stdoutRl = readline.createInterface({ input: child.stdout! });
  stdoutRl.on("line", handleStdoutLine);

  const stderrRl = readline.createInterface({ input: child.stderr! });
  stderrRl.on("line", (line) => {
    logBuffer.push({ channel: "stderr", payload: line });
    scheduleFlush();
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  if (flushTimer) clearTimeout(flushTimer);
  await flush().catch(() => {});

  let parsed: unknown | undefined;
  if (opts.expectJson) {
    parsed = extractJson(assistantText);
  }

  const status = exitCode === 0 ? "SUCCESS" : "FAILED";
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status,
      exitCode,
      finishedAt: new Date(),
      summary: assistantText.slice(0, 4000),
    },
  });

  return { runId: run.id, exitCode, assistantText, parsed };
}

/** Pull the first ```json fenced block out of an assistant message, or fall back to the whole text. */
export function extractJson(text: string): unknown | undefined {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
