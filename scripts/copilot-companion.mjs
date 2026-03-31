#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getCopilotStatus,
  normalizeReasoningEffort,
  normalizeRequestedModel,
  runCopilotJob,
  spawnDetachedJobRunner
} from "./lib/copilot-cli.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { collectReviewContext, ensureGitRepository, estimateReviewSize, resolveReviewTarget } from "./lib/git.mjs";
import {
  renderBackgroundStart,
  renderCancelReport,
  renderResultReport,
  renderSetupReport,
  renderStatusReport
} from "./lib/render.mjs";
import {
  nowIso,
  generateJobId,
  getConfig,
  listJobs,
  readJob,
  resolveJobLogFile,
  resolveJobOutputFile,
  resolveJobShareFile,
  resolveStateDir,
  setConfig,
  upsertJob,
  writeJobFile
} from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const JOB_RUNNER = path.join(REPO_ROOT, "scripts", "job-runner.mjs");

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/copilot-companion.mjs setup [--json] [--enable-review-gate|--disable-review-gate]",
    "  node scripts/copilot-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--effort <low|medium|high|xhigh>]",
    "  node scripts/copilot-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--effort <low|medium|high|xhigh>] [focus text]",
    "  node scripts/copilot-companion.mjs rescue [--wait|--background] [--resume|--fresh] [--model <model>] [--effort <low|medium|high|xhigh>] [task text]",
    "  node scripts/copilot-companion.mjs status [job-id] [--wait] [--timeout-ms <ms>] [--all] [--json]",
    "  node scripts/copilot-companion.mjs result [job-id] [--json]",
    "  node scripts/copilot-companion.mjs cancel [job-id] [--json]"
  ].join("\n"));
}

function outputResult(value, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  process.stdout.write(String(value));
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 100) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function sortedJobs(cwd) {
  return [...listJobs(cwd)].sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")));
}

function resolveJobReference(cwd, reference, options = {}) {
  const jobs = sortedJobs(cwd);
  let candidates = jobs;
  if (options.runningOnly) {
    candidates = candidates.filter((job) => job.status === "queued" || job.status === "running");
  }
  if (options.finishedOnly) {
    candidates = candidates.filter((job) => job.status !== "queued" && job.status !== "running");
  }
  if (!reference) {
    return candidates[0] ?? null;
  }
  const exact = candidates.find((job) => job.id === reference);
  if (exact) {
    return exact;
  }
  const prefixMatches = candidates.filter((job) => job.id.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Job reference "${reference}" is ambiguous. Use a longer job id.`);
  }
  throw new Error(`No job found for "${reference}".`);
}

function readStoredJobOrThrow(cwd, jobId) {
  const job = readJob(cwd, jobId);
  if (!job) {
    throw new Error(`No job found for "${jobId}".`);
  }
  return job;
}

function buildSetupReport(cwd, actionsTaken = []) {
  const node = binaryAvailable("node", ["--version"], { cwd });
  const git = binaryAvailable("git", ["--version"], { cwd });
  const copilot = getCopilotStatus(cwd);
  const stateDir = resolveStateDir(cwd);
  const nextSteps = [];
  if (!copilot.available) {
    nextSteps.push("Install GitHub Copilot CLI and make sure `copilot` is on your PATH.");
  }
  if (copilot.available) {
    nextSteps.push("Run `/subagents:review --background` for a first background review.");
    nextSteps.push("Run `/subagents:rescue --model gpt-5.4-mini investigate the failing test` to delegate a task.");
  }

  return {
    ready: node.available && git.available && copilot.available,
    node,
    git,
    copilot,
    pluginRoot: REPO_ROOT,
    stateDir,
    actionsTaken,
    nextSteps
  };
}

function buildReviewPrompt(context) {
  return [
    "You are performing a review of local repository changes.",
    `Repository root: ${context.repoRoot}`,
    `Current branch: ${context.branch}`,
    `Target: ${context.target.label}`,
    "Rules:",
    "- Review only. Do not edit files.",
    "- Focus on correctness, regressions, reliability, security, and maintainability.",
    "- Call out concrete files and lines when possible.",
    "- If the change looks good, say so plainly.",
    "",
    context.content
  ].join("\n");
}

function buildAdversarialReviewPrompt(context, focusText) {
  return [
    "You are performing an adversarial review of local repository changes.",
    `Repository root: ${context.repoRoot}`,
    `Current branch: ${context.branch}`,
    `Target: ${context.target.label}`,
    `User focus: ${focusText || "No extra focus was provided."}`,
    "Rules:",
    "- Review only. Do not edit files.",
    "- Challenge assumptions, trade-offs, hidden risks, and safer alternatives.",
    "- Call out concrete files and lines when possible.",
    "- If the approach is sound, say so plainly.",
    "",
    context.content
  ].join("\n");
}

function buildRescuePrompt(taskText) {
  return taskText.trim();
}

function chooseReviewExecutionMode(options, estimate) {
  if (options.wait) {
    return "foreground";
  }
  if (options.background) {
    return "background";
  }
  return estimate.likelySmall ? "foreground" : "background";
}

function chooseRescueExecutionMode(taskText, options) {
  if (options.wait) {
    return "foreground";
  }
  if (options.background) {
    return "background";
  }
  const normalized = String(taskText ?? "").trim();
  if (!normalized) {
    return "foreground";
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const complex = /investigate|diagnose|refactor|rewrite|migrate|all files|multi-step|step by step|root cause|regression/i.test(normalized);
  return complex || wordCount > 18 || normalized.length > 120 ? "background" : "foreground";
}

function writeLog(logFile, message) {
  fs.writeFileSync(logFile, `[${nowIso()}] ${message}\n`, "utf8");
}

function appendLog(logFile, message) {
  fs.appendFileSync(logFile, `[${nowIso()}] ${message}\n`, "utf8");
}

function writeOutput(outputFile, output) {
  fs.writeFileSync(outputFile, output ? `${String(output).trimEnd()}\n` : "", "utf8");
}

function createJob(cwd, spec) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobId = generateJobId(spec.kind === "rescue" ? "task" : spec.kind);
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const outputFile = resolveJobOutputFile(workspaceRoot, jobId);
  const shareFile = resolveJobShareFile(workspaceRoot, jobId);
  const job = {
    id: jobId,
    kind: spec.kind,
    title: spec.title,
    agent: spec.agent,
    cwd: workspaceRoot,
    workspaceRoot,
    prompt: spec.prompt,
    rawText: spec.rawText,
    model: spec.model,
    effort: spec.effort,
    resumeSessionId: spec.resumeSessionId ?? null,
    background: spec.background,
    status: "queued",
    createdAt: nowIso(),
    logFile,
    outputFile,
    shareFile,
    summary: spec.summary ?? shorten(spec.title)
  };
  writeJobFile(workspaceRoot, jobId, job);
  upsertJob(workspaceRoot, {
    id: jobId,
    kind: spec.kind,
    title: spec.title,
    agent: spec.agent,
    model: spec.model,
    effort: spec.effort,
    background: spec.background,
    status: "queued",
    summary: job.summary,
    sessionId: null,
    cwd: workspaceRoot,
    workspaceRoot,
    logFile,
    outputFile,
    shareFile
  });
  return job;
}

function runForegroundJob(job) {
  writeLog(job.logFile, `Starting ${job.kind} job ${job.id}.`);
  const runningJob = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    pid: process.pid
  };
  writeJobFile(job.workspaceRoot, job.id, runningJob);
  upsertJob(job.workspaceRoot, {
    id: job.id,
    status: "running",
    pid: process.pid,
    startedAt: runningJob.startedAt,
    summary: runningJob.summary
  });

  const result = runCopilotJob(runningJob);
  writeOutput(runningJob.outputFile, result.output);
  const status = result.exitStatus === 0 ? "completed" : "failed";
  const finishedJob = {
    ...runningJob,
    status,
    completedAt: nowIso(),
    pid: null,
    exitStatus: result.exitStatus,
    sessionId: result.sessionId ?? null,
    summary: result.summary,
    errorMessage: status === "failed"
      ? (result.stderr.trim() || result.stdout.trim() || `copilot exited with ${result.exitStatus}`)
      : null
  };
  writeJobFile(job.workspaceRoot, job.id, finishedJob);
  upsertJob(job.workspaceRoot, {
    id: job.id,
    status,
    pid: null,
    completedAt: finishedJob.completedAt,
    exitStatus: result.exitStatus,
    sessionId: finishedJob.sessionId,
    summary: result.summary,
    errorMessage: finishedJob.errorMessage
  });
  appendLog(job.logFile, `Finished with status ${status}.`);

  if (result.exitStatus !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `copilot exited with ${result.exitStatus}`);
  }

  const output = result.output.endsWith("\n") ? result.output : `${result.output}\n`;
  return {
    job: finishedJob,
    output
  };
}

function launchBackgroundJob(job) {
  writeLog(job.logFile, `Queued ${job.kind} job ${job.id}.`);
  const runnerPid = spawnDetachedJobRunner(JOB_RUNNER, job.id, job.cwd, process.env);
  const queuedJob = {
    ...job,
    pid: runnerPid
  };
  writeJobFile(job.workspaceRoot, job.id, queuedJob);
  upsertJob(job.workspaceRoot, {
    id: job.id,
    status: "queued",
    pid: runnerPid,
    summary: job.summary
  });
  return queuedJob;
}

function latestRescueSessionId(cwd) {
  const job = sortedJobs(resolveWorkspaceRoot(cwd)).find((candidate) => candidate.kind === "rescue" && candidate.sessionId);
  return job?.sessionId ?? null;
}

function buildStatusSnapshot(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortedJobs(workspaceRoot);
  const running = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const finished = (options.all ? jobs : jobs.slice(0, 12)).filter((job) => job.status !== "queued" && job.status !== "running");
  return {
    workspaceRoot,
    running,
    finished
  };
}

async function waitForJob(cwd, reference, timeoutMs) {
  const startedAt = Date.now();
  while (true) {
    const job = reference
      ? resolveJobReference(cwd, reference)
      : (resolveJobReference(cwd, null, { runningOnly: true }) ?? resolveJobReference(cwd, null));
    if (!job) {
      return null;
    }
    if (job.status !== "queued" && job.status !== "running") {
      return job;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return job;
    }
    await sleep(500);
  }
}

function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Choose either --enable-review-gate or --disable-review-gate.");
  }
  const cwd = resolveCommandCwd(options);
  const actionsTaken = [];
  if (options["enable-review-gate"]) {
    setConfig(cwd, "reviewGate", true);
    actionsTaken.push("Enabled the review gate flag.");
  } else if (options["disable-review-gate"]) {
    setConfig(cwd, "reviewGate", false);
    actionsTaken.push("Disabled the review gate flag.");
  }
  const report = {
    ...buildSetupReport(cwd, actionsTaken),
    config: getConfig(cwd)
  };
  outputResult(options.json ? report : renderSetupReport(report), options.json);
}

function runReviewCommand(kind, argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "effort", "cwd"],
    booleanOptions: ["background", "wait"]
  });
  if (kind === "review" && positionals.length > 0) {
    throw new Error("/subagents:review does not accept extra focus text. Use /subagents:adversarial-review instead.");
  }
  const cwd = resolveCommandCwd(options);
  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const context = collectReviewContext(cwd, target);
  const estimate = estimateReviewSize(cwd, target);
  const executionMode = chooseReviewExecutionMode(options, estimate);
  const model = normalizeRequestedModel(options.model);
  const effort = normalizeReasoningEffort(options.effort);
  const focusText = positionals.join(" ").trim();
  const prompt = kind === "review"
    ? buildReviewPrompt(context)
    : buildAdversarialReviewPrompt(context, focusText);
  const title = kind === "review"
    ? `Review ${target.label}`
    : `Adversarial review ${target.label}`;
  const job = createJob(cwd, {
    kind,
    title,
    agent: kind === "review" ? "subagents-review" : "subagents-adversarial-review",
    prompt,
    rawText: focusText,
    model,
    effort,
    background: executionMode === "background",
    summary: `${title} (${estimate.summary})`
  });

  if (executionMode === "background") {
    outputResult(renderBackgroundStart(launchBackgroundJob(job)));
    return;
  }

  outputResult(runForegroundJob(job).output);
}

function handleRescue(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "effort", "cwd"],
    booleanOptions: ["background", "wait", "resume", "fresh"]
  });
  if (options.resume && options.fresh) {
    throw new Error("Choose either --resume or --fresh, not both.");
  }

  const cwd = resolveCommandCwd(options);
  const model = normalizeRequestedModel(options.model);
  const effort = normalizeReasoningEffort(options.effort);
  const taskText = positionals.join(" ").trim();
  const resumeSessionId = options.resume ? latestRescueSessionId(cwd) : null;
  if (options.resume && !resumeSessionId) {
    throw new Error("No previous rescue session was found for this workspace.");
  }
  if (!resumeSessionId && !taskText) {
    throw new Error("Provide a rescue task or use --resume.");
  }

  const executionMode = chooseRescueExecutionMode(taskText, options);
  const prompt = buildRescuePrompt(taskText || "Continue with the next concrete step.");
  const title = resumeSessionId ? "Resume rescue task" : `Rescue task: ${shorten(taskText, 72)}`;
  const job = createJob(cwd, {
    kind: "rescue",
    title,
    agent: "subagents-rescue",
    prompt,
    rawText: taskText,
    model,
    effort,
    background: executionMode === "background",
    resumeSessionId,
    summary: title
  });

  if (executionMode === "background") {
    outputResult(renderBackgroundStart(launchBackgroundJob(job)));
    return;
  }

  outputResult(runForegroundJob(job).output);
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["timeout-ms", "cwd"],
    booleanOptions: ["all", "wait", "json"]
  });
  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;

  if (options.wait) {
    const timeoutMs = options["timeout-ms"] ? Number(options["timeout-ms"]) : 240000;
    const waitedJob = await waitForJob(cwd, reference, timeoutMs);
    if (options.json) {
      outputResult({ job: waitedJob }, true);
      return;
    }
    const snapshot = {
      workspaceRoot: resolveWorkspaceRoot(cwd),
      running: waitedJob && (waitedJob.status === "queued" || waitedJob.status === "running") ? [waitedJob] : [],
      finished: waitedJob && waitedJob.status !== "queued" && waitedJob.status !== "running" ? [waitedJob] : []
    };
    outputResult(renderStatusReport(snapshot));
    return;
  }

  if (reference) {
    const resolved = resolveJobReference(cwd, reference);
    const job = readStoredJobOrThrow(cwd, resolved.id);
    if (options.json) {
      outputResult(job, true);
      return;
    }
    const snapshot = {
      workspaceRoot: resolveWorkspaceRoot(cwd),
      running: job.status === "queued" || job.status === "running" ? [job] : [],
      finished: job.status !== "queued" && job.status !== "running" ? [job] : []
    };
    outputResult(renderStatusReport(snapshot));
    return;
  }

  const snapshot = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? snapshot : renderStatusReport(snapshot), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;
  const resolved = reference
    ? resolveJobReference(cwd, reference)
    : resolveJobReference(cwd, null, { finishedOnly: true });
  const job = resolved ? readStoredJobOrThrow(cwd, resolved.id) : null;
  if (options.json) {
    outputResult({ job }, true);
    return;
  }
  outputResult(renderResultReport(job));
}

function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;
  const job = reference
    ? resolveJobReference(cwd, reference)
    : resolveJobReference(cwd, null, { runningOnly: true });
  if (!job) {
    throw new Error("No running job was found to cancel.");
  }

  const storedJob = readStoredJobOrThrow(cwd, job.id);
  if (storedJob.status !== "queued" && storedJob.status !== "running") {
    outputResult(options.json ? { job: storedJob, cancelled: false } : renderCancelReport(storedJob), options.json);
    return;
  }

  const cancelResult = terminateProcessTree(storedJob.pid);
  const cancelledJob = {
    ...storedJob,
    status: "cancelled",
    completedAt: nowIso(),
    pid: null,
    cancelDelivered: cancelResult.delivered
  };
  writeJobFile(cwd, cancelledJob.id, cancelledJob);
  upsertJob(cwd, {
    id: cancelledJob.id,
    status: "cancelled",
    completedAt: cancelledJob.completedAt,
    pid: null,
    summary: cancelledJob.summary,
    cancelDelivered: cancelResult.delivered
  });
  outputResult(options.json ? { job: cancelledJob, cancelResult } : renderCancelReport(cancelledJob, cancelResult), options.json);
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      handleSetup(rest);
      return;
    case "review":
      runReviewCommand("review", rest);
      return;
    case "adversarial-review":
      runReviewCommand("adversarial-review", rest);
      return;
    case "rescue":
      handleRescue(rest);
      return;
    case "status":
      await handleStatus(rest);
      return;
    case "result":
      handleResult(rest);
      return;
    case "cancel":
      handleCancel(rest);
      return;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
