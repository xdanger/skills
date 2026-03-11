import assert from "node:assert/strict";
import test from "node:test";

import { createSession } from "../../core/session_schema.mjs";
import { planSession } from "../../core/planner.mjs";
import { createFixtureAdapters, createTestRuntime } from "../fixtures/provider_fixtures.mjs";

test("planSession creates answer-bearing threads and claims for broad research", async () => {
  const session = createSession({
    query: "Research the AI coding agent landscape in 2026",
    depth: "deep",
    domains: [],
  });
  const adapters = createFixtureAdapters();

  await planSession(session, createTestRuntime(session, adapters));

  assert.equal(session.task_shape, "broad");
  assert.ok(session.goal.includes("AI coding agent landscape"));
  assert.ok(session.threads.length >= 4);
  assert.ok(session.claims.every((claim) => claim.text.includes(session.goal)));
  assert.ok(session.work_items.some((item) => item.kind === "gather_thread"));
});

test("Tavily Research contributes only planning artifacts", async () => {
  const session = createSession({
    query: "Research the AI coding agent landscape in 2026",
    depth: "deep",
    domains: [],
  });
  const adapters = createFixtureAdapters();

  await planSession(session, createTestRuntime(session, adapters));

  assert.ok(session.planning_artifacts.hypotheses.length > 0);
  assert.equal(session.evidence.length, 0);
  assert.ok(session.runs.some((run) => run.tool === "research"));
  assert.ok(session.operations.some((operation) => operation.tool === "research"));
});
