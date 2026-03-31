import fs from "node:fs";
import process from "node:process";
import { spawn } from "node:child_process";

import { binaryAvailable, runCommand } from "./process.mjs";

export const VALID_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function firstMeaningfulLine(text, fallback = "") {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? fallback;
}

function buildAvailableTools(kind) {
  if (kind === "rescue") {
    return [
      "bash",
      "read_bash",
      "write_bash",
      "stop_bash",
      "list_bash",
      "view",
      "edit",
      "apply_patch",
      "glob",
      "grep",
      "task",
      "read_agent",
      "list_agents",
      "report_intent"
    ];
  }

  return ["view", "glob", "grep", "report_intent"];
}

function buildAllowTools(kind) {
  if (kind === "rescue") {
    return ["read", "write", "shell"];
  }
  return [];
}

export function normalizeRequestedModel(model) {
  if (model == null) {
    return null;
  }
  const normalized = String(model).trim();
  return normalized || null;
}

export function normalizeReasoningEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error(`Unsupported reasoning effort "${effort}". Use one of: low, medium, high, xhigh.`);
  }
  return normalized;
}

export function extractSessionIdFromShare(shareFile) {
  if (!shareFile || !fs.existsSync(shareFile)) {
    return null;
  }
  const content = fs.readFileSync(shareFile, "utf8");
  const match = content.match(/Session ID:\*\* `([^`]+)`/);
  return match ? match[1] : null;
}

export function getCopilotStatus(cwd) {
  return binaryAvailable("copilot", ["--version"], { cwd });
}

export function buildCopilotArgs(job) {
  const args = [];

  if (job.resumeSessionId) {
    args.push("--resume", job.resumeSessionId);
  } else if (job.agent) {
    args.push("--agent", job.agent);
  }

  if (job.model) {
    args.push("--model", job.model);
  }
  if (job.effort) {
    args.push("--effort", job.effort);
  }

  args.push("--share", job.shareFile, "-s", "--no-ask-user", "--allow-all-paths");

  const availableTools = buildAvailableTools(job.kind);
  if (availableTools.length > 0) {
    args.push(`--available-tools=${availableTools.join(",")}`);
  }

  const allowTools = buildAllowTools(job.kind);
  if (allowTools.length > 0) {
    args.push(`--allow-tool=${allowTools.join(",")}`);
  }

  args.push("-p", job.prompt);
  return args;
}

export function runCopilotJob(job) {
  const result = runCommand("copilot", buildCopilotArgs(job), {
    cwd: job.cwd,
    env: job.env,
    stdio: "pipe"
  });

  const output = result.stdout || result.stderr || "";
  return {
    exitStatus: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output,
    sessionId: extractSessionIdFromShare(job.shareFile),
    summary: firstMeaningfulLine(output, job.title)
  };
}

export function spawnDetachedJobRunner(jobRunnerPath, jobId, cwd, env = process.env) {
  const child = spawn(process.execPath, [jobRunnerPath, jobId, "--cwd", cwd], {
    cwd,
    env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child.pid ?? null;
}
