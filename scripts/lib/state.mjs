import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const MAX_JOBS = 100;
export const PLUGIN_NAME = "subagents";

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      reviewGate: false
    },
    jobs: []
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function getCopilotHome() {
  return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}

export function resolvePluginDataRoot() {
  return path.join(getCopilotHome(), "plugins", PLUGIN_NAME);
}

function slugifyWorkspace(workspaceRoot) {
  const slugSource = path.basename(workspaceRoot) || "workspace";
  return slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let realWorkspaceRoot = workspaceRoot;
  try {
    realWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    realWorkspaceRoot = workspaceRoot;
  }
  const hash = createHash("sha256").update(realWorkspaceRoot).digest("hex").slice(0, 16);
  return path.join(resolvePluginDataRoot(), "workspaces", `${slugifyWorkspace(workspaceRoot)}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), "jobs");
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
    .slice(0, MAX_JOBS);
}

export function saveState(cwd, state) {
  ensureStateDir(cwd);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...(state.config ?? {})
    },
    jobs: pruneJobs(state.jobs ?? [])
  };
  fs.writeFileSync(resolveStateFile(cwd), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

export function updateState(cwd, mutator) {
  const state = loadState(cwd);
  mutator(state);
  return saveState(cwd, state);
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const index = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (index === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[index] = {
      ...state.jobs[index],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobOutputFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.out.txt`);
}

export function resolveJobShareFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.share.md`);
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const filePath = resolveJobFile(cwd, jobId);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export function readJobFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readJob(cwd, jobId) {
  const filePath = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJobFile(filePath);
}
