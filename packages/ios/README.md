# @e2e-dev/ios (experimental, private)

An iOS engine that is an [engine protocol](../../docs/reference/engine-protocol.mdx)
server written in Swift, hosted by an XCUITest bundle on the simulator. It
measures what driving the app directly from XCUITest buys over
`@e2e-dev/mobile` on agent-device, and shows a second language behind the
same protocol after the Java Android engine.

- `server/` - the Xcode project: a host app and the `E2EServer` UI test
  bundle. `EngineServer.testServe` listens on a localhost port (a simulator
  shares its Mac's loopback) and answers the protocol on the main thread.
  `Device.swift` reads the tree from one XCUITest snapshot and acts with
  XCUITest gestures at the observed frames.
- `src/transport.ts` - the host half: installs the target's `appPath`,
  starts the test with `xcodebuild test-without-building` on a free port,
  waits for it to listen, and connects.
- `src/index.ts` - `ios()`, the client: `connectEngine` with the manifest,
  host-side locators, and a `device` fixture with `back()`.

## Build

Needs Xcode. The root `pnpm build` compiles the TypeScript; the server
builds on its own:

```bash
pnpm build                                  # every package, e2e first
pnpm --filter @e2e-dev/ios build:server     # build/DerivedData/.../*.xctestrun
```

## Run the mobile benchmark on it

With the benchmark app (`dev.e2e.benchmark`) installed on a booted
simulator:

```bash
cd apps/mobile-benchmark
E2E_IOS_UDID=<udid> node node_modules/e2e/dist/cli/bin.js run --config e2e.ios.config.ts
E2E_IOS_WAIT_FOR_IDLE=0 E2E_IOS_UDID=<udid> node node_modules/e2e/dist/cli/bin.js run --config e2e.ios.config.ts
BENCH_ENGINE=agent-device E2E_MOBILE_BENCHMARK_IOS_DEVICE=<udid> node node_modules/e2e/dist/cli/bin.js run --config e2e.ios.config.ts
```

## Measure

```bash
E2E_IOS_UDID=<udid> pnpm --filter @e2e-dev/ios bench -- --rounds 10
```

Runs the same engine calls on agent-device, on this engine, and on this
engine with `waitForIdle: false`, and prints the p50 of each.

## Results

Measured 2026-10-18 on a Mac mini (M5 Pro), iPhone 17 Pro simulator on iOS
26.5, mobile benchmark app, against `mobile()` on agent-device 0.21.28 with
the benchmark's settings.

The deterministic suite (`e2e.ios.config.ts`, 41 tests, one worker):

| | agent-device | direct | direct, `waitForIdle: false` |
| --- | --- | --- | --- |
| Passing | 41 | 35 | 30 |
| Run time | 526s | 443s | 386s |
| Tests both pass, agent-device time | - | 453s on 35 | 245s on 30 |
| Same tests, direct time | - | 377s (**1.2x**) | 153s (**1.6x**) |

The six the direct engine fails are gaps in this prototype, not the
protocol: React Native's checkbox and radio roles (three tests), `clearState`
(no reset from inside the simulator), the Save Password sheet after login
(another process's window), and a sticky footer the scroll does not clear.
Without the idle wait, five more fail: the harness polls an app still
animating.

Engine calls (`bench/bench.ts --rounds 10`, p50):

| Operation | agent-device | direct | direct, no idle wait |
| --- | --- | --- | --- |
| observe | 91.5 ms | 17.5 ms | 17.7 ms |
| locate | 76.1 ms | 14.2 ms | 14.0 ms |
| screenshot | 691 ms | 74.7 ms | 77.3 ms |
| fill (19 chars) | 4856 ms | 1942 ms | 1505 ms |
| keyboard.type (10 chars) | 1208 ms | 430 ms | 425 ms |
| tap | 487 ms | 399 ms | 358 ms |
| tap row, next screen up | 5 of 5 failed | 1152 ms | 390 ms |
| back, list up | 1041 ms | 1706 ms | 1038 ms |
| swipe | 550 ms | 1430 ms | 1424 ms |
| restart app | 713 ms | 2637 ms | 2537 ms |
| init (cold) | 3208 ms | 1381 ms | 1495 ms |

Reads are 5-9x faster: one XCUITest snapshot and a screenshot in process,
with no daemon or HTTP hop. Gestures are where XCUITest itself sets the
pace: its idle waits, and `press(forDuration:thenDragTo:)` taking over a
second for a swipe. Restart goes through `terminate()` and `activate()`,
which wait for the launch; agent-device launches with `simctl` from the
host. The next levers are XCTest's private event synthesis for gestures
(what WebDriverAgent uses) and a host-side relaunch.

## `waitForIdle: false`

XCUITest waits for the app to go idle before and after every gesture.
`ios({ waitForIdle: false })` replaces that private wait with a no-op, as
WebDriverAgent can, so a gesture returns once its events are delivered and
the harness's polling waits for the outcome. It is private API and can
break with any Xcode release.
