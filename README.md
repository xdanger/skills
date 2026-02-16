# xdanger.skills

Personal collection of [Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) for extending AI agent capabilities.

## Skills

| Skill | Description |
| --- | --- |
| [git-commit](skills/git-commit) | Gitmoji + Conventional Commits 标准化提交 |
| [skill-creator](.agents/skills/skill-creator) | 创建和打包新 Skill 的工具链 |

## Structure

```
├── skills/                  # Self-authored skills
│   └── git-commit/
├── .agents/skills/          # Third-party / upstream skills
│   └── skill-creator/
├── .claude/skills/          # Symlinks (Claude Code reads from here)
│   ├── git-commit       → ../../skills/git-commit
│   └── skill-creator    → ../../.agents/skills/skill-creator
├── AGENTS.md                # Agent instructions (shared across AI tools)
└── CLAUDE.md                → AGENTS.md (symlink for Claude Code)
```

## Usage

Clone this repo and symlink `.claude/skills/` into your project:

```bash
ln -s /path/to/xdanger.skills/.claude/skills/your-skill /your-project/.claude/skills/
```

## License

Skills may have individual licenses. See each skill directory for details.
