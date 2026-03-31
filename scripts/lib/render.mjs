import fs from "node:fs";

function formatDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatDuration(startValue, endValue = null) {
  const start = Date.parse(startValue ?? "");
  if (!Number.isFinite(start)) {
    return null;
  }
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(end) || end < start) {
    return null;
  }
  const totalSeconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function readOutput(job) {
  if (!job.outputFile || !fs.existsSync(job.outputFile)) {
    return "";
  }
  return fs.readFileSync(job.outputFile, "utf8").trimEnd();
}

function formatJobLine(job) {
  const parts = [job.id, job.kind, job.status];
  if (job.model) {
    parts.push(`model=${job.model}`);
  }
  if (job.agent) {
    parts.push(`agent=${job.agent}`);
  }
  return parts.join(" | ");
}

export function renderSetupReport(report) {
  const lines = [
    "# Subagents Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    `- node: ${report.node.detail}`,
    `- git: ${report.git.detail}`,
    `- copilot: ${report.copilot.detail}`,
    `- plugin root: ${report.pluginRoot}`,
    `- workspace root: ${report.workspaceRoot}`,
    `- workspace state dir: ${report.stateDir}`,
    `- review gate: ${report.config?.reviewGate ? "enabled" : "disabled"}`
  ];

  if (report.actionsTaken?.length > 0) {
    lines.push("", "Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderBackgroundStart(job) {
  return [
    `Started ${job.kind} in the background.`,
    `Job: ${job.id}`,
    `Model: ${job.model || "default"}`,
    `Use /subagents:status ${job.id} to check progress.`,
    `Use /subagents:result ${job.id} when it finishes.`
  ].join("\n") + "\n";
}

export function renderStatusReport(snapshot) {
  const lines = ["# Subagents Status", "", `Workspace: ${snapshot.workspaceRoot}`, ""];

  if (snapshot.running.length === 0 && snapshot.finished.length === 0) {
    lines.push("No jobs recorded for this workspace.");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  if (snapshot.running.length > 0) {
    lines.push("Running jobs:");
    for (const job of snapshot.running) {
      lines.push(`- ${formatJobLine(job)}`);
      if (job.title) {
        lines.push(`  Title: ${job.title}`);
      }
      const elapsed = formatDuration(job.startedAt ?? job.createdAt);
      if (elapsed) {
        lines.push(`  Elapsed: ${elapsed}`);
      }
      if (job.summary) {
        lines.push(`  Summary: ${job.summary}`);
      }
    }
    lines.push("");
  }

  if (snapshot.finished.length > 0) {
    lines.push("Recent finished jobs:");
    for (const job of snapshot.finished) {
      lines.push(`- ${formatJobLine(job)}`);
      if (job.title) {
        lines.push(`  Title: ${job.title}`);
      }
      const completedAt = formatDate(job.completedAt);
      if (completedAt) {
        lines.push(`  Completed: ${completedAt}`);
      }
      const duration = formatDuration(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt);
      if (duration) {
        lines.push(`  Duration: ${duration}`);
      }
      if (job.summary) {
        lines.push(`  Summary: ${job.summary}`);
      }
      if (job.sessionId) {
        lines.push(`  Session ID: ${job.sessionId}`);
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderResultReport(job) {
  if (!job) {
    return "No completed job was found for this workspace.\n";
  }
  if (job.status === "queued" || job.status === "running") {
    return `Job ${job.id} is still ${job.status}. Run /subagents:status ${job.id} or rerun status with --wait.\n`;
  }
  if (job.status === "cancelled") {
    return `Job ${job.id} was cancelled.\n`;
  }

  const output = readOutput(job);
  if (output) {
    return `${output}\n`;
  }

  return `Job ${job.id} finished with status ${job.status}, but no stored output was found.\n`;
}

export function renderCancelReport(job, cancelResult) {
  if (!job) {
    return "No running job was found to cancel.\n";
  }
  if (!cancelResult && job.status !== "queued" && job.status !== "running") {
    return `Job ${job.id} is already ${job.status}.\n`;
  }

  return [
    `Cancelled ${job.kind} job ${job.id}.`,
    `Signal delivered: ${cancelResult.delivered ? "yes" : "no"}`
  ].join("\n") + "\n";
}
