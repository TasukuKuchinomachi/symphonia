import { runClaude } from "../claude";

const SYSTEM = `You are the Implement agent for symphonia. You are running inside a dedicated git
worktree for a single Grain. Implement the grain end-to-end.

Hard rules:
1. Only modify files inside the current working directory. Do not commit; symphonia commits for you.
2. Follow any conventions you can read from CLAUDE.md, package.json scripts, eslint config, etc.
3. If you cannot complete the grain, write a clear final message starting with "BLOCKED:" and stop.
4. Otherwise, end with a one-line summary of what you changed.`;

export interface ImplementInput {
  grainId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  grainTitle: string;
  instruction: string;
  files: string[];
  worktreePath: string;
  retryHint?: string;
}

export async function runImplementAgent(input: ImplementInput) {
  const prompt = [
    `# Task context`,
    `${input.taskTitle}`,
    ``,
    input.taskDescription,
    ``,
    `# Grain to implement`,
    `Title: ${input.grainTitle}`,
    ``,
    `Instruction:`,
    input.instruction,
    ``,
    input.files.length > 0 ? `Likely files to touch:\n${input.files.map((f) => `- ${f}`).join("\n")}` : "",
    input.retryHint ? `\n# Retry hint from previous attempt\n${input.retryHint}` : "",
    ``,
    `Implement the grain now. Save files; do not run git commands.`,
  ]
    .filter(Boolean)
    .join("\n");

  return runClaude({
    cwd: input.worktreePath,
    prompt,
    systemPrompt: SYSTEM,
    addDirs: [input.worktreePath],
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Grep",
      "Glob",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(rg *)",
      "Bash(find *)",
      "Bash(pnpm *)",
      "Bash(npm *)",
      "Bash(node *)",
      "Bash(npx *)",
    ],
    kind: "IMPLEMENT",
    taskId: input.taskId,
    grainId: input.grainId,
  });
}
