/* global process */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createFixtureAdapters } from "./tests/fixtures/provider_fixtures.mjs";
import {
  main,
  reopenSessionForContinuation,
  rejoinRemoteResults,
  runOrchestrator,
} from "./research_session.mjs";
import { applyResearchPlan } from "./core/planner.mjs";
import {
  approvePendingPlan,
  createSession,
  queueWorkItem,
} from "./core/session_schema.mjs";
import { loadSession } from "./core/session_store.mjs";

async function withMutedStdout(fn) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("CLI smoke path keeps public commands stable", async () => {
  await assert.doesNotReject(async () => {
    await withMutedStdout(async () => {
      await main(
        ["start", "--query", "Is product X SOC 2 certified, and what is the evidence?"],
        createFixtureAdapters(),
      );
    });
  });
});

test("CLI accepts an agent-authored plan file on start", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "research-plan-"));
  const planFile = join(tempDir, "plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      task_shape: "verification",
      threads: [
        {
          title: "Direct answer",
          intent: "answer the user's question directly from official sources",
          subqueries: ["product X official SSO docs"],
          claims: [
            {
              text: "Product X supports SSO.",
              claim_type: "fact",
              priority: "high",
            },
          ],
        },
      ],
    }),
  );

  await assert.doesNotReject(async () => {
    await withMutedStdout(async () => {
      await main(
        ["start", "--query", "Does product X support SSO?", "--plan-file", planFile],
        createFixtureAdapters(),
      );
    });
  });
});

test("waiting_remote sessions reopen for continuation", () => {
  const session = createSession({
    query: "Research this market and deliver a CSV with top vendors",
    depth: "standard",
    domains: [],
  });
  session.task_shape = "async";
  session.status = "waiting_remote";
  session.handoff = {
    provider: "manus",
    state: "submitted",
    task_id: "manus-123",
    task_url: "https://manus.example/tasks/123",
    profile: "manus-1.6",
    reason: "artifact-heavy or connector-backed async task",
    interactive_mode: false,
    locale: "en-US",
    rejoin_contract: {
      schema_version: 1,
      accepted_formats: ["json"],
      guidance: "Return evidence.",
    },
    remote_summary: null,
    rejoined_at: null,
  };

  reopenSessionForContinuation(session, "Respond to the async follow-up");

  assert.equal(session.status, "open");
  assert.equal(session.stage, "plan");
});

test("remote rejoin imports evidence and resumes local work", async () => {
  const session = createSession({
    query: "Research this market and deliver a CSV with top vendors",
    depth: "standard",
    domains: [],
  });

  await runOrchestrator(session, createFixtureAdapters(), 6);
  assert.equal(session.status, "waiting_remote");

  const targetClaim = session.claims[0];
  rejoinRemoteResults(session, {
    summary: "Remote worker returned URL-backed evidence.",
    evidence: [
      {
        url: "https://official.example.com/vendors",
        title: "Vendor list",
        excerpt: "The official page lists the supported vendors.",
        source_type: "official",
        quality: "high",
        claim_links: [
          {
            claim_id: targetClaim.claim_id,
            stance: "support",
            reason: "The page directly supports the async claim.",
          },
        ],
      },
    ],
    remaining_gaps: ["Need a CSV artifact export."],
  });

  assert.ok(
    session.work_items.some(
      (item) => item.kind === "rejoin_handoff" && item.scope_id === session.session_id,
    ),
  );
  await runOrchestrator(session, createFixtureAdapters(), 6);

  assert.equal(session.handoff?.state, "rejoined");
  assert.equal(session.status, "completed");
  assert.ok(session.evidence.length > 0);
  assert.ok(
    session.evidence[0].claim_links.some((link) => link.claim_id === targetClaim.claim_id),
  );
  assert.ok(session.observations.length > 0);
});

test("completed local sessions reopen and resync the next queued stage", () => {
  const session = createSession({
    query: "Research vendor positioning",
    depth: "standard",
    domains: [],
  });
  session.task_shape = "broad";
  session.status = "completed";
  session.stage = "synthesize";
  queueWorkItem(session, {
    kind: "gather_thread",
    scopeType: "thread",
    scopeId: "thread-123",
    continuationId: "continuation-123",
    reason: "Follow-up gather pass.",
  });

  reopenSessionForContinuation(session, "Dig deeper on pricing");

  assert.equal(session.status, "open");
  assert.equal(session.stage, "plan");
});

test("pending approval sessions do not execute queued work", async () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
    approvalMode: "pending",
  });

  await runOrchestrator(session, createFixtureAdapters(), 6);

  assert.equal(session.work_items[0]?.status, "completed");
  assert.equal(session.stop_status.decision, "review");
  assert.equal(session.plan_state.pending_plan_version_id !== null, true);

  approvePendingPlan(session);
  await runOrchestrator(session, createFixtureAdapters(), 6);

  assert.ok(session.work_items.some((item) => item.kind === "gather_thread"));
});

test("approved agent-authored pending plans survive resume", async () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
    approvalMode: "pending",
  });

  applyResearchPlan(session, {
    task_shape: "broad",
    threads: [
      {
        title: "Enterprise rollout",
        intent: "inspect rollout and enterprise adoption proof points",
        subqueries: ["AI coding agents enterprise rollout"],
        claims: [
          {
            text: "Enterprise rollout patterns differ across the leading AI coding agents.",
            claim_type: "comparison",
            priority: "high",
          },
        ],
      },
    ],
    remaining_gaps: ["Need stronger enterprise proof points."],
  });

  await runOrchestrator(session, createFixtureAdapters(), 6);

  assert.equal(session.stop_status.decision, "review");
  assert.ok(session.threads.some((thread) => thread.title === "Enterprise rollout"));

  approvePendingPlan(session);
  await runOrchestrator(session, createFixtureAdapters(), 6);

  assert.ok(session.threads.some((thread) => thread.title === "Enterprise rollout"));
  assert.ok(session.work_items.some((item) => item.kind === "gather_thread"));
});

test("continue is blocked while a plan approval is pending", async () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
    approvalMode: "pending",
  });

  await runOrchestrator(session, createFixtureAdapters(), 6);

  await assert.rejects(
    () =>
      withMutedStdout(async () => {
        await main(
          [
            "continue",
            "--session-id",
            session.session_id,
            "--instruction",
            "Dig deeper on pricing",
          ],
          createFixtureAdapters(),
        );
      }),
    /pending plan approval/u,
  );
});

test("structured continuation patches are blocked while a plan approval is pending", async () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
    approvalMode: "pending",
  });

  await runOrchestrator(session, createFixtureAdapters(), 6);

  const tempDir = mkdtempSync(join(tmpdir(), "research-pending-patch-"));
  const patchFile = join(tempDir, "patch.json");
  writeFileSync(
    patchFile,
    JSON.stringify({
      continuation_patch: {
        instruction: "Add a pricing thread",
        operations: [
          {
            type: "add_thread",
            thread: {
              title: "Pricing",
              intent: "compare pricing models",
              subqueries: ["AI coding agents pricing"],
              claims: [
                {
                  text: "Pricing models differ across the leading AI coding agents.",
                  claim_type: "comparison",
                  priority: "high",
                },
              ],
            },
          },
        ],
      },
    }),
  );

  await assert.rejects(
    () =>
      withMutedStdout(async () => {
        await main(
          ["continue", "--session-id", session.session_id, "--plan-file", patchFile],
          createFixtureAdapters(),
        );
      }),
    /pending plan approval/u,
  );
});

test("continue can append an agent-authored follow-up plan", async () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });
  await runOrchestrator(session, createFixtureAdapters(), 6);

  const tempDir = mkdtempSync(join(tmpdir(), "research-continue-plan-"));
  const planFile = join(tempDir, "followup.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      threads: [
        {
          title: "Enterprise rollout",
          intent: "inspect rollout and enterprise adoption proof points",
          subqueries: ["AI coding agents enterprise rollout"],
          claims: [
            {
              text: "Enterprise rollout patterns differ across the leading AI coding agents.",
              claim_type: "comparison",
              priority: "high",
            },
          ],
        },
      ],
      remaining_gaps: ["Need stronger enterprise proof points."],
    }),
  );

  await withMutedStdout(async () => {
    await main(
      ["continue", "--session-id", session.session_id, "--plan-file", planFile],
      createFixtureAdapters(),
    );
  });

  const updated = loadSession(session.session_id);
  assert.ok(updated.threads.some((thread) => thread.title === "Enterprise rollout"));
});

test("continue can apply a structured continuation patch file", async () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });
  await runOrchestrator(session, createFixtureAdapters(), 6);

  const targetClaim = session.claims[0];
  const targetThread = session.threads[0];
  const tempDir = mkdtempSync(join(tmpdir(), "research-continue-patch-"));
  const patchFile = join(tempDir, "patch.json");
  writeFileSync(
    patchFile,
    JSON.stringify({
      continuation_patch: {
        instruction: "Re-check workflow fit and add deployment",
        operations: [
          { type: "merge_domains", domains: ["docs.example.com"] },
          { type: "mark_claim_stale", claim_id: targetClaim.claim_id },
          { type: "requeue_thread", thread_id: targetThread.thread_id },
          {
            type: "add_thread",
            thread: {
              title: "Deployment",
              intent: "inspect deployment models",
              subqueries: ["AI coding agents deployment models"],
              claims: [
                {
                  text: "Deployment models differ across leading AI coding agents.",
                  claim_type: "comparison",
                  priority: "high",
                },
              ],
            },
          },
        ],
      },
    }),
  );

  await withMutedStdout(async () => {
    await main(
      ["continue", "--session-id", session.session_id, "--plan-file", patchFile],
      createFixtureAdapters(),
    );
  });

  const updated = loadSession(session.session_id);
  assert.ok(updated.constraints.domains.includes("docs.example.com"));
  assert.ok(updated.threads.some((thread) => thread.title === "Deployment"));
  assert.ok(updated.continuations.at(-1)?.operations.length >= 3);
});
