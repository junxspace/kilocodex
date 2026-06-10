---
"kilocode": minor
---

Add strict commit workflow to `kilox commit`:
- Remove auto-staging; require explicit `git add` before running
- Show `git status`, `git diff`, `git diff --staged` during review
- Offer `git push` when working directory is clean
- Support `commit_message.model` config for custom generation model
- `--yes` auto-confirms push and commit actions
