---
name: browser-automation
description: Unified browser automation for AI agents. Use when Codex or Claude needs to open websites, click buttons, fill forms, log in, take screenshots, scrape data, download files, verify UI behavior, test web apps, or automate browser actions. Default to `agent-browser` for general browsing, session reuse, authentication, screenshots, extraction, responsive checks, and parallel agent workflows. Use the `playwright-cli` path only when the task explicitly needs request mocking, tracing, console or network inspection, fine-grained mouse events, dialog handling, explicit Firefox/WebKit/Edge coverage, or custom Playwright code.
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

## Tool Selection

### Prefer `agent-browser`

Use `agent-browser` for:

- opening pages and navigating through a user flow
- clicking, typing, selecting, checking, scrolling, and uploads
- logging in and reusing saved browser state
- form submission
- taking screenshots, saving PDFs, or extracting page text
- scraping or capturing content with agent-friendly refs
- responsive checks, device emulation, and visual verification
- parallel browser sessions for agent workflows
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

When both tools could work, prefer `agent-browser`.

## `agent-browser` Path

Prefer this path for most tasks because it is better suited to agent workflows.

```bash
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser select @e3 "option"
agent-browser check @e4
agent-browser get text @e5
agent-browser screenshot --annotate
agent-browser pdf output.pdf
agent-browser close
```

Good defaults:

- Use `snapshot -i` before interacting.
- Re-snapshot after navigation, form submission, modal open, or dynamic content changes.
- Use `wait --load networkidle` for slow pages.
- Use named sessions for parallel or long-running workflows.
- Use saved auth state when available.

## `playwright-cli` Path

Use this path only for tasks that clearly need Playwright-specific debugging or controls.

```bash
playwright-cli open https://example.com
playwright-cli snapshot
playwright-cli route "**/*.jpg" --status=404
playwright-cli console
playwright-cli network
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
playwright-cli close
```

## Safety and Hygiene

- Keep the user-facing mental model simple. Do not ask the user to choose between the two CLIs
  unless they explicitly want a specific backend.
- Never expose secrets in commands when a safer auth or state flow exists.
- Prefer saved auth state or secure login helpers over typing passwords into shell history.
- Re-snapshot after navigation, form submission, modal changes, or any DOM update that can
  invalidate refs.
- Close the browser session when the task is complete so background state does not leak across
  tasks.
- Use named sessions to avoid collisions in concurrent agent work.

## Reusable Resources

- Template: `templates/form-automation.sh`
- Template: `templates/authenticated-session.sh`
- Template: `templates/capture-workflow.sh`
- Template: `templates/advanced-debugging.sh`
- Reference: `references/tool-selection.md`
- Reference: `references/session-auth.md`

These templates are starter workflows. Customize refs, selectors, or follow-up commands when the
site-specific flow requires it.

## References

Read these only when needed:

- For general browser workflows, auth, sessions, refs, and screenshots, read `/Users/xdanger/.dotfiles/agents/skills/agent-browser/SKILL.md`.
- For request mocking, tracing, network inspection, and Playwright-specific debugging, read `/Users/xdanger/.dotfiles/agents/skills/playwright-cli/SKILL.md`.
- For local routing rules and session guidance, read `references/tool-selection.md` and `references/session-auth.md`.

Load references only when needed. Keep the default path light.
