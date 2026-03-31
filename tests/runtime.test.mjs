import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { makeGitRepo, readLogEvents, runCompanion, setupTestEnvironment } from "./helpers.mjs";

test("setup reports ready with the fake copilot binary", () => {
  const envState = setupTestEnvironment();
  const report = JSON.parse(runCompanion(["setup", "--json"], { cwd: envState.root, env: envState.env }));
  assert.equal(report.ready, true);
  assert.match(report.copilot.detail, /1\.0\.13/);
});

test("foreground rescue forwards model and effort to the delegated agent", () => {
  const envState = setupTestEnvironment();
  const repoDir = makeGitRepo();
  const output = runCompanion(["rescue", "--model", "gpt-5.4-mini", "--effort", "high", "fix the bug"], {
    cwd: repoDir,
    env: envState.env
  });
  assert.match(output, /Rescue \(gpt-5\.4-mini, effort=high\): fix the bug/);

  const events = readLogEvents(envState.logFile);
  assert.equal(events.at(-1).agent, "subagents-rescue");
  assert.equal(events.at(-1).model, "gpt-5.4-mini");
  assert.equal(events.at(-1).effort, "high");
});

test("review uses the dedicated review agent", () => {
  const envState = setupTestEnvironment();
  const repoDir = makeGitRepo({ "src/app.js": "console.log('hello');\n" });
  fs.appendFileSync(path.join(repoDir, "src/app.js"), "console.log('dirty');\n", "utf8");
  const output = runCompanion(["review", "--model", "gpt-5.4-mini"], { cwd: repoDir, env: envState.env });
  assert.match(output, /Review \(gpt-5\.4-mini\): You are performing a review of local repository changes\./);

  const events = readLogEvents(envState.logFile);
  assert.equal(events.at(-1).agent, "subagents-review");
});

test("background rescue can be waited on and its stored result can be fetched", async () => {
  const envState = setupTestEnvironment();
  const repoDir = makeGitRepo();
  const startOutput = runCompanion(["rescue", "--background", "investigate the regression"], {
    cwd: repoDir,
    env: envState.env
  });
  const match = startOutput.match(/Job: (\S+)/);
  assert.ok(match, startOutput);
  const jobId = match[1];

  const waited = JSON.parse(runCompanion(["status", jobId, "--wait", "--json"], { cwd: repoDir, env: envState.env }));
  assert.equal(waited.job.status, "completed");

  const result = runCompanion(["result", jobId], { cwd: repoDir, env: envState.env });
  assert.match(result, /Rescue \(default\): investigate the regression/);
});

test("resume reuses the latest rescue session id", () => {
  const envState = setupTestEnvironment();
  const repoDir = makeGitRepo();
  runCompanion(["rescue", "create the first patch"], { cwd: repoDir, env: envState.env });
  const resumed = runCompanion(["rescue", "--resume", "apply the follow-up fix"], {
    cwd: repoDir,
    env: envState.env
  });
  assert.match(resumed, /Resumed session-/);
  assert.match(resumed, /apply the follow-up fix/);
});

test("cancel marks a long-running background rescue as cancelled", async () => {
  const envState = setupTestEnvironment();
  envState.env.FAKE_COPILOT_DELAY_MS = "3000";
  const repoDir = makeGitRepo();
  const startOutput = runCompanion(["rescue", "--background", "investigate the slow job"], {
    cwd: repoDir,
    env: envState.env
  });
  const match = startOutput.match(/Job: (\S+)/);
  assert.ok(match, startOutput);
  const jobId = match[1];

  await new Promise((resolve) => setTimeout(resolve, 200));
  const cancelOutput = runCompanion(["cancel", jobId], { cwd: repoDir, env: envState.env });
  assert.match(cancelOutput, new RegExp(`Cancelled rescue job ${jobId}`));

  const status = JSON.parse(runCompanion(["status", jobId, "--json"], { cwd: repoDir, env: envState.env }));
  assert.equal(status.status, "cancelled");
});
