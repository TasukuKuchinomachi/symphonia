import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import KanbanBoard from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      tasks: {
        orderBy: { updatedAt: "desc" },
        include: {
          grains: { orderBy: { ordinal: "asc" }, include: { dependsOn: true } },
        },
      },
    },
  });
  if (!project) return notFound();

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <div className="font-mono text-xs text-ink-300">
            {project.githubRepo} · base <span className="text-ink-100">{project.defaultBranch}</span>
          </div>
        </div>
        <div className="text-xs text-ink-400">local clone: {project.localPath}</div>
      </header>

      <KanbanBoard
        projectId={project.id}
        defaultBranch={project.defaultBranch}
        tasks={project.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status as never,
          retryCount: t.retryCount,
          maxRetries: t.maxRetries,
          prUrl: t.prUrl,
          reviewNotes: t.reviewNotes,
          branchName: t.branchName,
          grains: t.grains.map((g) => ({
            id: g.id,
            ordinal: g.ordinal,
            title: g.title,
            status: g.status as never,
            attempts: g.attempts,
            lastError: g.lastError,
            dependsOn: g.dependsOn.map((d) => d.dependsOnId),
          })),
        }))}
      />
    </div>
  );
}
