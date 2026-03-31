import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveReviewTarget } from "../scripts/lib/git.mjs";
import { makeGitRepo } from "./helpers.mjs";

test("auto review target prefers working tree when the repo is dirty", () => {
  const repoDir = makeGitRepo({ "src/app.js": "console.log('hello');\n" });
  fs.appendFileSync(path.join(repoDir, "src/app.js"), "console.log('dirty');\n", "utf8");
  const target = resolveReviewTarget(repoDir, {});
  assert.equal(target.mode, "working-tree");
});

test("explicit branch scope resolves to branch mode", () => {
  const repoDir = makeGitRepo({ "src/app.js": "console.log('hello');\n" });
  const target = resolveReviewTarget(repoDir, { scope: "branch" });
  assert.equal(target.mode, "branch");
  assert.ok(target.baseRef);
});
