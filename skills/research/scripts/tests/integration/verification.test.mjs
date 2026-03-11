import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureAdapters } from "../fixtures/provider_fixtures.mjs";
import { createSession } from "../../core/session_schema.mjs";
import { runOrchestrator } from "../../research_session.mjs";
import { summarizeReport } from "../../core/synthesizer.mjs";

test("verification flow creates claim-level evidence and stop reasons", async () => {
  const session = createSession({
    query: "Is product X SOC 2 certified, and what is the evidence?",
    depth: "standard",
    domains: ["example.com"],
  });

  await runOrchestrator(session, createFixtureAdapters(), 12);

  assert.equal(session.task_shape, "verification");
  assert.ok(session.evidence.length > 0);
  assert.ok(
    session.evidence.every(
      (item) =>
        Array.isArray(item.claim_links) &&
        item.claim_links.every(
          (link) =>
            link.claim_id &&
            ["support", "oppose", "context"].includes(link.stance) &&
            link.reason,
        ),
    ),
  );
  assert.ok(session.stop_status.reason.length > 0);
  assert.ok(
    session.claims.every(
      (claim) =>
        claim.assessment &&
        claim.assessment.verdict &&
        claim.assessment.sufficiency &&
        Array.isArray(claim.assessment.missing_dimensions),
    ),
  );
});

test("negative but resolved answers appear in the final synthesis", async () => {
  const adapters = createFixtureAdapters({
    runTavilySearch({ query }) {
      return {
        request_id: "negative-search",
        results: [
          {
            url: "https://official.example.com/no",
            title: "Official no",
            content: `${query} is not supported`,
            score: 0.95,
          },
        ],
      };
    },
    runTavilyExtract({ urls, query }) {
      return {
        request_id: "negative-extract",
        results: urls.map((url) => ({
          url,
          title: url,
          raw_content: `${query} is not supported by the official source`,
          published_date: "2026-02-01",
        })),
      };
    },
  });

  const session = createSession({
    query: "Is product X certified?",
    depth: "standard",
    domains: ["example.com"],
  });

  await runOrchestrator(session, adapters, 12);
  const report = summarizeReport(session);

  assert.equal(session.status, "completed");
  assert.match(report, /Rejected:/u);
});
