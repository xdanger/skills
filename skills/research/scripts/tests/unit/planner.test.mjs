import assert from "node:assert/strict";
import test from "node:test";

import { createSession } from "../../core/session_schema.mjs";
import { applyResearchPlan, planSession } from "../../core/planner.mjs";
import { scoreSession, updateStopStatus } from "../../core/scorer.mjs";
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

test("planSession shapes verification claims around the user's actual question", async () => {
  const session = createSession({
    query: "Does OpenAI expose deep research in the API, and if so through which endpoint?",
    depth: "standard",
    domains: [],
  });

  await planSession(session, createTestRuntime(session, createFixtureAdapters()));

  assert.equal(session.task_shape, "verification");
  assert.equal(session.threads[0]?.title, "Direct answer");
  assert.match(session.claims[0]?.text ?? "", /OpenAI exposes deep research in the API\./u);
  assert.ok(session.claims.some((claim) => /endpoint|API surface|mechanism/u.test(claim.text)));
  assert.ok(
    session.threads
      .find((thread) => thread.title === "Concrete API surface")
      ?.subqueries.some((query) => /Responses API/u.test(query)),
  );
  assert.ok(
    session.claims.every(
      (claim) =>
        !/there is official|primary-source evidence that can confirm/iu.test(claim.text),
    ),
  );
});

test("applyResearchPlan lets the agent seed threads and claims directly", () => {
  const session = createSession({
    query: "Research the AI coding agent landscape in 2026",
    depth: "standard",
    domains: [],
  });

  applyResearchPlan(session, {
    task_shape: "broad",
    summary: "Agent-authored plan for a landscape scan.",
    planning_artifacts: {
      comparison_axes: ["workflow", "deployment", "pricing"],
    },
    remaining_gaps: ["Need primary sources for deployment claims."],
    threads: [
      {
        title: "Workflow fit",
        intent: "compare how the products fit different engineering workflows",
        subqueries: ["AI coding agents workflow fit", "AI coding agents team workflows"],
        claims: [
          {
            text: "Leading AI coding agents optimize for different engineering workflows.",
            claim_type: "comparison",
            priority: "high",
            why_it_matters: "Workflow fit is often the deciding factor for adoption.",
          },
        ],
      },
    ],
  });

  assert.equal(session.task_shape, "broad");
  assert.equal(session.threads.length, 1);
  assert.equal(session.claims.length, 1);
  assert.ok(session.work_items.some((item) => item.kind === "gather_thread"));
  assert.deepEqual(session.planning_artifacts.comparison_axes, [
    "workflow",
    "deployment",
    "pricing",
  ]);
  assert.ok(
    session.stop_status.remaining_gaps.includes("Need primary sources for deployment claims."),
  );
});

test("applyResearchPlan rejects invalid task shapes from agent-authored plans", () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });

  assert.throws(
    () =>
      applyResearchPlan(session, {
        task_shape: "unknown-shape",
        threads: [
          {
            title: "Workflow fit",
            intent: "compare workflow fit",
            claims: [{ text: "Vendors differ in workflow fit." }],
          },
        ],
      }),
    /Invalid agent-authored task_shape/u,
  );
});

test("applyResearchPlan skips duplicate plan ids", () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });

  const plan = {
    plan_id: "plan-123",
    task_shape: "broad",
    threads: [
      {
        title: "Workflow fit",
        intent: "compare workflow fit",
        claims: [{ text: "Vendors differ in workflow fit." }],
      },
    ],
  };

  applyResearchPlan(session, plan);
  applyResearchPlan(session, plan, { mode: "append" });

  assert.equal(session.threads.length, 1);
  assert.equal(
    session.decision_log.filter((item) => item.action === "agent_plan_skip").length,
    1,
  );
});

test("applyResearchPlan can apply a structured continuation patch", () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });

  applyResearchPlan(session, {
    task_shape: "broad",
    threads: [
      {
        title: "Workflow fit",
        intent: "compare workflow fit",
        claims: [{ text: "Vendors differ in workflow fit.", priority: "high" }],
      },
    ],
  });

  const existingThread = session.threads[0];
  const existingClaim = session.claims[0];

  applyResearchPlan(
    session,
    {
      continuation_patch: {
        instruction: "Re-check workflow fit and add a deployment angle",
        operations: [
          {
            type: "merge_domains",
            domains: ["docs.example.com"],
          },
          {
            type: "mark_claim_stale",
            claim_id: existingClaim.claim_id,
          },
          {
            type: "requeue_thread",
            thread_id: existingThread.thread_id,
          },
          {
            type: "add_gap",
            gap: "Need fresher deployment evidence.",
          },
          {
            type: "note",
            note: "Prefer official deployment docs.",
          },
          {
            type: "add_thread",
            thread: {
              title: "Deployment",
              intent: "compare deployment models",
              subqueries: ["AI coding agents deployment models"],
              claims: [
                {
                  text: "Deployment models differ across leading vendors.",
                  claim_type: "comparison",
                  priority: "high",
                },
              ],
            },
          },
        ],
      },
    },
    { mode: "append" },
  );

  assert.ok(session.constraints.domains.includes("docs.example.com"));
  assert.equal(existingClaim.verification.stale, true);
  assert.ok(
    session.work_items.some(
      (item) => item.kind === "verify_claim" && item.scope_id === existingClaim.claim_id,
    ),
  );
  assert.ok(
    session.work_items.some(
      (item) => item.kind === "gather_thread" && item.scope_id === existingThread.thread_id,
    ),
  );
  assert.ok(session.threads.some((thread) => thread.title === "Deployment"));
  assert.ok(session.stop_status.remaining_gaps.includes("Need fresher deployment evidence."));
  assert.ok(session.continuations.at(-1)?.operations.length >= 5);
});

test("explicit continuation gaps survive scoring updates", () => {
  const session = createSession({
    query: "Research AI coding agents",
    depth: "standard",
    domains: [],
  });

  applyResearchPlan(session, {
    task_shape: "broad",
    threads: [
      {
        title: "Workflow fit",
        intent: "compare workflow fit",
        claims: [{ text: "Vendors differ in workflow fit.", priority: "high" }],
      },
    ],
  });

  applyResearchPlan(
    session,
    {
      continuation_patch: {
        instruction: "Keep an explicit open gap for enterprise proof points",
        operations: [{ type: "add_gap", gap: "Need stronger enterprise proof points." }],
      },
    },
    { mode: "append" },
  );

  scoreSession(session);
  updateStopStatus(session);

  assert.ok(session.stop_status.remaining_gaps.includes("Need stronger enterprise proof points."));
});
