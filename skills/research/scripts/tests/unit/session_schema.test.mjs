import assert from "node:assert/strict";
import test from "node:test";

import {
  createSession,
  isRealEvidence,
  nextQueuedWorkItem,
  queueWorkItem,
  upgradeSession,
} from "../../core/session_schema.mjs";
import { legacyV2SessionFixture } from "../fixtures/provider_fixtures.mjs";

test("upgradeSession upgrades a legacy session to v6", () => {
  const upgraded = upgradeSession(legacyV2SessionFixture());

  assert.equal(upgraded.session_version, 6);
  assert.equal(upgraded.task_shape, "verification");
  assert.equal(upgraded.claims.length, 1);
  assert.equal(upgraded.evidence[0].source_type, "synthetic");
  assert.ok(upgraded.evidence[0].attribution);
  assert.equal(upgraded.evidence[0].attribution.attribution_confidence, null);
  assert.ok(Array.isArray(upgraded.findings));
  assert.ok(Array.isArray(upgraded.evidence[0].claim_links));
  assert.ok(Array.isArray(upgraded.work_items));
  assert.equal(isRealEvidence(upgraded.evidence[0]), false);
});

test("createSession seeds the v6 top-level schema", () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });

  assert.equal(session.session_version, 6);
  assert.equal(session.stage, "plan");
  assert.deepEqual(session.constraints.domains, []);
  assert.ok(Array.isArray(session.threads));
  assert.ok(Array.isArray(session.planning_artifacts.hypotheses));
  assert.ok(Array.isArray(session.operations));
  assert.ok(Array.isArray(session.work_items));
  assert.ok(Array.isArray(session.findings));
  assert.equal(session.work_items[0]?.kind, "plan_session");
  assert.ok(Array.isArray(session.entities));
  assert.ok(Array.isArray(session.observations));
  assert.ok(session.research_brief);
  assert.ok(Array.isArray(session.plan_versions));
  assert.ok(Array.isArray(session.activity_history));
  assert.ok(Array.isArray(session.gaps));
});

test("nextQueuedWorkItem respects explicit work item dependencies", () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });
  const parent = session.work_items[0];
  const child = queueWorkItem(session, {
    kind: "verify_claim",
    scopeType: "claim",
    scopeId: "claim-123",
    dependsOn: [parent.work_item_id],
    reason: "Blocked child work item.",
  });

  assert.equal(nextQueuedWorkItem(session)?.work_item_id, parent.work_item_id);
  parent.status = "completed";
  assert.equal(nextQueuedWorkItem(session)?.work_item_id, child.work_item_id);
});
