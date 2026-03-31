# Subagents plugin for GitHub Copilot CLI

`subagents` is a GitHub Copilot CLI plugin that adds a Codex-style slash-command surface for delegating work to model-selectable subagents.

The plugin keeps the UX close to the reference `codex-plugin-cc` repository, but it is implemented natively for GitHub Copilot CLI plugins:

- `/subagents:review`
- `/subagents:adversarial-review`
- `/subagents:rescue`
- `/subagents:status`
- `/subagents:result`
- `/subagents:cancel`
- `/subagents:setup`

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
- Node.js `18.18.0` or newer
- Git

## Install

### Install from a local checkout

```bash
copilot plugin install /absolute/path/to/copilot-cli-subagents-plugin
```

### Install from GitHub

```bash
copilot plugin install OWNER/REPO
```

After installing a local checkout, reinstall the plugin after every file change so Copilot picks up the updated plugin contents.

## Usage

### Setup

```text
/subagents:setup
```

This checks whether `node`, `git`, and `copilot` are available, and shows the plugin's state directory.

### Review the current work

```text
/subagents:review
/subagents:review --background
/subagents:review --model gpt-5.4-mini --scope working-tree
```

### Run an adversarial review

```text
/subagents:adversarial-review challenge the rollback and retry strategy
/subagents:adversarial-review --background --model gpt-5.4-mini focus on race conditions
```

### Delegate implementation or debugging work

```text
/subagents:rescue investigate why CI started failing
/subagents:rescue --model gpt-5.4-mini fix the flaky integration test
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

## Development

Run the test suite:

```bash
npm test
```

Reinstall the local plugin into Copilot CLI after changes:

```bash
copilot plugin install /absolute/path/to/copilot-cli-subagents-plugin
```
