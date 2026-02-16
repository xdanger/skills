# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal collection of Claude Code Skills. Skills are modular packages (SKILL.md + optional scripts/references/assets) that extend agent capabilities.

## Repository Layout

- `skills/` — Self-authored skills
- `.agents/skills/` — Third-party / upstream skills
- `.claude/skills/` — Symlinks that Claude Code reads from, pointing to either of the above

## Commands

```bash
pnpm lint              # ESLint + Prettier check
pnpm format            # Prettier + autocorrect (CJK spacing) auto-fix
pnpm lint:fix          # ESLint fix + format
```

## Git Hooks

- **pre-commit**: runs `pnpm lint:staged` (ESLint fix on `*.ts/*.tsx`, Prettier + autocorrect on all files)
- **pre-push**: requires `git-lfs`

## Skill Structure

Every skill has a `SKILL.md` with YAML frontmatter (`name`, `description`) and markdown body. Optional directories: `scripts/`, `references/`, `assets/`.

When adding a new self-authored skill, create it under `skills/<name>/` and symlink into `.claude/skills/`.

## Code Style

- Prettier: 96 char line width, double quotes, trailing commas, LF endings
- Biome: 96 char line width, space indent
- autocorrect: enforces CJK-ASCII spacing (e.g., "使用 Python 3.11")
