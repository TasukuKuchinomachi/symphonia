import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "./db";
import { ENV } from "./env";
import {
  cloneRepo,
  createWorktree,
  removeWorktree,
  commitAll,
  mergeBranchInto,
  ensureTaskBranch,
  pushBranch,
  diffAgainstBase,
  getRepoExists,
} from "./git";
import { createPullRequest } from "./gh";
import { runImplementAgent } from "./agents/implement";
import { runReviewAgent } from "./agents/review";
import { runQualityGate } from "./quality";
import { runPlanAgent, materializePlan } from "./agents/plan";
import type { GrainStatus, TaskStatus } from "./types";

/**
 * In-process orchestrator. The Next.js dev server keeps a single Node process
 * around for the lifetime of the dev/runtime session, so we can hold this
 * scheduler in module scope. Triggered via server actions; runs asynchronously
 * (fire-and-forget) and writes progress straight to SQLite. The UI polls / SSE-
 * tails to observe it.
 */

const runningTasks = new Set<string>();
const runningGrains = new Set<string>();

async function setTaskStatus(taskId: string, status: TaskStatus, patch: Record<string, unknown> = {}) {
  await prisma.task.update({ where: { id: taskId }, data: { status, ...patch } });
}
async function setGrainStatus(grainId: string, status: GrainStatus, patch: Record<string, unknown> = {}) {
  await prisma.grain.update({ where: { id: grainId }, data: { status, ...patch } });
}

async function ensureProjectClone(projectId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!(await getRepoExists(project.localPath))) {
    await cloneRepo(project.githubRepo, project.localPath, project.defaultBranch);
  }
  return project.localPath;
}

/* ─────────────────────────── Plan phase ─────────────────────────── */

export async function startPlan(taskId: string) {
  if (runningTasks.has(taskId)) return;
  runningTasks.add(taskId);
  void planTask(taskId).finally(() => runningTasks.delete(taskId));
}

async function planTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });
  await setTaskStatus(taskId, "PLANNING");
  try {
    const repoPath = await ensureProjectClone(task.projectId);
    const plan = await runPlanAgent({
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      repoPath,
    });
    await materializePlan(taskId, plan);
    await setTaskStatus(taskId, "AWAITING_APPROVAL");
  } catch (err) {
    await setTaskStatus(taskId, "FAILED", { reviewNotes: String(err) });
  }
}

/* ─────────────────────────── Approve & run ─────────────────────────── */

export async function approveAndRun(taskId: string) {
  if (runningTasks.has(taskId)) return;
  runningTasks.add(taskId);
  void executeTask(taskId).finally(() => runningTasks.delete(taskId));
}

async function executeTask(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });
  await setTaskStatus(taskId, "IN_PROGRESS");

  const repoPath = await ensureProjectClone(task.projectId);
  const taskBranch = task.branchName ?? `symphonia/task-${task.id.slice(0, 8)}`;
  if (!task.branchName) {
    await prisma.task.update({ where: { id: taskId }, data: { branchName: taskBranch } });
  }

  try {
    await ensureTaskBranch(repoPath, task.project.defaultBranch, taskBranch);
  } catch (err) {
    await setTaskStatus(taskId, "FAILED", { reviewNotes: String(err) });
    return;
  }

  // Reset any previously-failed grains for a fresh run.
  await prisma.grain.updateMany({
    where: { taskId, status: { in: ["FAILED", "RUNNING", "VERIFYING"] } },
    data: { status: "PENDING", lastError: null },
  });

  try {
    await runDagUntilDone(taskId, repoPath, taskBranch, task.project.defaultBranch);
    await reviewAndMaybePr(taskId);
  } catch (err) {
    await setTaskStatus(taskId, "FAILED", { reviewNotes: String(err) });
  }
}

async function runDagUntilDone(
  taskId: string,
  repoPath: string,
  taskBranch: string,
  baseBranch: string,
) {
  // Loop until all grains are MERGED, or one is FAILED beyond retry.
  // Parallelism is capped by ENV.maxParallel, scoped per Task.
  while (true) {
    const grains = await prisma.grain.findMany({
      where: { taskId },
      include: { dependsOn: { include: { dependsOn: true } } },
      orderBy: { ordinal: "asc" },
    });
    if (grains.length === 0) return;

    if (grains.every((g) => g.status === "MERGED" || g.status === "SKIPPED")) return;
    if (grains.some((g) => g.status === "FAILED")) {
      throw new Error(`Grain failed: ${grains.find((g) => g.status === "FAILED")?.title}`);
    }

    const ready = grains.filter((g) => {
      if (g.status !== "PENDING") return false;
      return g.dependsOn.every((d) => d.dependsOn.status === "MERGED" || d.dependsOn.status === "SKIPPED");
    });

    const slots = Math.max(0, ENV.maxParallel - runningGrains.size);
    const toLaunch = ready.slice(0, slots);

    if (toLaunch.length === 0 && runningGrains.size === 0) {
      // Nothing running and nothing ready — dependency cycle or all done.
      const stuck = grains.filter((g) => g.status === "PENDING");
      if (stuck.length === 0) return;
      throw new Error(`Grain DAG stuck: ${stuck.map((s) => s.title).join(", ")}`);
    }

    await Promise.all(
      toLaunch.map((g) => {
        runningGrains.add(g.id);
        return runGrain(g.id, repoPath, taskBranch, baseBranch).finally(() =>
          runningGrains.delete(g.id),
        );
      }),
    );
    // After this batch, loop back to re-evaluate. (Sequential merge happens inside runGrain.)
    // Tiny breath to let DB writes settle.
    await new Promise((r) => setTimeout(r, 50));
  }
}

const taskMergeMutex = new Map<string, Promise<void>>();
async function withTaskLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskMergeMutex.get(taskId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((res) => (release = res));
  taskMergeMutex.set(taskId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (taskMergeMutex.get(taskId) === next) taskMergeMutex.delete(taskId);
  }
}

async function runGrain(grainId: string, repoPath: string, taskBranch: string, baseBranch: string) {
  const grain = await prisma.grain.findUniqueOrThrow({
    where: { id: grainId },
    include: { task: true },
  });
  await setGrainStatus(grainId, "RUNNING", { attempts: { increment: 1 } });

  const grainBranch = `${taskBranch}/grain-${grain.id.slice(0, 6)}`;
  const worktreePath = path.join(ENV.workspaceDir, "worktrees", grainId);
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });

  let succeeded = false;
  try {
    await createWorktree(repoPath, grainBranch, worktreePath, taskBranch);
    await prisma.grain.update({
      where: { id: grainId },
      data: { worktreePath, branchName: grainBranch },
    });

    const files = safeJsonArray(grain.filesHint);
    const result = await runImplementAgent({
      grainId,
      taskId: grain.taskId,
      taskTitle: grain.task.title,
      taskDescription: grain.task.description,
      grainTitle: grain.title,
      instruction: grain.instruction,
      files,
      worktreePath,
    });

    if (result.exitCode !== 0 || result.assistantText.includes("BLOCKED:")) {
      throw new Error(result.assistantText.slice(0, 1000) || "implement agent failed");
    }

    await setGrainStatus(grainId, "VERIFYING");
    const qc = await runQualityGate(worktreePath);
    if (!qc.ok) {
      throw new Error(`quality gate failed:\n${qc.output.slice(-2000)}`);
    }

    const sha = await commitAll(worktreePath, `[${grain.title}] symphonia grain ${grain.id.slice(0, 6)}`);
    await prisma.grain.update({ where: { id: grainId }, data: { commitSha: sha } });

    await withTaskLock(grain.taskId, async () => {
      await mergeBranchInto(repoPath, taskBranch, grainBranch);
    });

    await setGrainStatus(grainId, "MERGED");
    succeeded = true;
  } catch (err) {
    await setGrainStatus(grainId, "FAILED", { lastError: String(err) });
  } finally {
    try {
      await removeWorktree(repoPath, worktreePath);
    } catch {}
    if (!succeeded) {
      // surface failure; outer loop will detect FAILED grain and stop
    }
  }
}

function safeJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/* ─────────────────────────── Review & PR ─────────────────────────── */

async function reviewAndMaybePr(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });
  await setTaskStatus(taskId, "REVIEW");

  const repoPath = task.project.localPath;
  const base = task.project.defaultBranch;
  const head = task.branchName!;
  const diff = await diffAgainstBase(repoPath, base, head);

  const { review } = await runReviewAgent({
    taskId,
    taskTitle: task.title,
    taskDescription: task.description,
    repoPath,
    diff,
  });

  if (review.verdict === "APPROVE") {
    await pushBranch(repoPath, head);
    const prUrl = await createPullRequest({
      repoPath,
      title: task.title,
      body: `${task.description}\n\n---\n_Generated by symphonia._\n\n**Review summary:** ${review.summary}`,
      base,
      head,
    });
    await setTaskStatus(taskId, "DONE", { prUrl, reviewNotes: review.summary });
    return;
  }

  // REQUEST_CHANGES — generate follow-up grains and re-run (within retry budget).
  if (task.retryCount + 1 > task.maxRetries) {
    await setTaskStatus(taskId, "FAILED", {
      reviewNotes: `Exceeded ${task.maxRetries} review retries. Last summary: ${review.summary}`,
    });
    return;
  }

  const followUps = review.followUps ?? [];
  if (followUps.length === 0) {
    await setTaskStatus(taskId, "FAILED", {
      reviewNotes: `Review requested changes but supplied no follow-up grains. Summary: ${review.summary}`,
    });
    return;
  }

  const baseOrdinal = (await prisma.grain.count({ where: { taskId } })) + 1;
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < followUps.length; i++) {
      await tx.grain.create({
        data: {
          taskId,
          ordinal: baseOrdinal + i,
          title: followUps[i].title,
          instruction: followUps[i].instruction,
          filesHint: JSON.stringify(followUps[i].files ?? []),
          status: "PENDING",
        },
      });
    }
    await tx.task.update({
      where: { id: taskId },
      data: { retryCount: { increment: 1 }, reviewNotes: review.summary, status: "IN_PROGRESS" },
    });
  });

  // Recurse: execute the newly-added grains, then re-review.
  const repoPath2 = await ensureProjectClone(task.projectId);
  await runDagUntilDone(taskId, repoPath2, head, base);
  await reviewAndMaybePr(taskId);
}
