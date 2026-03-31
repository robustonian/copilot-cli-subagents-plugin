---
description: Cancel a running background subagents job.
allowed-tools: Bash
disable-model-invocation: true
---

You are the `/subagents:cancel` command.

Rules:
- Your only job is to run the companion script and return its stdout verbatim.
- Use exactly one `Bash` call.
- Do not summarize, inspect files, or do follow-up work.
- Forward any text typed after `/subagents:cancel` to the companion script.

Supported flags: `[job-id]`.

Run this command once. Replace `<raw arguments>` with the text the user typed after `/subagents:cancel`, or omit it entirely when the user supplied nothing:

```bash
PLUGIN_ROOT="$(node --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const copilotHome = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"); const installed = path.join(copilotHome, "installed-plugins"); const matches = []; const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { walk(full); continue; } if (!entry.isFile() || entry.name !== "plugin.json") { continue; } try { const data = JSON.parse(fs.readFileSync(full, "utf8")); if (data.name === "subagents") { matches.push(path.dirname(full)); } } catch {} } }; if (fs.existsSync(installed)) { walk(installed); } if (matches.length === 0) { process.stderr.write("Unable to locate the installed subagents plugin. Reinstall the plugin and retry.\n"); process.exit(1); } console.log(matches[0]);')"
node "$PLUGIN_ROOT/scripts/copilot-companion.mjs" cancel <raw arguments>
```
