#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import { runCopilotJob } from "./lib/copilot-cli.mjs";
import { nowIso, readJob, resolveJobLogFile, upsertJob, writeJobFile } from "./lib/state.mjs";

function appendLog(logFile, message) {
  fs.appendFileSync(logFile, `[${nowIso()}] ${message}\n`, "utf8");
}

function writeOutput(outputFile, output) {
  fs.writeFileSync(outputFile, output ? `${String(output).trimEnd()}\n` : "", "utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  const { options, positionals } = parseArgs(argv, { valueOptions: ["cwd"] });
  const [jobId] = positionals;
  if (!jobId) {
    throw new Error("Missing job id.");
  }

  const cwd = options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
  const storedJob = readJob(cwd, jobId);
  if (!storedJob) {
    throw new Error(`Unknown job id: ${jobId}`);
  }

  const logFile = storedJob.logFile || resolveJobLogFile(cwd, jobId);
  fs.writeFileSync(logFile, "", "utf8");
  appendLog(logFile, `Starting ${storedJob.kind} job ${storedJob.id}.`);

  const runningJob = {
    ...storedJob,
    status: "running",
    startedAt: nowIso(),
    pid: process.pid,
    logFile
  };
  writeJobFile(cwd, jobId, runningJob);
  upsertJob(cwd, {
    id: jobId,
    status: "running",
    startedAt: runningJob.startedAt,
    pid: process.pid,
    summary: runningJob.summary,
    sessionId: runningJob.sessionId ?? null
  });

  try {
    const result = runCopilotJob(runningJob);
    writeOutput(runningJob.outputFile, result.output);
    const finalStatus = result.exitStatus === 0 ? "completed" : "failed";
    const finishedJob = {
      ...runningJob,
      status: finalStatus,
      completedAt: nowIso(),
      exitStatus: result.exitStatus,
      pid: null,
      sessionId: result.sessionId ?? runningJob.sessionId ?? null,
      summary: result.summary,
      errorMessage: finalStatus === "failed"
        ? (result.stderr.trim() || result.stdout.trim() || `copilot exited with ${result.exitStatus}`)
        : null
    };
    writeJobFile(cwd, jobId, finishedJob);
    upsertJob(cwd, {
      id: jobId,
      status: finalStatus,
      completedAt: finishedJob.completedAt,
      exitStatus: result.exitStatus,
      pid: null,
      sessionId: finishedJob.sessionId,
      summary: result.summary,
      errorMessage: finishedJob.errorMessage
    });
    appendLog(logFile, `Finished with status ${finalStatus}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedJob = {
      ...runningJob,
      status: "failed",
      completedAt: nowIso(),
      pid: null,
      errorMessage: message
    };
    writeJobFile(cwd, jobId, failedJob);
    upsertJob(cwd, {
      id: jobId,
      status: "failed",
      completedAt: failedJob.completedAt,
      pid: null,
      errorMessage: message
    });
    appendLog(logFile, `Failed: ${message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
