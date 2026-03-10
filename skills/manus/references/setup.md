# Manus Integration — Setup Guide

Verified against official docs at `https://open.manus.im/docs` on March 10, 2026.

## Prerequisites

- Generate an API key from Manus settings
- Expose it as `MANUS_API_KEY`
- Ensure `uv` is installed

Set the script path from the installed skill location:

```bash
SCRIPT="<SKILL_DIR>/scripts/manus_client.py"
```

## Phase 1 — Polling Mode

### Create a test task

```bash
uv run "$SCRIPT" create \
  --prompt "What is 2+2? Reply with just the answer." \
  --mode chat \
  --profile manus-1.6-lite \
  --session-key test
```

### Check status

```bash
uv run "$SCRIPT" status --task-id <task_id>
```

If Manus returns PPTX output and you want conversion during retrieval:

```bash
uv run "$SCRIPT" status --task-id <task_id> --convert
```

### Get result

```bash
uv run "$SCRIPT" result --task-id <task_id>
```

## Phase 2 — Webhook Mode

### 1. Register a webhook

```bash
WEBHOOK_URL="https://<your-host>/hooks/manus?token=<hooks.token>"

curl -X POST https://api.manus.ai/v1/webhooks \
  -H "API_KEY: $MANUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"webhook\": {\"url\": \"$WEBHOOK_URL\"}}"
```

Save the returned `webhook_id`.

### 2. Cache the public key

```bash
curl -s https://api.manus.ai/v1/webhook/public_key \
  -H "API_KEY: $MANUS_API_KEY" | jq -r '.public_key' \
  > ~/.openclaw/cache/manus-webhook-pubkey.pem
```

### 3. Verify delivery

```bash
uv run "$SCRIPT" create \
  --prompt "What is the capital of France?" \
  --mode chat \
  --profile manus-1.6-lite \
  --session-key test-webhook
```

Then confirm:

1. A `task_created` event arrives
2. Zero or more `task_progress` events arrive
3. A final `task_stopped` event arrives
4. The transform routes the final result back to the original session

## Multi-Turn Tasks

When `stop_reason` is `ask`:

1. Relay Manus's question to the user
2. Continue with the original task ID:

```bash
uv run "$SCRIPT" create \
  --task-id <original_task_id> \
  --prompt "User's follow-up answer"
```

## Deleting Tasks

The current official API documents deletion, not a dedicated cancel endpoint:

```bash
uv run "$SCRIPT" delete --task-id <task_id>
```

This permanently deletes the task resource via `DELETE /v1/tasks/{task_id}`.

## Troubleshooting

| Issue | What to check |
| --- | --- |
| `MANUS_API_KEY not set` | Export the env var in the runtime that launches the script |
| Webhook verification fails | Ensure the full request URL, including query params, matches the registered endpoint |
| Attachments fail on create | Use `attachments.filename` + `attachments.file_id` for uploaded files |
| Task stuck in `running` | Check the Manus dashboard and retrieve the task via `GET /v1/tasks/{task_id}` |
| Result has no downloaded files | Some tasks only return text; inspect `output[].content[]` first |
