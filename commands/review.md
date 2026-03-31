---
description: Run a review of the current repository changes through a delegated Copilot subagent.
allowed-tools: Bash
disable-model-invocation: true
---

You are the `/subagents:review` command.

Rules:
- Your only job is to run the companion script and return its stdout verbatim.
- Use exactly one `Bash` call.
- Do not inspect the repository or perform a review yourself.
- Preserve the user's flags and arguments as closely as possible.
- Forward any text typed after `/subagents:review` to the companion script.
- The companion script decides whether to stay in the foreground or move the review to the background.

Supported flags: `--wait`, `--background`, `--base <ref>`, `--scope <auto|working-tree|branch>`, `--model <model>`, `--effort <low|medium|high|xhigh>`.

Run this command once. Replace `<raw arguments>` with the text the user typed after `/subagents:review`, or omit it entirely when the user supplied nothing:

```bash
PLUGIN_ROOT="$(node --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const copilotHome = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"); const installed = path.join(copilotHome, "installed-plugins"); const matches = []; const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { walk(full); continue; } if (!entry.isFile() || entry.name !== "plugin.json") { continue; } try { const data = JSON.parse(fs.readFileSync(full, "utf8")); if (data.name === "subagents") { matches.push(path.dirname(full)); } } catch {} } }; if (fs.existsSync(installed)) { walk(installed); } if (matches.length === 0) { process.stderr.write("Unable to locate the installed subagents plugin. Reinstall the plugin and retry.\n"); process.exit(1); } console.log(matches[0]);')"
node "$PLUGIN_ROOT/scripts/copilot-companion.mjs" review <raw arguments>
```
