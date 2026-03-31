# Subagents plugin for GitHub Copilot CLI

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Node.js >=18.18.0](https://img.shields.io/badge/Node.js-%3E%3D18.18.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ported from openai/codex-plugin-cc](https://img.shields.io/badge/Ported%20from-openai%2Fcodex--plugin--cc-412991)](https://github.com/openai/codex-plugin-cc)

`subagents` is a GitHub Copilot CLI plugin that adds a Codex-style slash-command surface for delegating work to model-selectable subagents.

The plugin keeps the UX close to the reference `codex-plugin-cc` repository, but it is implemented natively for GitHub Copilot CLI plugins:

- `/subagents:review`
- `/subagents:adversarial-review`
- `/subagents:rescue`
- `/subagents:status`
- `/subagents:result`
- `/subagents:cancel`
- `/subagents:setup`

## Based on `openai/codex-plugin-cc`

This repository is a GitHub Copilot CLI port of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), the Apache 2.0 licensed Claude Code plugin published by OpenAI for using Codex from inside Claude Code.

The goal of this port is to preserve the same high-level review/rescue/status workflow while replacing the runtime and plugin packaging with GitHub Copilot CLI-native components. The original repository is for Claude Code plus Codex; this repository runs entirely inside GitHub Copilot CLI. Instead of relying on Claude Code's `/plugin` installation flow and a local `codex` binary, this repository uses `copilot plugin install`, `plugin.json`, `commands/`, custom Copilot agents, and a Node.js companion runtime.

## Differences from `codex-plugin-cc`

- Uses the GitHub Copilot CLI plugin system (`plugin.json`, `commands/`, and Copilot custom agents) instead of Claude Code's `/plugin` command and `.claude-plugin/` layout.
- Does not require an OpenAI account, OpenAI API credentials, or the `codex` binary.
- Exposes `--model` and `--effort` directly on delegated commands instead of depending on upstream Codex-side configuration defaults.
- Adds `--scope <auto|working-tree|branch>` for review commands, plus `--base <ref>` when you want to force a review baseline.
- Stores plugin state under `~/.copilot/plugins/subagents/`.
- Launches delegated work through nested `copilot -p ... --agent ...` sessions, managed by `scripts/copilot-companion.mjs` and `scripts/job-runner.mjs`.

## How it works

Each slash command is implemented as a Copilot CLI plugin command under `commands/`.

The commands do not perform the real work directly. Instead, they:

1. locate the installed plugin root
2. call `scripts/copilot-companion.mjs`
3. let the companion launch a nested `copilot -p ... --agent ...` session
4. store background job metadata and transcripts under `~/.copilot/plugins/subagents/`

This makes it possible to:

- choose a model per delegated task with `--model`
- set reasoning effort with `--effort`
- run long work in the background and fetch it later
- resume the latest rescue session with `--resume`

## Requirements

- GitHub Copilot CLI `1.0.13` or newer
- An active GitHub Copilot subscription. GitHub's documentation says Copilot CLI is available with all Copilot plans. If your Copilot access is managed by an organization or enterprise, the Copilot CLI policy must also be enabled there.
- Node.js `18.18.0` or newer
- Git
- No OpenAI account and no `codex` binary are required

## Install

### Install from a local checkout

```bash
copilot plugin install /absolute/path/to/copilot-cli-subagents-plugin
```

### Install from GitHub

```bash
copilot plugin install robustonian/copilot-cli-subagents-plugin
```

After installing a local checkout, reinstall the plugin after every file change so Copilot picks up the updated plugin contents.

If you installed from GitHub and want to refresh to the latest published version, rerun the same `copilot plugin install robustonian/copilot-cli-subagents-plugin` command.

## Usage

### Setup

```text
/subagents:setup
/subagents:setup --enable-review-gate
/subagents:setup --disable-review-gate
```

This checks whether `node`, `git`, and `copilot` are available, shows the plugin's state directory, and reports the current review-gate setting. The `--enable-review-gate` and `--disable-review-gate` flags update that setting and echo the action in the text output.

### Review the current work

```text
/subagents:review
/subagents:review --background
/subagents:review --model gpt-5.4 --effort xhigh --scope working-tree
```

### Run an adversarial review

```text
/subagents:adversarial-review challenge the rollback and retry strategy
/subagents:adversarial-review --background --model gpt-5.4 --effort xhigh focus on race conditions
```

### Delegate implementation or debugging work

```text
/subagents:rescue investigate why CI started failing
/subagents:rescue --model gpt-5.4 --effort xhigh fix the flaky integration test
/subagents:rescue --background refactor the retry logic safely
/subagents:rescue --resume apply the next fix from the previous run
```

### Check background jobs

```text
/subagents:status
/subagents:status task-abc123
/subagents:status task-abc123 --wait
/subagents:result task-abc123
/subagents:cancel task-abc123
```

## Flags

### Review commands

- `--wait`
- `--background`
- `--base <ref>`
- `--scope <auto|working-tree|branch>`
- `--model <model>`
- `--effort <low|medium|high|xhigh>`

### Rescue command

- `--wait`
- `--background`
- `--resume`
- `--fresh`
- `--model <model>`
- `--effort <low|medium|high|xhigh>`

## Notes

- The plugin intentionally keeps the command layer thin. Most behavior lives in `scripts/copilot-companion.mjs`.
- Background runs are executed by a detached `scripts/job-runner.mjs` process.
- The nested Copilot session is launched with a constrained tool set for reviews and a broader writable tool set for rescue tasks.
- On first use, Copilot CLI may still ask for permission before running the command-layer shell wrapper.
- Delegated work is executed through nested Copilot CLI sessions, so Copilot usage and accounting follow GitHub Copilot CLI behavior for those child sessions as well.
- See [`NOTICE`](./NOTICE) for upstream attribution and modification notice information.

## Development

Run the test suite:

```bash
npm test
```

Reinstall the local plugin into Copilot CLI after changes:

```bash
copilot plugin install /absolute/path/to/copilot-cli-subagents-plugin
```
