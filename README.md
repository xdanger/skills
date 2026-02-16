# xdanger.skills

Personal collection of [Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) for extending AI agent capabilities.

## Skills

| Skill | Description |
| --- | --- |
| [git-commit](skills/git-commit) | Gitmoji + Conventional Commits 标准化提交 |

## Usage

```bash
npx skills add xdanger/skills --skill git-commit
```

## Structure

```
├── skills/                  # Self-authored skills
│   └── git-commit/
├── .agents/skills/          # Third-party / upstream skills (infra)
│   └── skill-creator/
├── AGENTS.md                # Agent instructions
└── CLAUDE.md                → AGENTS.md
```

## License

Skills may have individual licenses. See each skill directory for details.
