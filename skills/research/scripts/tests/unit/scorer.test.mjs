import assert from "node:assert/strict";
import test from "node:test";

import { createSession } from "../../core/session_schema.mjs";
import { planSession } from "../../core/planner.mjs";
import { advanceStage, scoreSession, updateStopStatus } from "../../core/scorer.mjs";
import { createFixtureAdapters, createTestRuntime } from "../fixtures/provider_fixtures.mjs";

function linkedEvidence(claim, index, stance) {
  return {
    evidence_id: `e-${claim.claim_id}`,
    run_id: "run-1",
    url: `https://official.example.com/${index + 1}`,
    domain: "official.example.com",
    title: `Evidence ${index + 1}`,
    excerpt: stance === "support" ? "Official evidence" : "Official rejection evidence",
    source_type: "official",
    quality: "high",
    retrieval_score: 0.9,
    published_at: "2026-02-01",
    claim_links: [
      {
        claim_id: claim.claim_id,
        stance,
        reason: "Test fixture",
      },
    ],
    provenance: {
      query: claim.text,
      strategy: "test",
      operation_id: null,
      work_item_id: null,
    },
  };
}

test("synthetic planning output does not raise sufficiency metrics", async () => {
  const session = createSession({
    query: "Research the AI coding agent landscape in 2026",
    depth: "deep",
    domains: [],
  });
  await planSession(session, createTestRuntime(session, createFixtureAdapters()));

  scoreSession(session);
  updateStopStatus(session);

  assert.equal(session.scores.claim_coverage_score, 0);
  assert.equal(session.stop_status.decision, "continue");
});

test("advanceStage moves to synthesize only when claim sufficiency is acceptable", async () => {
  const session = createSession({
    query: "Research vendor positioning",
    depth: "standard",
    domains: [],
  });
  await planSession(session, createTestRuntime(session, createFixtureAdapters()));
  const highClaims = session.claims.filter((claim) => claim.priority === "high");
  for (const claim of highClaims) {
    claim.status = "supported";
    claim.evidence_ids = [`e-${claim.claim_id}`];
    claim.verification.status = "completed";
    claim.assessment = {
      ...claim.assessment,
      verdict: "supported",
      sufficiency: "sufficient",
      resolution_state: "resolved",
    };
  }
  session.evidence = highClaims.map((claim, index) => linkedEvidence(claim, index, "support"));

  scoreSession(session);
  updateStopStatus(session);
  advanceStage(session);

  assert.ok(session.work_items.some((item) => item.kind === "synthesize_session"));
  assert.equal(session.stop_status.decision, "stop");
});

test("rejected high-priority claims can still satisfy stop criteria", async () => {
  const session = createSession({
    query: "Is product X certified?",
    depth: "standard",
    domains: [],
  });
  await planSession(session, createTestRuntime(session, createFixtureAdapters()));
  const highClaims = session.claims.filter((claim) => claim.priority === "high");
  for (const claim of highClaims) {
    claim.status = "rejected";
    claim.evidence_ids = [`e-${claim.claim_id}`];
    claim.verification.status = "completed";
    claim.assessment = {
      ...claim.assessment,
      verdict: "rejected",
      sufficiency: "sufficient",
      resolution_state: "resolved",
    };
  }
  session.evidence = highClaims.map((claim, index) => linkedEvidence(claim, index, "oppose"));

  scoreSession(session);
  updateStopStatus(session);
  advanceStage(session);

  assert.equal(session.stop_status.decision, "stop");
  assert.ok(session.work_items.some((item) => item.kind === "synthesize_session"));
});
