import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "./exec";

const RUN = (cwd: string) => async (...args: string[]) => {
  const r = await exec("git", args, { cwd });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (cwd=${cwd}):\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
};

export async function cloneRepo(githubRepo: string, dest: string, defaultBranch: string) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const r = await exec("gh", ["repo", "clone", githubRepo, dest, "--", "--branch", defaultBranch]);
  if (r.exitCode !== 0) {
    // gh may fail if branch arg unsupported; fall back to git clone
    const r2 = await exec("git", ["clone", `https://github.com/${githubRepo}.git`, dest]);
    if (r2.exitCode !== 0) {
      throw new Error(`clone ${githubRepo} failed:\n${r.stderr}\n${r2.stderr}`);
    }
  }
  const git = RUN(dest);
  await git("fetch", "origin");
  await git("checkout", defaultBranch).catch(() => {});
}

export async function ensureTaskBranch(repoPath: string, defaultBranch: string, branch: string) {
  const git = RUN(repoPath);
  await git("fetch", "origin", defaultBranch);
  await git("checkout", defaultBranch);
  await git("pull", "--ff-only", "origin", defaultBranch).catch(() => {});
  // create branch if missing
  const r = await exec("git", ["rev-parse", "--verify", branch], { cwd: repoPath });
  if (r.exitCode !== 0) {
    await git("checkout", "-b", branch);
  } else {
    await git("checkout", branch);
  }
}

export async function createWorktree(
  repoPath: string,
  branch: string,
  worktreePath: string,
  baseBranch: string,
): Promise<void> {
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  // Try existing branch first; if absent, create from baseBranch.
  const exists = await exec("git", ["rev-parse", "--verify", branch], { cwd: repoPath });
  const args =
    exists.exitCode === 0
      ? ["worktree", "add", worktreePath, branch]
      : ["worktree", "add", "-b", branch, worktreePath, baseBranch];
  const r = await exec("git", args, { cwd: repoPath });
  if (r.exitCode !== 0) {
    throw new Error(`worktree add failed: ${r.stderr || r.stdout}`);
  }
}

export async function removeWorktree(repoPath: string, worktreePath: string) {
  await exec("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoPath });
}

export async function commitAll(worktreePath: string, message: string): Promise<string | null> {
  const status = await exec("git", ["status", "--porcelain"], { cwd: worktreePath });
  if (!status.stdout.trim()) return null; // nothing to commit
  await exec("git", ["add", "-A"], { cwd: worktreePath });
  const r = await exec("git", ["commit", "-m", message], { cwd: worktreePath });
  if (r.exitCode !== 0) {
    throw new Error(`commit failed: ${r.stderr || r.stdout}`);
  }
  const sha = await exec("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
  return sha.stdout.trim();
}

export async function mergeBranchInto(repoPath: string, targetBranch: string, sourceBranch: string) {
  const git = RUN(repoPath);
  await git("checkout", targetBranch);
  const r = await exec("git", ["merge", "--no-ff", sourceBranch, "-m", `Merge ${sourceBranch}`], {
    cwd: repoPath,
  });
  if (r.exitCode !== 0) {
    // Attempt to abort on conflict so the repo isn't left half-merged.
    await exec("git", ["merge", "--abort"], { cwd: repoPath });
    throw new Error(`merge conflict on ${sourceBranch}: ${r.stderr || r.stdout}`);
  }
}

export async function pushBranch(repoPath: string, branch: string) {
  const r = await exec("git", ["push", "-u", "origin", branch], { cwd: repoPath });
  if (r.exitCode !== 0) {
    throw new Error(`push failed: ${r.stderr || r.stdout}`);
  }
}

export async function diffAgainstBase(repoPath: string, base: string, head: string): Promise<string> {
  const r = await exec("git", ["diff", `${base}...${head}`], { cwd: repoPath });
  return r.stdout;
}

export async function getRepoExists(repoPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoPath, ".git"));
    return true;
  } catch {
    return false;
  }
}
