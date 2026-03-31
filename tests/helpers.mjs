import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

export const PROJECT_ROOT = "/home/gosrum/AI/copilot-cli-subagents-plugin";

export function makeTempDir(prefix = "subagents-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(baseDir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(baseDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

function installFakeCopilotBinary(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const fakeCopilotPath = path.join(binDir, "copilot");
  const script = [
    '#!/usr/bin/env node',
    'import crypto from "node:crypto";',
    'import fs from "node:fs";',
    'import path from "node:path";',
    'import process from "node:process";',
    '',
    'function sleep(ms) {',
    '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
    '}',
    '',
    'function readValue(args, index, name) {',
    '  const current = args[index];',
    '  if (current.startsWith(name + "=")) {',
    '    return { value: current.slice(name.length + 1), nextIndex: index };',
    '  }',
    '  return { value: args[index + 1] ?? null, nextIndex: index + 1 };',
    '}',
    '',
    'const args = process.argv.slice(2);',
    'const logFile = process.env.FAKE_COPILOT_LOG_FILE;',
    'const payload = {',
    '  args,',
    '  agent: null,',
    '  model: null,',
    '  effort: null,',
    '  prompt: "",',
    '  resumeSessionId: null,',
    '  shareFile: null,',
    '  sessionId: null',
    '};',
    '',
    'function appendLog(event) {',
    '  if (!logFile) {',
    '    return;',
    '  }',
    '  fs.appendFileSync(logFile, JSON.stringify(event) + "\\n", "utf8");',
    '}',
    '',
    'if (args.includes("--version")) {',
    '  console.log("GitHub Copilot CLI 1.0.13");',
    '  process.exit(0);',
    '}',
    '',
    'if (args[0] === "help" || args.includes("--help")) {',
    '  console.log("copilot help");',
    '  process.exit(0);',
    '}',
    '',
    'for (let index = 0; index < args.length; index += 1) {',
    '  const arg = args[index];',
    '  if (arg === "--agent" || arg.startsWith("--agent=")) {',
    '    const parsed = readValue(args, index, "--agent");',
    '    payload.agent = parsed.value;',
    '    index = parsed.nextIndex;',
    '    continue;',
    '  }',
    '  if (arg === "--model" || arg.startsWith("--model=")) {',
    '    const parsed = readValue(args, index, "--model");',
    '    payload.model = parsed.value;',
    '    index = parsed.nextIndex;',
    '    continue;',
    '  }',
    '  if (arg === "--effort" || arg.startsWith("--effort=") || arg === "--reasoning-effort" || arg.startsWith("--reasoning-effort=")) {',
    '    const name = arg.startsWith("--reasoning-effort") ? "--reasoning-effort" : "--effort";',
    '    const parsed = readValue(args, index, name);',
    '    payload.effort = parsed.value;',
    '    index = parsed.nextIndex;',
    '    continue;',
    '  }',
    '  if (arg === "--resume" || arg.startsWith("--resume=")) {',
    '    const parsed = readValue(args, index, "--resume");',
    '    payload.resumeSessionId = parsed.value;',
    '    index = parsed.nextIndex;',
    '    continue;',
    '  }',
    '  if (arg === "--share" || arg.startsWith("--share=")) {',
    '    const parsed = readValue(args, index, "--share");',
    '    payload.shareFile = parsed.value;',
    '    index = parsed.nextIndex;',
    '    continue;',
    '  }',
    '  if (arg === "-p") {',
    '    payload.prompt = args[index + 1] ?? "";',
    '    index += 1;',
    '  }',
    '}',
    '',
    'const delayMs = Number(process.env.FAKE_COPILOT_DELAY_MS || 0);',
    'if (delayMs > 0) {',
    '  sleep(delayMs);',
    '}',
    '',
    'const sessionId = payload.resumeSessionId || process.env.FAKE_COPILOT_SESSION_ID || ("session-" + crypto.randomUUID());',
    'payload.sessionId = sessionId;',
    'appendLog(payload);',
    '',
    'if (payload.shareFile) {',
    '  fs.mkdirSync(path.dirname(payload.shareFile), { recursive: true });',
    '  fs.writeFileSync(payload.shareFile, "# 🤖 Copilot CLI Session\\n\\n> [!NOTE]\\n> - **Session ID:** `" + sessionId + "`\\n", "utf8");',
    '}',
    '',
    'if (process.env.FAKE_COPILOT_FAIL === "1" || /FAIL_JOB/.test(payload.prompt)) {',
    '  process.stderr.write("fake copilot failure\\n");',
    '  process.exit(2);',
    '}',
    '',
    'let output;',
    'if (payload.resumeSessionId) {',
    '  output = "Resumed " + payload.resumeSessionId + " (" + (payload.model ?? "default") + (payload.effort ? ", effort=" + payload.effort : "") + "): " + payload.prompt;',
    '} else if (payload.agent === "subagents-review") {',
    '  output = "Review (" + (payload.model ?? "default") + "): " + payload.prompt.split(/\\r?\\n/)[0];',
    '} else if (payload.agent === "subagents-adversarial-review") {',
    '  output = "Adversarial review (" + (payload.model ?? "default") + "): " + payload.prompt.split(/\\r?\\n/)[0];',
    '} else if (payload.agent === "subagents-rescue") {',
    '  output = "Rescue (" + (payload.model ?? "default") + (payload.effort ? ", effort=" + payload.effort : "") + "): " + payload.prompt;',
    '} else {',
    '  output = "Copilot (" + (payload.agent ?? "default") + "): " + payload.prompt;',
    '}',
    '',
    'process.stdout.write(output.endsWith("\\n") ? output : output + "\\n");',
    ''
  ].join("\n");
  fs.writeFileSync(fakeCopilotPath, script, { mode: 0o755 });
}

export function setupTestEnvironment() {
  const root = makeTempDir();
  const binDir = path.join(root, "bin");
  installFakeCopilotBinary(binDir);
  const copilotHome = path.join(root, "copilot-home");
  fs.mkdirSync(copilotHome, { recursive: true });
  const logFile = path.join(root, "fake-copilot-log.jsonl");
  return {
    root,
    binDir,
    copilotHome,
    logFile,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      COPILOT_HOME: copilotHome,
      FAKE_COPILOT_LOG_FILE: logFile
    }
  };
}

export function runCompanion(args, { cwd = PROJECT_ROOT, env = process.env } = {}) {
  return execFileSync(process.execPath, [path.join(PROJECT_ROOT, "scripts", "copilot-companion.mjs"), ...args], {
    cwd,
    env,
    encoding: "utf8"
  });
}

export function makeGitRepo(files = { "README.md": "# temp repo\n" }) {
  const repoDir = makeTempDir("subagents-repo-");
  writeFiles(repoDir, files);
  execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "ignore" });
  return repoDir;
}

export function readLogEvents(logFile) {
  if (!fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
