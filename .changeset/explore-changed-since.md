---
"e2e": patch
---

`e2e explore --changed-since <ref>` explores what a branch changed. The planner reads the commit messages and the diff since the merge base of the ref and HEAD, and plans its steps for the screens the change can affect. With no goal, the goal is the change. The report records the change as `run.changes`, and the markdown and GitHub comment name it under the goal. `explore()` on `e2e/runner` takes `changedSince` too.

```bash
npx e2e explore --changed-since origin/main
```
