import assert from "node:assert/strict";
import test from "node:test";

import {
  validateManusCreateTaskResponse,
  validateTavilyExtractResponse,
  validateTavilyMapResponse,
  validateTavilyResearchResponse,
  validateTavilySearchResponse,
} from "../../core/providers.mjs";
import {
  manusCreateTaskSample,
  tavilyExtractSample,
  tavilyMapSample,
  tavilyResearchSample,
  tavilySearchSample,
} from "../fixtures/provider_contract_samples.mjs";

test("validateTavilySearchResponse accepts current live-like search payload", () => {
  const result = validateTavilySearchResponse(tavilySearchSample);

  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].url, "https://openai.com/api/pricing/");
});

test("validateTavilyExtractResponse accepts current live-like extract payload", () => {
  const result = validateTavilyExtractResponse(tavilyExtractSample);

  assert.equal(result.results.length, 1);
  assert.match(result.results[0].raw_content, /GPT-5\.4/u);
});

test("validateTavilyMapResponse accepts current live-like map payload", () => {
  const result = validateTavilyMapResponse(tavilyMapSample);

  assert.equal(result.results.length, 3);
  assert.ok(result.results[0].includes("/pricing"));
});

test("validateTavilyResearchResponse accepts planning-style research payload", () => {
  const result = validateTavilyResearchResponse(tavilyResearchSample);

  assert.equal(result.status, "completed");
  assert.match(result.content, /retrieval augmented generation/i);
});

test("validateManusCreateTaskResponse accepts create-task payload", () => {
  const result = validateManusCreateTaskResponse(manusCreateTaskSample);

  assert.equal(result.task_id, "task_123");
  assert.match(result.task_url, /task_123/u);
});
