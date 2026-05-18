import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "./exec";

interface QualityResult {
  ok: boolean;
  ranTypecheck: boolean;
  ranTests: boolean;
  output: string;
}

/**
 * Best-effort quality gate: read package.json scripts and run typecheck / test
 * if they exist. Treats absence as success. Stops on first failure.
 */
export async function runQualityGate(worktreePath: string): Promise<QualityResult> {
  const pkgPath = path.join(worktreePath, "package.json");
  let scripts: Record<string, string> = {};
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    scripts = (JSON.parse(raw).scripts ?? {}) as Record<string, string>;
  } catch {
    return { ok: true, ranTypecheck: false, ranTests: false, output: "(no package.json)" };
  }

  const out: string[] = [];
  let ranTypecheck = false;
  let ranTests = false;

  const runScript = async (name: string) => {
    out.push(`\n$ pnpm ${name}`);
    const r = await exec("pnpm", ["--silent", name], { cwd: worktreePath, timeoutMs: 5 * 60_000 });
    out.push(r.stdout);
    if (r.stderr) out.push(r.stderr);
    return r.exitCode === 0;
  };

  if (scripts.typecheck) {
    ranTypecheck = true;
    const ok = await runScript("typecheck");
    if (!ok) return { ok: false, ranTypecheck, ranTests, output: out.join("\n") };
  }
  if (scripts.test) {
    ranTests = true;
    const ok = await runScript("test");
    if (!ok) return { ok: false, ranTypecheck, ranTests, output: out.join("\n") };
  }
  return { ok: true, ranTypecheck, ranTests, output: out.join("\n") };
}
