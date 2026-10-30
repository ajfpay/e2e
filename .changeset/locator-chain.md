---
"e2e": patch
"@e2e-dev/web": patch
"@e2e-dev/mobile": patch
---

Add `locator.locator(selector)`: the platform selector inside a locator's matches, as `browser.locator` and `device.locator` take it at the top. `screen.getByRole('form').locator('input[name=manifest]')` finds the input in that form only. An engine opts in with `scopedSelectors: true` once its `locate` honors the new `scope` on a `selector` expression; without it the call fails with `UNSUPPORTED_CAPABILITY`.
