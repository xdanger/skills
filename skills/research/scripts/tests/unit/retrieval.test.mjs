import assert from "node:assert/strict";
import test from "node:test";

import { createSession } from "../../core/session_schema.mjs";
import { planSession } from "../../core/planner.mjs";
import { gatherEvidence, inferQuality, inferSourceType } from "../../core/retrieval.mjs";
import { createFixtureAdapters, createTestRuntime } from "../fixtures/provider_fixtures.mjs";

test("gatherEvidence records candidate filtering and domain budgeting", async () => {
  const adapters = createFixtureAdapters({
    runTavilySearch({ query }) {
      return {
        request_id: "search-budget",
        results: [
          {
            url: "https://official.example.com/a",
            title: "A",
            content: `${query} official`,
            score: 0.95,
          },
          {
            url: "https://official.example.com/b",
            title: "B",
            content: `${query} official second`,
            score: 0.9,
          },
          {
            url: "https://official.example.com/c",
            title: "C",
            content: `${query} official third`,
            score: 0.88,
          },
          {
            url: "https://news.example.com/a",
            title: "News",
            content: `${query} news`,
            score: 0.7,
          },
        ],
      };
    },
  });

  const session = createSession({
    query: "Is product X SOC 2 certified, and what is the evidence?",
    depth: "quick",
    domains: [],
  });
  const runtime = createTestRuntime(session, adapters);
  await planSession(session, runtime);
  const workItem = session.work_items.find((item) => item.kind === "gather_thread");
  await gatherEvidence(session, runtime, workItem);

  assert.ok(session.candidate_urls.some((item) => item.selected));
  assert.ok(session.candidate_urls.some((item) => item.filter_reason === "domain_cap"));
  assert.ok(session.evidence.length > 0);
  assert.ok(session.evidence.every((item) => Array.isArray(item.claim_links)));
});

test("gatherEvidence executes more than the first subquery when fanout allows it", async () => {
  const observedQueries = [];
  const adapters = createFixtureAdapters({
    runTavilySearch({ query }) {
      observedQueries.push(query);
      return {
        request_id: `search-${observedQueries.length}`,
        results: [
          {
            url: `https://official.example.com/${observedQueries.length}`,
            title: `Result ${observedQueries.length}`,
            content: `${query} official`,
            score: 0.9,
          },
        ],
      };
    },
  });

  const session = createSession({
    query: "Research the AI coding agent landscape in 2026",
    depth: "standard",
    domains: [],
  });
  const runtime = createTestRuntime(session, adapters);
  await planSession(session, runtime);
  const workItem = session.work_items.find((item) => item.kind === "gather_thread");
  await gatherEvidence(session, runtime, workItem);

  assert.ok(observedQueries.length > 1);
});

test("inferSourceType keeps news articles distinct from official docs", () => {
  assert.equal(
    inferSourceType(
      "https://techcrunch.com/2025/02/25/why-openai-isnt-bringing-deep-research-to-its-api-just-yet/",
      "Why OpenAI isn't bringing deep research to its API just yet",
      "A reported article about API availability.",
    ),
    "news",
  );
  assert.equal(
    inferSourceType(
      "https://developers.openai.com/api/docs/guides/deep-research/",
      "Deep research | OpenAI API",
      "Official API guide.",
    ),
    "docs",
  );
  assert.equal(
    inferSourceType(
      "https://cookbook.openai.com/examples/deep_research_api/introduction_to_deep_research_api",
      "Introduction to deep research in the OpenAI API",
      "Official cookbook example.",
    ),
    "docs",
  );
  assert.equal(
    inferSourceType(
      "https://community.openai.com/t/plans-for-deep-research-tools-and-the-api/1111030",
      "Plans for Deep Research tools and the API",
      "Forum discussion.",
    ),
    "community",
  );
  assert.equal(
    inferSourceType(
      "https://cobusgreyling.substack.com/p/openai-api-deep-research",
      "OpenAI API Deep Research",
      "Newsletter post.",
    ),
    "community",
  );
  assert.equal(inferQuality("docs"), "high");
  assert.equal(inferQuality("community"), "low");
});
