# Browser Automation Architecture

This document explains why this repo exposes one browser automation skill while keeping two
underlying backends.

## Design Goal

The repository should present one clear user-facing entry for browser automation:
`browser-automation`.

Users should not need to decide whether a task belongs to `agent-browser` or `playwright-cli`.
That decision is an implementation concern.

## Why One Unified Skill

The two upstream skills overlap heavily in trigger language:

- open websites
- click through flows
- fill forms
- log in
- take screenshots
- extract page content
- test web applications

Leaving both as peer user-facing skills creates routing ambiguity for both users and models. The
unified skill removes that ambiguity and gives the repo one stable browser automation mental model.

## Why Keep Two Backends

Do not collapse onto one backend just to reduce surface area.

`agent-browser` is the best default for ordinary agent-led browser tasks because it provides a
high-level workflow built around snapshots and interactive refs.

`playwright-cli` still has specialist strengths that should remain available:

- request mocking and routing
- tracing
- console and network inspection
- explicit dialog control
- fine-grained mouse interaction
- explicit Firefox, WebKit, and Edge selection
- direct Playwright code execution

The unified skill is therefore a routing layer, not a replacement for either tool.

## Routing Contract

### Default Path: `agent-browser`

Keep these tasks in the `agent-browser` branch unless a later step requires escalation:

- normal navigation
- login flows
- form filling
- screenshots and PDFs
- text extraction
- simple scraping
- ordinary interactive testing

### Specialist Path: `playwright-cli`

Switch to `playwright-cli` when the request explicitly involves:

- `route` or network mocking
- tracing or video capture
- console or network diagnostics
- `dialog-accept` or `dialog-dismiss`
- fine-grained mouse behavior
- explicit non-Chromium browser selection
- `run-code`

### Escalation Rule

Start with `agent-browser` when a task is ordinary, then switch only if a real requirement appears.
Do not prematurely force every browser task through `playwright-cli`.

## Non-Goals

The unified skill is not:

- a compatibility shim between the two CLIs
- a wrapper that invents new commands
- a full copy of either upstream skill
- a promise of feature parity between the two tools

It is a curated decision layer plus a small set of reusable local templates.

## Upstream Maintenance Workflow

When updating this local skill against upstream changes:

1. Read both upstream `SKILL.md` files.
2. Inspect any new or changed templates, scripts, or references shipped upstream.
3. Compare upstream capability changes against the local routing contract.
4. Update `skills/browser-automation/SKILL.md` only if the routing decision or default workflow
   should change.
5. Port useful template improvements selectively into local templates.
6. Update local references only when the routing guidance or session guidance needs to change.
7. Do not copy upstream documentation wholesale unless a specific local maintenance pain justifies
   it.

## Sync Checklist

Use this checklist during each upstream refresh:

- Has trigger overlap changed enough to require new wording in the unified skill description?
- Has `agent-browser` gained a capability that should move a task out of the `playwright-cli`
  branch?
- Has `playwright-cli` gained or removed a specialist capability that changes routing?
- Have any command names or flags changed in the local templates?
- Do the example prompts still route unambiguously?
- Are the local templates still the smallest useful starter set?

## Change Policy

Prefer stability in the user-facing trigger and routing model.

Update the unified skill only when one of these is true:

- upstream behavior clearly changes which backend is the better default for a scenario
- local templates drift from real command syntax
- the unified trigger description no longer cleanly captures the intended tasks

If an upstream skill adds many new details but does not change routing or local templates, record
the review outcome in commit context rather than expanding the local skill for no reason.
