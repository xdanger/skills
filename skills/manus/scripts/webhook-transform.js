import { createHash, createVerify } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const OPENCLAW_HOME = join(homedir(), ".openclaw");
const PUBKEY_CACHE = join(OPENCLAW_HOME, "cache", "manus-webhook-pubkey.pem");
const REGISTRY_PATH = join(OPENCLAW_HOME, "cache", "manus-tasks.json");
const PUBKEY_TTL_MS = 60 * 60 * 1000; // 1 hour
const TIMESTAMP_TOLERANCE_S = 300; // 5 minutes

let cachedPubKey = null;
let cachedPubKeyAt = 0;

function loadPubKey() {
  const now = Date.now();
  if (cachedPubKey && now - cachedPubKeyAt < PUBKEY_TTL_MS) {
    return cachedPubKey;
  }
  if (existsSync(PUBKEY_CACHE)) {
    try {
      cachedPubKey = readFileSync(PUBKEY_CACHE, "utf8");
      cachedPubKeyAt = now;
      return cachedPubKey;
    } catch { /* fall through */ }
  }
  return null;
}

function savePubKey(pem) {
  const dir = dirname(PUBKEY_CACHE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(PUBKEY_CACHE, pem, "utf8");
  cachedPubKey = pem;
  cachedPubKeyAt = Date.now();
}

async function fetchPubKey(apiKey) {
  const resp = await fetch("https://api.manus.ai/v1/webhook/public_key", {
    headers: { API_KEY: apiKey },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const pem = data.public_key;
  if (pem) savePubKey(pem);
  return pem;
}

function verifySignature(ctx, pubKeyPem) {
  const headers = ctx.headers || {};
  const signature = headers["x-webhook-signature"] || headers["X-Webhook-Signature"];
  const timestamp = headers["x-webhook-timestamp"] || headers["X-Webhook-Timestamp"];

  if (!signature || !timestamp) return false;

  // Check timestamp tolerance
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_TOLERANCE_S) return false;

  // Build signature content
  const rawBody =
    typeof ctx.rawBody === "string"
      ? ctx.rawBody
      : Buffer.isBuffer(ctx.rawBody)
        ? ctx.rawBody.toString("utf8")
        : null;
  if (!rawBody) return false;
  const url = ctx.url || "";
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const sigContent = `${timestamp}.${url}.${bodyHash}`;
  const contentHash = createHash("sha256").update(sigContent, "utf8").digest();

  // RSA-SHA256 verify
  const verifier = createVerify("RSA-SHA256");
  verifier.update(contentHash);
  try {
    return verifier.verify(pubKeyPem, signature, "base64");
  } catch {
    return false;
  }
}

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return {};
  }
}

function updateRegistryStatus(taskId, status) {
  const reg = loadRegistry();
  if (reg[taskId]) {
    reg[taskId].status = status;
    mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), "utf8");
  }
}

export async function transformManus(ctx) {
  const payload = ctx?.payload ?? {};
  const eventType = payload.event_type;

  // Suppress non-terminal events
  if (eventType === "task_created" || eventType === "task_progress") {
    return null;
  }

  // Only process task_stopped
  if (eventType !== "task_stopped") {
    return null;
  }

  // Signature verification
  const apiKey = process.env.MANUS_API_KEY || "";
  let pubKey = loadPubKey();
  if (!pubKey && apiKey) {
    pubKey = await fetchPubKey(apiKey);
  }

  if (pubKey) {
    const valid = verifySignature(ctx, pubKey);
    if (!valid) {
      // Signature verification failed — silently discard
      return null;
    }
  }
  // If no pubKey available, proceed without verification (first-time setup)

  // Extract task info and route to session
  const taskDetail = payload.task_detail || {};
  const taskId = taskDetail.task_id || "";
  const registry = loadRegistry();
  const entry = registry[taskId];

  if (!entry) {
    // Unknown task — no session routing possible
    return null;
  }

  // Update status in registry
  const isAsk = taskDetail.stop_reason === "ask";
  updateRegistryStatus(taskId, isAsk ? "ask" : "completed");

  // Build the agent message directly — gateway templates are rendered before
  // transforms run, so we must return `message` and `sessionKey` as direct
  // field overrides (mergeAction), not template variables.
  const lines = [`🤖 Manus 任务完成`];
  if (taskDetail.task_title) lines.push(`\nTask: ${taskDetail.task_title}`);
  if (taskDetail.task_url) lines.push(`URL: ${taskDetail.task_url}`);
  if (taskDetail.message) lines.push(`\n${taskDetail.message}`);
  if (taskDetail.attachments?.length) {
    lines.push(`\n附件 (${taskDetail.attachments.length} 个):`);
    for (const a of taskDetail.attachments) {
      lines.push(`- ${a.file_name} (${a.url})`);
    }
  }
  lines.push(`\n请处理：`);
  lines.push(`1. 有附件则用 manus skill 的 result 命令下载到 ~/.openclaw/media/${new Date().toISOString().slice(0, 7).replace("-", "")}/ 并发送给用户`);
  lines.push(`2. 用中文总结结果`);
  if (isAsk) {
    lines.push(`3. stop_reason 为 ask — 转达 Manus 的问题给用户，等用户回复后用 --task-id ${taskId} 继续任务`);
  }

  return {
    sessionKey: entry.session_key,
    message: lines.join("\n"),
  };
}
