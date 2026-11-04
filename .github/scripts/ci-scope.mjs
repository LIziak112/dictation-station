import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";

function docsOnly(event, base, files) {
  return (
    event !== "workflow_dispatch" &&
    Boolean(base) &&
    !/^0+$/.test(base) &&
    files.length > 0 &&
    files.every((file) =>
      /^(?:[^/]+\.md|docs\/.+\.md|\.github\/pull_request_template\.md)$/.test(file),
    )
  );
}

if (process.argv.includes("--test")) {
  const base = "abc123";
  assert(docsOnly("pull_request", base, ["README.md", "docs/开发流程.md"]));
  assert(docsOnly("push", base, ["AGENTS.md", ".github/pull_request_template.md"]));
  for (const file of [
    "apps/web/src/App.tsx",
    "apps/web/content.md",
    "docs/example.json",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    ".github/scripts/ci-scope.mjs",
  ]) {
    assert(!docsOnly("pull_request", base, ["README.md", file]), file);
  }
  assert(!docsOnly("workflow_dispatch", base, ["README.md"]));
  assert(!docsOnly("push", "0".repeat(40), ["README.md"]));
  assert(!docsOnly("push", "", ["README.md"]));
  assert(!docsOnly("pull_request", base, []));
  console.log("CI scope checks passed");
} else {
  const { EVENT_NAME: event, BASE_SHA: base, GITHUB_OUTPUT: output } = process.env;
  // Disabling rename detection includes both old and new paths in the scope decision.
  const files =
    base && !/^0+$/.test(base)
      ? execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", base, "HEAD"], {
          encoding: "utf8",
        })
          .split("\0")
          .filter(Boolean)
      : [];
  const docs = docsOnly(event, base, files);
  await appendFile(
    output,
    `docs_only=${docs}\nfiles=${JSON.stringify(docs ? files.filter(existsSync) : [])}\n`,
  );
  console.log(docs ? "Documentation checks only" : "Full application checks");
}
