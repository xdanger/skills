---
name: browser-automation
description: Unified browser automation skill for navigation, login flows, form filling, screenshots, extraction, page debugging, and light web app testing. Use when Codex or Claude needs to open websites, click through flows, authenticate, scrape content, capture evidence, inspect browser behavior, or automate browser tasks without making the user choose between agent-browser and playwright-cli.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*), Bash(playwright-cli:*), Bash(npx playwright-cli:*)
---

# Browser Automation

Use this skill as the single entry for browser automation tasks.

Default to `agent-browser` for most work. Switch to `playwright-cli` only when the task needs
lower-level Playwright-style control.

## Default Workflow

Use this flow unless the task clearly needs a specialized branch:

1. `open`
2. `snapshot`
3. `interact`
4. `re-snapshot`
5. `verify`
6. `close`

Example:

```bash
agent-browser open https://example.com
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser click @e1
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser close
```

## Backend Selection

### Prefer `agent-browser`

Use `agent-browser` for:

- opening pages and navigating through a user flow
- logging in and reusing saved browser state
- filling forms, clicking buttons, selecting options, and uploading files
- taking screenshots, saving PDFs, or extracting page text
- scraping or capturing content with agent-friendly refs
- general website testing where snapshots and refs are enough

### Switch to `playwright-cli`

Use `playwright-cli` when the request explicitly needs:

- request mocking or routing
- tracing, video, console inspection, or network inspection
- explicit dialog accept or dismiss flows
- fine-grained mouse operations beyond normal click or hover flows
- explicit Firefox, WebKit, or Edge selection
- direct Playwright code execution with `run-code`

If the task starts as a normal browser flow and later needs one of the items above, switch tools
instead of forcing the whole task through `playwright-cli` from the beginning.

## Working Rules

- Keep the user-facing mental model simple. Do not ask the user to choose between the two CLIs
  unless they explicitly want a specific backend.
- Re-snapshot after navigation, form submission, modal changes, or any DOM update that can
  invalidate refs.
- Prefer auth vault or saved state over repeatedly typing credentials into prompts.
- Close the browser session when the task is complete so background state does not leak across
  tasks.

## Reusable Resources

- Template: `templates/form-automation.sh`
- Template: `templates/authenticated-session.sh`
- Template: `templates/capture-workflow.sh`
- Template: `templates/advanced-debugging.sh`
- Reference: `references/tool-selection.md`
- Reference: `references/session-auth.md`

These templates are starter workflows. Customize refs, selectors, or follow-up commands when the
site-specific flow requires it.

Load the references only when needed. Keep the default path light.
