import { exec } from "./exec";

export async function createPullRequest(opts: {
  repoPath: string;
  title: string;
  body: string;
  base: string;
  head: string;
}): Promise<string> {
  const r = await exec(
    "gh",
    [
      "pr",
      "create",
      "--title",
      opts.title,
      "--body",
      opts.body,
      "--base",
      opts.base,
      "--head",
      opts.head,
    ],
    { cwd: opts.repoPath },
  );
  if (r.exitCode !== 0) {
    throw new Error(`gh pr create failed: ${r.stderr || r.stdout}`);
  }
  const url = r.stdout.trim().split("\n").find((l) => l.startsWith("https://"));
  if (!url) throw new Error(`could not parse PR url from: ${r.stdout}`);
  return url;
}
