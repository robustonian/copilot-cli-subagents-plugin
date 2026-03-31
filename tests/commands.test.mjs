import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { PROJECT_ROOT } from "./helpers.mjs";

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
}

test("plugin manifest exposes commands and agents", () => {
  const manifest = JSON.parse(read("plugin.json"));
  assert.equal(manifest.name, "subagents");
  assert.equal(manifest.commands, "commands/");
  assert.equal(manifest.agents, "agents/");
});

test("commands delegate to the companion runtime", () => {
  const commandFiles = fs.readdirSync(path.join(PROJECT_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md"
  ]);

  for (const commandFile of commandFiles) {
    const source = read(path.join("commands", commandFile));
    assert.match(source, /allowed-tools:\s*Bash/);
    assert.match(source, /copilot-companion\.mjs/);
    assert.match(source, /<raw arguments>/);
    assert.match(source, /Your only job is to run the companion script/i);
  }
});

test("custom agents stay explicitly invocable", () => {
  const agentFiles = fs.readdirSync(path.join(PROJECT_ROOT, "agents")).sort();
  assert.deepEqual(agentFiles, [
    "subagents-adversarial-review.agent.md",
    "subagents-rescue.agent.md",
    "subagents-review.agent.md"
  ]);

  const rescue = read("agents/subagents-rescue.agent.md");
  const review = read("agents/subagents-review.agent.md");
  const adversarial = read("agents/subagents-adversarial-review.agent.md");

  assert.match(rescue, /disable-model-invocation:\s*true/);
  assert.match(review, /disable-model-invocation:\s*true/);
  assert.match(adversarial, /disable-model-invocation:\s*true/);

  assert.match(rescue, /apply_patch/);
  assert.doesNotMatch(review, /apply_patch/);
  assert.doesNotMatch(adversarial, /apply_patch/);
});
