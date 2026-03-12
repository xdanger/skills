# browser-automation

Unified browser automation for AI agents.

Its core idea is simple:

- expose one user-facing skill for web interaction tasks
- keep `agent-browser` as the default backend
- keep `playwright-cli` as the specialist backend for Playwright-specific control

## Why This Skill Exists

The upstream browser skills overlap heavily:

- open websites
- click through flows
- fill forms
- log in
- take screenshots
- extract data
- test web apps

That overlap makes routing ambiguous for both users and agents. This skill removes that ambiguity by
presenting one entry point and handling backend choice internally.

## Routing Philosophy

Use `agent-browser` for normal agent-led browser work:

- navigation
- login flows
- form filling
- screenshots and PDFs
- extraction and scraping
- session reuse
- responsive checks and visual verification

Use `playwright-cli` only when the task clearly needs:

- request mocking
- tracing
- console or network inspection
- dialog control
- fine-grained mouse primitives
- explicit Firefox, WebKit, or Edge coverage
- custom Playwright code

When both tools could work, prefer `agent-browser`.

## Local Structure

- `SKILL.md`: agent-facing trigger and routing instructions
- `templates/`: starter workflows for forms, auth, capture, and advanced debugging
- `references/`: local routing and session guidance

This folder intentionally does not try to mirror either upstream skill in full.

## Maintenance Philosophy

This skill is a curated routing layer, not a compatibility shim and not a full upstream copy.

When upstream changes:

1. Read the upstream skill docs.
2. Check whether command syntax or capability boundaries changed.
3. Update local routing rules only if the best backend choice changed.
4. Port useful template improvements selectively.
5. Avoid copying large upstream docs unless they solve a real local maintenance problem.

For the full architecture and maintenance notes, read:

- [ARCH.md](ARCH.md)
- [agent-browser upstream skill](https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md)
- [playwright-cli upstream skill](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md)

## Usage

```bash
npx skills add https://github.com/xdanger/skills --skill browser-automation
```

Requires `agent-browser` and/or `playwright-cli` to be available. See upstream docs for installation.
