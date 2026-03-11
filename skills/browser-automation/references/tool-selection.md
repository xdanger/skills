# Tool Selection

`browser-automation` exposes one user-facing skill but keeps two backend tools.

## Use `agent-browser` By Default

Reach for `agent-browser` first when the task is about:

- page navigation
- login flows
- form submission
- screenshots or PDFs
- text extraction
- general scraping
- agent-style interaction with refs and snapshots

Why:

- the workflow is optimized for agents
- snapshots and `@e` refs make ordinary browser tasks fast to steer
- it already includes strong built-in patterns for session reuse and capture

## Use `playwright-cli` For Specialist Flows

Switch to `playwright-cli` when the task needs:

- `route`, `route-list`, or `unroute`
- `tracing-start` / `tracing-stop`
- `console` or `network`
- `video-start` / `video-stop`
- `dialog-accept` or `dialog-dismiss`
- explicit `--browser=firefox|webkit|msedge`
- `run-code`

Why:

- these are Playwright-native capabilities
- the CLI maps closely to Playwright primitives
- it is better for debugging, instrumentation, and behavior shaping

## Routing Heuristics

- “Open a website and click through the flow” -> `agent-browser`
- “Fill this form and save evidence” -> `agent-browser`
- “Scrape visible content from a page” -> `agent-browser`
- “Mock this request while testing” -> `playwright-cli`
- “Capture a trace for a failure” -> `playwright-cli`
- “Run custom Playwright code” -> `playwright-cli`

## Maintenance Rule

Do not try to keep feature parity in this reference. Keep only the routing contract that helps the
skill choose the right backend. Detailed command documentation belongs upstream.
