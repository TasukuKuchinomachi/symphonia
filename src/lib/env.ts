import path from "node:path";
import os from "node:os";

export const ENV = {
  workspaceDir:
    process.env.SYMPHONIA_WORKSPACE_DIR ||
    path.join(os.homedir(), "workspace", ".symphonia-workspaces"),
  claudeBin: process.env.CLAUDE_BIN || "claude",
  maxParallel: Number.parseInt(process.env.SYMPHONIA_MAX_PARALLEL || "3", 10),
};
