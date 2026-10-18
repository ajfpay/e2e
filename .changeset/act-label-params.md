---
"e2e": patch
---

An `agent.act` step now reads with its params filled in, in the terminal, the report, and trace pages: `act('add a todo named {title}', { params: { title: 'Buy milk' } })` shows `add a todo named Buy milk`. A param that holds a `Secret` stays `{name}`. The model, custom executors, and the replay cache key still get `{title}` unfilled, and when the label differs from it, the report keeps that instruction in the step's new `instruction` field.
