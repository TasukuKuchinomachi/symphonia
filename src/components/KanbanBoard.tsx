"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { KANBAN_LANES, FAILED_LANE, type TaskStatus, type GrainStatus } from "@/lib/types";
import { createTask, triggerPlan, approveTask, deleteTask } from "@/app/actions";
import TaskDetailDrawer from "./TaskDetailDrawer";

export interface UITask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  retryCount: number;
  maxRetries: number;
  prUrl: string | null;
  reviewNotes: string | null;
  branchName: string | null;
  grains: UIGrain[];
}

export interface UIGrain {
  id: string;
  ordinal: number;
  title: string;
  status: GrainStatus;
  attempts: number;
  lastError: string | null;
  dependsOn: string[];
}

export default function KanbanBoard({
  projectId,
  tasks: initialTasks,
}: {
  projectId: string;
  defaultBranch: string;
  tasks: UITask[];
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [tasks] = useState(initialTasks);
  const [pending, startTransition] = useTransition();

  const groups: Record<string, UITask[]> = {};
  for (const lane of [...KANBAN_LANES, FAILED_LANE]) groups[lane.id] = [];
  for (const t of tasks) {
    (groups[t.status] ?? (groups.BACKLOG = groups.BACKLOG ?? [])).push(t);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-xs text-ink-300">
          <span>{tasks.length} tasks</span>
        </div>
        <button
          className="rounded bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600"
          onClick={() => setShowCreate((s) => !s)}
        >
          + New Task
        </button>
      </div>

      {showCreate && (
        <form
          action={async (fd) => {
            fd.set("projectId", projectId);
            await createTask(fd);
            setShowCreate(false);
          }}
          className="grid gap-2 rounded-lg border border-ink-700 bg-ink-800 p-4"
        >
          <input
            name="title"
            required
            placeholder="Task title — e.g. Add dark mode toggle"
            className="rounded border border-ink-600 bg-ink-700 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          />
          <textarea
            name="description"
            required
            rows={4}
            placeholder="What needs to happen and why. Anything an implementer should know up front."
            className="rounded border border-ink-600 bg-ink-700 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="text-xs text-ink-300">
              Cancel
            </button>
            <button className="rounded bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600">
              Add to Backlog
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[...KANBAN_LANES, FAILED_LANE].map((lane) => (
          <div key={lane.id} className="flex min-h-[60vh] flex-col rounded-lg border border-ink-700 bg-ink-800/40">
            <div className={clsx("rounded-t-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider", lane.tone)}>
              {lane.label}
              <span className="ml-2 text-ink-300">{groups[lane.id]?.length ?? 0}</span>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {(groups[lane.id] ?? []).map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  pending={pending}
                  onOpen={() => setOpenTaskId(t.id)}
                  onPlan={() => startTransition(() => void triggerPlan(t.id))}
                  onApprove={() => startTransition(() => void approveTask(t.id))}
                  onDelete={() => startTransition(() => void deleteTask(t.id))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {openTaskId && (
        <TaskDetailDrawer
          taskId={openTaskId}
          initialTask={tasks.find((t) => t.id === openTaskId)!}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  pending,
  onOpen,
  onPlan,
  onApprove,
  onDelete,
}: {
  task: UITask;
  pending: boolean;
  onOpen: () => void;
  onPlan: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const cta =
    task.status === "BACKLOG"
      ? { label: "Plan", run: onPlan }
      : task.status === "AWAITING_APPROVAL"
        ? { label: "Approve", run: onApprove }
        : null;

  return (
    <div className="group rounded border border-ink-600 bg-ink-700/80 p-2 text-xs">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="font-semibold leading-snug text-ink-100">{task.title}</div>
        <div className="mt-1 line-clamp-2 text-ink-300">{task.description}</div>
        {task.grains.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.grains.map((g) => (
              <span
                key={g.id}
                title={`${g.title} — ${g.status}`}
                className={clsx(
                  "h-1.5 w-6 rounded-full",
                  g.status === "MERGED" && "bg-emerald-500",
                  g.status === "RUNNING" && "bg-accent-500 animate-pulse",
                  g.status === "VERIFYING" && "bg-blue-500 animate-pulse",
                  g.status === "FAILED" && "bg-red-500",
                  g.status === "PENDING" && "bg-ink-500",
                  g.status === "SKIPPED" && "bg-ink-400",
                )}
              />
            ))}
          </div>
        )}
        {task.retryCount > 0 && (
          <div className="mt-1 text-[10px] text-amber-400">retry {task.retryCount}/{task.maxRetries}</div>
        )}
        {task.prUrl && (
          <a
            href={task.prUrl}
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate font-mono text-[10px] text-emerald-400 hover:underline"
          >
            {task.prUrl}
          </a>
        )}
      </button>
      <div className="mt-2 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
        {cta && (
          <button
            disabled={pending}
            onClick={cta.run}
            className="rounded bg-accent-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {cta.label}
          </button>
        )}
        <button
          disabled={pending}
          onClick={onDelete}
          className="text-[10px] text-ink-400 hover:text-red-400"
        >
          delete
        </button>
      </div>
    </div>
  );
}
