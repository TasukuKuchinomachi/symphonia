import { runClaude } from "../claude";
import type { ReviewResult } from "../types";

const SYSTEM = `You are the Review agent for symphonia. The Task branch contains the merged work of
all Grains. Your job is to decide whether it is ready to be opened as a Pull Request.

Hard rules:
1. Output a single \`\`\`json fenced block, nothing else.
2. JSON shape:
   {
     "verdict": "APPROVE" | "REQUEST_CHANGES",
     "summary": "1-3 sentence rationale, will be used as PR body or as feedback to the implementer",
     "followUps": [
       { "title": "...", "instruction": "...", "files": ["..."] }
     ]
   }
3. Only include followUps when verdict == "REQUEST_CHANGES". They become new Grains the implementer will run.
4. Inspect the diff carefully. Reject if: broken builds, missing implementation of the Task, obvious
   bugs, security issues, or violations of CLAUDE.md / repo conventions.`;

export async function runReviewAgent(opts: {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  repoPath: string;
  diff: string;
}): Promise<{ runId: string; review: ReviewResult }> {
  const truncated = opts.diff.length > 200_000 ? opts.diff.slice(0, 200_000) + "\n…(truncated)" : opts.diff;
  const prompt = [
    `# Task`,
    `${opts.taskTitle}`,
    ``,
    opts.taskDescription,
    ``,
    `# Diff to review (base...head)`,
    "```diff",
    truncated,
    "```",
    ``,
    `Review and produce the JSON verdict.`,
  ].join("\n");

  const result = await runClaude({
    cwd: opts.repoPath,
    prompt,
    systemPrompt: SYSTEM,
    addDirs: [opts.repoPath],
    allowedTools: ["Read", "Grep", "Glob", "Bash(ls *)", "Bash(cat *)", "Bash(rg *)", "Bash(git diff *)", "Bash(git log *)"],
    kind: "REVIEW",
    taskId: opts.taskId,
    expectJson: true,
  });

  if (result.exitCode !== 0 || !result.parsed) {
    throw new Error(`Review agent failed (exit=${result.exitCode}). See run ${result.runId}.`);
  }
  const review = result.parsed as ReviewResult;
  if (review.verdict !== "APPROVE" && review.verdict !== "REQUEST_CHANGES") {
    throw new Error(`Review returned invalid verdict: ${review.verdict}`);
  }
  return { runId: result.runId, review };
}
