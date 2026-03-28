# xdanger.skills

Personal collection of [Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) for extending AI agent capabilities.

## Skills

| Skill                                           | Description                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [git-commit](skills/git-commit)                 | Conventional Commits + Gitmoji 标准化原子提交                          |
| [research](skills/research)                     | 证据驱动的深度研究引擎，支持多轮搜索、来源评级与引用综合               |
| [browser-automation](skills/browser-automation) | 统一浏览器自动化，支持 agent-browser 与 playwright-cli 双路径          |
| [manus](skills/manus)                           | 异步任务代理，适用于 PDF/PPT/CSV 生成等超出本地工具能力的任务          |
| [video-generation](skills/video-generation)     | Seedance 2.0 AI 视频生成，支持文生视频、图生视频、多模态参考与视频编辑 |

## Usage

```bash
npx skills add https://github.com/xdanger/skills --skill git-commit
npx skills add https://github.com/xdanger/skills --skill research
npx skills add https://github.com/xdanger/skills --skill browser-automation
npx skills add https://github.com/xdanger/skills --skill manus
npx skills add https://github.com/xdanger/skills --skill video-generation
```

## Structure

```
├── skills/                  # Self-authored skills
│   ├── git-commit/
│   ├── research/
│   ├── browser-automation/
│   ├── manus/
│   └── video-generation/
├── .agents/skills/          # Third-party / upstream skills
│   └── skill-creator/
├── AGENTS.md                # Agent instructions
└── CLAUDE.md                → AGENTS.md
```

## License

Skills may have individual licenses. See each skill directory for details.
