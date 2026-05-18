import { runClaude } from "../claude";
import { prisma } from "../db";
import type { PlanResult } from "../types";

const SYSTEM = `You are the Plan agent for "symphonia", a Kanban-driven coding orchestrator.

You are given a Task (a unit of work a human added to a Kanban board) and the repo to operate on.
Your job is to decompose the Task into Grains — the smallest reasonable units of work that another
agent will implement, each on its own git worktree. Grains will be executed in parallel where their
dependency graph allows, then merged sequentially into the Task branch.

Hard rules:
1. Output a single \`\`\`json fenced block, nothing else outside the fence.
2. JSON shape:
   {
     "grains": [
       {
         "title": "short imperative title",
         "instruction": "concrete, self-contained instruction for the implementer agent. Mention files to create/edit and acceptance criteria.",
         "files": ["paths/that/will/be/touched"],
         "dependsOn": [<indices into this grains array>]
       },
       ...
     ],
     "notes": "optional plan-wide notes"
   }
3. Grains should be 1–10 items. Each grain should be implementable by a single Claude Code session in
   one short pass (no multi-day work). Prefer parallelizable grains: if two grains touch disjoint
   files, leave their dependsOn empty.
4. Order grains so that index N can only depend on indices < N.
5. Do NOT modify the repo yourself. You may use Read / Grep / Glob to inspect it.`;

export async function runPlanAgent(opts: {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  repoPath: string;
}): Promise<PlanResult> {
  const prompt = [
    `# Task`,
    `Title: ${opts.taskTitle}`,
    ``,
    `Description:`,
    opts.taskDescription,
    ``,
    `# Repo`,
    `You may explore the repository at the working directory (${opts.repoPath}).`,
    `Now produce the JSON plan as described in the system prompt.`,
  ].join("\n");

  const result = await runClaude({
    cwd: opts.repoPath,
    prompt,
    systemPrompt: SYSTEM,
    allowedTools: ["Read", "Grep", "Glob", "Bash(ls *)", "Bash(cat *)", "Bash(rg *)", "Bash(find *)"],
    addDirs: [opts.repoPath],
    kind: "PLAN",
    taskId: opts.taskId,
    expectJson: true,
  });

  if (result.exitCode !== 0 || !result.parsed) {
    throw new Error(`Plan agent failed (exit=${result.exitCode}). See run ${result.runId}.`);
  }
  const plan = result.parsed as PlanResult;
  if (!plan.grains || !Array.isArray(plan.grains)) {
    throw new Error(`Plan agent returned invalid JSON.`);
  }
  return plan;
}

export async function materializePlan(taskId: string, plan: PlanResult) {
  await prisma.$transaction(async (tx) => {
    await tx.grainDep.deleteMany({ where: { grain: { taskId } } });
    await tx.grain.deleteMany({ where: { taskId } });

    const created = [];
    for (let i = 0; i < plan.grains.length; i++) {
      const g = plan.grains[i];
      const row = await tx.grain.create({
        data: {
          taskId,
          ordinal: i,
          title: g.title,
          instruction: g.instruction,
          filesHint: JSON.stringify(g.files ?? []),
          status: "PENDING",
        },
      });
      created.push(row);
    }
    for (let i = 0; i < plan.grains.length; i++) {
      const g = plan.grains[i];
      for (const depIdx of g.dependsOn ?? []) {
        if (depIdx < 0 || depIdx >= created.length || depIdx === i) continue;
        await tx.grainDep.create({
          data: { grainId: created[i].id, dependsOnId: created[depIdx].id },
        });
      }
    }
  });
}
