"use server";

import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ENV } from "@/lib/env";
import { startPlan, approveAndRun } from "@/lib/worker";
import type { TaskStatus } from "@/lib/types";

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  githubRepo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/repo"),
  defaultBranch: z.string().min(1).default("main"),
});

export async function createProject(formData: FormData) {
  const data = createProjectSchema.parse({
    name: formData.get("name"),
    githubRepo: formData.get("githubRepo"),
    defaultBranch: (formData.get("defaultBranch") as string) || "main",
  });
  const localPath = path.join(ENV.workspaceDir, "repos", data.githubRepo.replace("/", "__"));
  const project = await prisma.project.create({ data: { ...data, localPath } });
  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
});

export async function createTask(formData: FormData) {
  const data = createTaskSchema.parse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    description: formData.get("description"),
  });
  await prisma.task.create({ data });
  revalidatePath(`/projects/${data.projectId}`);
}

export async function moveTask(taskId: string, status: TaskStatus) {
  await prisma.task.update({ where: { id: taskId }, data: { status } });
  const t = await prisma.task.findUnique({ where: { id: taskId } });
  if (t) revalidatePath(`/projects/${t.projectId}`);
}

export async function triggerPlan(taskId: string) {
  await startPlan(taskId);
  const t = await prisma.task.findUnique({ where: { id: taskId } });
  if (t) revalidatePath(`/projects/${t.projectId}`);
}

export async function approveTask(taskId: string) {
  await approveAndRun(taskId);
  const t = await prisma.task.findUnique({ where: { id: taskId } });
  if (t) revalidatePath(`/projects/${t.projectId}`);
}

export async function deleteTask(taskId: string) {
  const t = await prisma.task.findUnique({ where: { id: taskId } });
  await prisma.task.delete({ where: { id: taskId } });
  if (t) revalidatePath(`/projects/${t.projectId}`);
}
