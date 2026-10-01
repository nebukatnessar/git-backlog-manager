---
name: push-integrity
description: Load whenever writing, copying, or pushing file content to a remote (git push, GitHub API, MCP push tools), or when transferring long text between tools. Prevents silent content corruption.
---

# Push Integrity

Silent content corruption is the most expensive failure mode: it is invisible
until CI fails or runtime errors appear, and it often happens in the transfer
layer, not in the code you wrote. Assume every long string that passes through
a tool boundary can be mangled.

## Rules

- Never read repository code through HTML renderers or web-page fetches. They
  hard-wrap long lines mid-identifier. Use the raw content API or git.
- Never hand-retype or hand-paste long content between tools. If you must
  paste, verify integrity afterward (see checks below).
- Before pushing file content through any tool, compute a checksum of what
  you are about to send. After pushing, fetch the content back from the
  remote (contents API or `git show`) and verify it matches byte-for-byte.
- If a verification fails once, do not retry the same method. Change the
  transfer mechanism (e.g. patch-in-place on API-fetched content instead of
  re-pasting the whole file).
- Prefer patching a small delta over transmitting whole files. The smaller
  the payload, the smaller the corruption surface.
- CDN-cached raw URLs (raw.githubusercontent.com) can serve stale copies.
  Treat the contents API with an explicit ref as the source of truth.

## Quick checks after any push

1. Re-fetch the file from the remote at the exact ref you pushed to.
2. Compare length and checksum against the local source.
3. If the file is code, syntax-check the fetched copy, not just the local one.

---

name: ci-failure-fix
description: Load when fixing a CI failure on a pull request, when asked to make a red build green, or when a relaunch provides failure logs for a PR.

---

# CI Failure Fix

Fix CI failures with the discipline of a surgeon: reproduce, localize, fix
the named cause, nothing else.

## Reproduce before fixing

- Install and build exactly as CI does: `npm ci` (never `npm install`),
  same Node version as CI where you can choose.
- Run the CI commands verbatim. Do not shorten them or substitute
  "equivalent" commands.
- Reproduce the failure in THIS run before writing any fix. If you cannot
  reproduce it, say so explicitly rather than guessing at a fix.

## Fix rules

- Fix the actual root cause the logs point to. Never add try/catch, type
  assertions, or `any` merely to silence the error.
- Stay inside the failing PR's diff. If the failure is in code the PR did not
  touch, report it; do not "fix" it in this PR.
- Push to the SAME branch. Never open a new PR, never rebase or force-push
  the failure away.
- Never push a fix you have not seen pass locally in THIS run.
- One push per run, then stop. Let CI speak.

## Stop conditions

- If a check passes locally but fails in CI with the same commands, report
  both outputs. That contradiction is information, not a bug to paper over.
- If the failure logs are empty, unavailable, or truncated at exactly the
  point of interest, say what you need instead of pushing a speculative fix.
- When in doubt, ask a question on the issue and stop. A clear question
  beats a wrong fix.

---

name: repo-scope
description: Load at the start of any task that names a repository (issue implementation, PR fix, code search), and whenever repository identity could be ambiguous across configured connectors.

---

# Repo Scope

You may have several GitHub connectors or repositories configured. Before
any tool call, know exactly which repository you are in — and stay there.

## Rules

- Identify the target as `owner/repo` from the task or prompt. If it is not
  stated, ask; never infer it from your tool configuration.
- Before your first repository tool call, verify the target exists in the
  expected repository (e.g. list branches or read a known file). If the
  expected branch or file is missing, suspect you are pointed at the wrong
  repository or connector — check before concluding it does not exist.
- Corollary: a search that returns files that do not exist in the target
  repository means you are querying the wrong repository. Stop and re-check
  the tool's owner/repo arguments; do not adopt the foreign results as
  context.
- When listing or searching, pass explicit owner/repo filters rather than
  relying on defaults.
- Never open PRs, branches, or commits in a repository other than the
  target, even if a connector makes it easy.

name: small-diff-review
description: Load before committing, pushing, or opening a pull request, and whenever reviewing or merging changes.

---

# Small Diff Review

Every line in the diff should be able to explain why it is there. Careless
merges and unintended edits hide in diffs nobody reads.

## Before every commit/push

- Produce the diff against the base branch and read every hunk.
- Confirm each hunk is intentional. Kill drive-by changes: whitespace,
  reformatting, line-ending or encoding flips, import reordering not
  required by your change.
- A fix should be the smallest edit that resolves the named problem. If a
  hunk is not part of the fix, revert it.
- Watch for lost content when editing: a rewritten file that omits lines
  from the original IS a deletion, even if you did not intend one. Compare
  against the original before finalizing.
- If the diff is much larger than the task warranted, stop and find out
  why before pushing.

## When merging others' work

- Never resolve conflicts by "taking a guess" or by keeping both sides.
  Each conflicted line needs a decision that preserves both intentions.
- After a conflict-heavy merge, compile/type-check before considering it
  done — a merge that compiles is the floor, not the ceiling.
- Re-read the merged result around every conflict site.
