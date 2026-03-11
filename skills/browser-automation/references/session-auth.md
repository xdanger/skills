# Session And Auth

Prefer the least fragile authentication path that keeps secrets out of prompts.

## Preferred Order

1. `agent-browser` auth vault
2. previously saved browser state
3. manual login flow during the current session

## Auth Vault First

When the task is a repeatable login and the environment supports it, prefer:

```bash
echo "<password>" | agent-browser auth save myapp --url https://example.com/login --username user --password-stdin
agent-browser auth login myapp
```

This keeps the password out of the model-visible prompt and shell history.

## Saved State

When a full session must be reused:

```bash
agent-browser state save auth-state.json
agent-browser state load auth-state.json
```

Use saved state when the task needs authenticated browsing but not credential management.

## When `playwright-cli` Is Involved

If the task already requires `playwright-cli`, use its storage-state features instead of inventing a
cross-tool abstraction:

```bash
playwright-cli state-save auth.json
playwright-cli state-load auth.json
```

## Practical Rules

- Avoid prompting for raw passwords unless there is no safer path.
- Reuse session state for repeated tasks on the same site.
- If authentication expires, fall back to a fresh login instead of assuming saved state is valid.
- Close the session when done so future runs do not inherit unexpected state.
