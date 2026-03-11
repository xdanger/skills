/* global process */

import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureAdapters } from "./tests/fixtures/provider_fixtures.mjs";
import {
  main,
  reopenSessionForContinuation,
  rejoinRemoteResults,
  runOrchestrator,
} from "./research_session.mjs";
import { createSession, queueWorkItem } from "./core/session_schema.mjs";

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
