import assert from "node:assert/strict";
import test from "node:test";

import { inferClaimMatch } from "../../core/retrieval.mjs";

test("inferClaimMatch marks direct positive evidence as support", () => {
  const claim = { text: "Product X is SOC 2 certified" };
  const result = inferClaimMatch(
    claim,
    "The official security page states that Product X is SOC 2 certified and available for enterprise use.",
    "Product X SOC 2 official evidence",
  );

  assert.equal(result.stance, "support");
  assert.match(result.whyMatched, /product|certified/iu);
});

test("inferClaimMatch marks local negative evidence as oppose", () => {
  const claim = { text: "Product X is SOC 2 certified" };
  const result = inferClaimMatch(
    claim,
    "The official compliance page says Product X is not SOC 2 certified at this time.",
    "Product X SOC 2 official evidence",
  );

  assert.equal(result.stance, "oppose");
});

test("inferClaimMatch falls back to context when the claim is not locally grounded", () => {
  const claim = { text: "Product X is SOC 2 certified" };
  const result = inferClaimMatch(
    claim,
    "This page describes pricing tiers and API limits, but not compliance.",
    "Product X official evidence",
  );

  assert.equal(result.stance, "context");
});
