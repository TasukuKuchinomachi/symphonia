import Link from "next/link";
import { prisma } from "@/lib/db";
import { createProject } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { tasks: true } } },
  });

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-ink-400">
          1 プロジェクト = 1 GitHub リポジトリ。Kanban ボード上の Task を AI エージェントが Grain に分解し、worktree で並列実装した後、レビューを経て PR にします。
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="rounded-lg border border-ink-700 bg-ink-800 p-4 transition hover:border-accent-500"
          >
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="mt-1 truncate font-mono text-xs text-ink-300">{p.githubRepo}</div>
            <div className="mt-3 text-xs text-ink-400">{p._count.tasks} tasks</div>
          </Link>
        ))}
        {projects.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-ink-600 p-6 text-sm text-ink-400">
            まだプロジェクトがありません。下のフォームから追加してください。
          </div>
        )}
      </section>

      <section className="rounded-lg border border-ink-700 bg-ink-800 p-5">
        <h2 className="text-sm font-semibold">New Project</h2>
        <form action={createProject} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-300">Name</span>
            <input
              name="name"
              required
              placeholder="symphonia"
              className="rounded border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-300">GitHub Repo (owner/repo)</span>
            <input
              name="githubRepo"
              required
              placeholder="acme/symphonia"
              className="rounded border border-ink-600 bg-ink-700 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-300">Default Branch</span>
            <input
              name="defaultBranch"
              defaultValue="main"
              className="rounded border border-ink-600 bg-ink-700 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="rounded bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600"
            >
              Create Project
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
