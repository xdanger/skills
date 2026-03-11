import {
  appendDecision,
  createId,
  getClaimById,
  getThreadById,
  isoNow,
  queueWorkItem,
  upsertEntity,
  upsertObservation,
  uniqueBy,
} from "./session_schema.mjs";
import { depthProfile, shouldUseCrawl } from "./router.mjs";
import { URL } from "node:url";

const CLAIM_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "there",
  "official",
  "primary",
  "source",
  "evidence",
  "confirm",
  "qualify",
  "reject",
]);

function sentenceSplit(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function capitalizeWords(text) {
  return String(text)
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function entityNameFromUrl(url, title = "") {
  const host = domainFromUrl(url);
  const parts = host
    .split(".")
    .filter(Boolean)
    .filter((part) => !["www", "official", "docs", "developer", "api"].includes(part));
  if (parts.length > 0) {
    return capitalizeWords(parts[0].replace(/-/gu, " "));
  }
  const titleLead = String(title).split(/[-|:]/u)[0]?.trim();
  return titleLead || "Unknown entity";
}

export function inferSourceType(url, title = "", snippet = "") {
  const host = domainFromUrl(url);
  const text = `${host} ${title} ${snippet}`.toLowerCase();
  if (/^(official|docs|developer)\./u.test(host)) {
    return host.startsWith("official.") ? "official" : "docs";
  }
  if (host.endsWith(".gov")) {
    return "official";
  }
  if (host.endsWith(".edu") || host.includes("arxiv.org")) {
    return "academic";
  }
  if (/docs|developer|api|reference|sdk|manual/.test(text)) {
    return "docs";
  }
  if (
    /(reuters\.com|bloomberg\.com|nytimes\.com|theverge\.com|techcrunch\.com|wired\.com|news)/.test(
      text,
    )
  ) {
    return "news";
  }
  if (/(reddit\.com|github\.com|news\.ycombinator\.com|medium\.com|substack\.com)/.test(text)) {
    return "community";
  }
  return "vendor";
}

export function inferQuality(sourceType) {
  if (sourceType === "official" || sourceType === "docs" || sourceType === "academic") {
    return "high";
  }
  if (sourceType === "news" || sourceType === "vendor") {
    return "medium";
  }
  return "low";
}

function primarySourceWeight(sourceType) {
  if (sourceType === "official" || sourceType === "docs" || sourceType === "academic") {
    return 2;
  }
  if (sourceType === "news") {
    return 1;
  }
  return 0;
}

function claimTokens(claimText) {
  return String(claimText)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 2 && !CLAIM_STOP_WORDS.has(token));
}

export function inferClaimMatch(claim, snippet, query) {
  const tokens = claimTokens(claim.text);
  const sentences = sentenceSplit(snippet);
  const evaluated = (sentences.length > 0 ? sentences : [String(snippet)]).map((sentence) => {
    const lowered = sentence.toLowerCase();
    const matched = tokens.filter((token) => lowered.includes(token));
    return {
      sentence,
      matched,
      score: matched.length,
    };
  });
  const best = evaluated.sort((left, right) => right.score - left.score)[0];
  if (!best || best.score === 0) {
    return {
      stance: "context",
      whyMatched: `Thread/query context matched claim through "${query}", but no direct claim tokens were found.`,
    };
  }

  const negativePattern =
    /\b(no|not|without|lack|lacks|is not|isn't|does not|doesn't|unavailable|deprecated|cannot|can't)\b/i;
  const positivePattern =
    /\b(available|supported|includes|provides|offers|documents|listed|shows|states|certified|enabled)\b/i;
  let stance = "context";
  if (negativePattern.test(best.sentence)) {
    stance = "oppose";
  } else if (positivePattern.test(best.sentence) || best.score >= Math.min(2, tokens.length)) {
    stance = "support";
  }
  return {
    stance,
    whyMatched: `Matched claim tokens [${best.matched.join(", ")}] in sentence "${best.sentence.slice(0, 180)}" from query "${query}".`,
  };
}

function buildCandidateUrl(
  threadId,
  query,
  result,
  selected,
  filterReason,
  operationId,
  workItemId,
) {
  const sourceType = inferSourceType(
    result.url ?? "",
    result.title ?? "",
    result.content ?? "",
  );
  return {
    candidate_id: createId("candidate"),
    thread_id: threadId,
    query,
    url: result.url ?? "",
    title: result.title ?? result.url ?? "Untitled result",
    domain: domainFromUrl(result.url ?? ""),
    search_score: typeof result.score === "number" ? result.score : null,
    source_type: sourceType,
    selected,
    filter_reason: filterReason,
    operation_id: operationId,
    work_item_id: workItemId,
  };
}

function selectCandidates(rawResults, profile) {
  const sorted = [...rawResults].sort((left, right) => {
    const leftScore = (left.score ?? 0) + primarySourceWeight(left.sourceType) * 0.1;
    const rightScore = (right.score ?? 0) + primarySourceWeight(right.sourceType) * 0.1;
    return rightScore - leftScore;
  });

  const selected = [];
  const rejected = [];
  const domainCounts = new Map();

  const primaryCandidates = sorted.filter(
    (item) =>
      (item.score ?? 0) >= profile.minScore &&
      primarySourceWeight(item.sourceType) > 0 &&
      item.url,
  );

  if (primaryCandidates.length > 0) {
    const firstPrimary = primaryCandidates[0];
    selected.push(firstPrimary);
    domainCounts.set(firstPrimary.domain, 1);
  }

  for (const result of sorted) {
    if (selected.length >= profile.extractLimit) {
      rejected.push({
        ...result,
        filterReason: "budget_exceeded",
      });
      continue;
    }

    if ((result.score ?? 0) < profile.minScore) {
      rejected.push({
        ...result,
        filterReason: "low_score",
      });
      continue;
    }

    if (selected.some((item) => item.url === result.url)) {
      continue;
    }

    const domainCount = domainCounts.get(result.domain) ?? 0;
    if (domainCount >= profile.domainCap) {
      rejected.push({
        ...result,
        filterReason: "domain_cap",
      });
      continue;
    }

    selected.push(result);
    domainCounts.set(result.domain, domainCount + 1);
  }

  return { selected, rejected };
}

function extractDate(result) {
  return result.published_date ?? result.date ?? result.created_at ?? null;
}

function mergeCandidateUrls(session, candidates) {
  session.candidate_urls = uniqueBy(
    [...session.candidate_urls, ...candidates],
    (item) => `${item.thread_id}|${item.query}|${item.url}|${item.filter_reason}`,
  );
}

function mergeEvidence(session, evidenceItems) {
  session.evidence = uniqueBy(
    [...session.evidence, ...evidenceItems],
    (item) =>
      `${item.url}|${item.title}|${item.excerpt}|${item.claim_links
        .map((link) => `${link.claim_id}:${link.stance}`)
        .join(",")}`,
  );
}

function claimsForThread(session, threadId) {
  const thread = getThreadById(session, threadId);
  return (thread?.claim_ids ?? [])
    .map((claimId) => getClaimById(session, claimId))
    .filter(Boolean);
}

function buildClaimLinks(claims, snippet, query) {
  const links = claims.map((claim) => {
    const match = inferClaimMatch(claim, snippet, query);
    return {
      claim_id: claim.claim_id,
      stance: match.stance,
      reason: match.whyMatched,
    };
  });
  const directLinks = links.filter((link) => link.stance !== "context");
  return directLinks.length > 0 ? directLinks : links.slice(0, 1);
}

function buildEvidenceRecord({
  runId,
  operationId,
  workItemId,
  claims,
  item,
  query,
  strategy,
  searchScore = null,
}) {
  const excerpt = item.raw_content ?? item.content ?? "";
  const sourceType = inferSourceType(item.url ?? "", item.title ?? "", excerpt);
  return {
    evidence_id: createId("evidence"),
    run_id: runId,
    url: item.url ?? "",
    domain: domainFromUrl(item.url ?? ""),
    title: item.title ?? item.url ?? "Untitled evidence",
    excerpt,
    source_type: sourceType,
    quality: inferQuality(sourceType),
    retrieval_score: searchScore,
    published_at: extractDate(item),
    claim_links: buildClaimLinks(claims, excerpt, query),
    provenance: {
      query,
      strategy,
      operation_id: operationId,
      work_item_id: workItemId,
    },
  };
}

function observationText(excerpt, maxLength = 180) {
  const text = String(excerpt).replace(/\s+/gu, " ").trim();
  if (!text) {
    return "No observation text extracted.";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function recordEvidenceStructures(session, thread, evidenceItems) {
  for (const item of evidenceItems) {
    const entity = upsertEntity(session, {
      canonical_name: entityNameFromUrl(item.url, item.title),
      display_name: entityNameFromUrl(item.url, item.title),
      entity_type: session.task_shape === "broad" ? "vendor" : "subject",
      domains: item.domain ? [item.domain] : [],
      source_evidence_ids: [item.evidence_id],
      notes: [`Derived from evidence in thread "${thread.title}".`],
    });
    const primaryClaimLink =
      item.claim_links.find((link) => link.stance !== "context") ?? item.claim_links[0] ?? null;
    upsertObservation(session, {
      entity_id: entity.entity_id,
      thread_id: thread.thread_id,
      claim_id: primaryClaimLink?.claim_id ?? null,
      evidence_id: item.evidence_id,
      facet: thread.title,
      text: observationText(item.excerpt),
      source_url: item.url,
      source_type: item.source_type,
      quality: item.quality,
      published_at: item.published_at,
    });
  }
}

async function gatherSearchExtractEvidence(session, runtime, thread, workItem, profile) {
  const queryPlans = thread.subqueries.length > 0 ? thread.subqueries : [session.goal];
  const selectedGroups = [];

  for (const query of queryPlans.slice(0, profile.searchFanout)) {
    const { operation, result } = await runtime.runProviderOperation(
      {
        provider: "tavily",
        tool: "search",
        inputSummary: query,
        scopeType: "thread",
        scopeId: thread.thread_id,
        workItemId: workItem.work_item_id,
      },
      () =>
        runtime.adapters.runTavilySearch({
          query,
          depth: profile.searchDepth,
          domains: session.constraints.domains,
          timeRange: session.constraints.time_range,
          country: session.constraints.country,
        }),
    );

    const searchResults = (result.results || []).map((searchResult) => ({
      ...searchResult,
      domain: domainFromUrl(searchResult.url ?? ""),
      sourceType: inferSourceType(
        searchResult.url ?? "",
        searchResult.title ?? "",
        searchResult.content ?? "",
      ),
    }));
    const { selected, rejected } = selectCandidates(searchResults, profile);
    mergeCandidateUrls(session, [
      ...selected.map((item) =>
        buildCandidateUrl(
          thread.thread_id,
          query,
          item,
          true,
          "selected",
          operation.operation_id,
          workItem.work_item_id,
        ),
      ),
      ...rejected.map((item) =>
        buildCandidateUrl(
          thread.thread_id,
          query,
          item,
          false,
          item.filterReason ?? "filtered",
          operation.operation_id,
          workItem.work_item_id,
        ),
      ),
    ]);
    selectedGroups.push({ query, selected });
  }

  const claims = claimsForThread(session, thread.thread_id);
  for (const group of selectedGroups) {
    if (group.selected.length === 0 || claims.length === 0) {
      continue;
    }

    const { operation, run, result } = await runtime.runProviderOperation(
      {
        provider: "tavily",
        tool: "extract",
        inputSummary: `Extract selected URLs for ${thread.title}`,
        scopeType: "thread",
        scopeId: thread.thread_id,
        workItemId: workItem.work_item_id,
      },
      () =>
        runtime.adapters.runTavilyExtract({
          urls: group.selected.map((item) => item.url),
          query: group.query,
        }),
    );

    const evidenceItems = (result.results || []).map((item) =>
      buildEvidenceRecord({
        runId: run.run_id,
        operationId: operation.operation_id,
        workItemId: workItem.work_item_id,
        claims,
        item,
        query: group.query,
        strategy: "search_extract",
        searchScore:
          group.selected.find((selected) => selected.url === item.url)?.score ?? null,
      }),
    );
    mergeEvidence(session, evidenceItems);
    recordEvidenceStructures(session, thread, evidenceItems);
  }
}

async function gatherSiteEvidence(session, runtime, thread, workItem, profile) {
  const targetUrlMatch = session.user_query.match(/https?:\/\/\S+/u);
  const targetUrl = targetUrlMatch
    ? targetUrlMatch[0].replace(/[),.]$/u, "")
    : session.constraints.domains[0]
      ? `https://${session.constraints.domains[0]}`
      : null;
  if (!targetUrl) {
    appendDecision(
      session,
      "gather",
      "Skipped site retrieval because no explicit URL was provided for a site-focused thread.",
      { thread_id: thread.thread_id },
    );
    return;
  }

  const claims = claimsForThread(session, thread.thread_id);
  const { operation: mapOperation, result: mapResult } = await runtime.runProviderOperation(
    {
      provider: "tavily",
      tool: "map",
      inputSummary: targetUrl,
      scopeType: "thread",
      scopeId: thread.thread_id,
      workItemId: workItem.work_item_id,
    },
    () =>
      runtime.adapters.runTavilyMap({
        url: targetUrl,
        instructions: thread.intent || session.goal,
        depth: session.constraints.depth,
      }),
  );

  const mapped = (mapResult.results || [])
    .slice(0, profile.extractLimit * 2)
    .map((url, index) => ({
      url,
      title: url,
      domain: domainFromUrl(url),
      score: Math.max(0.4, 0.9 - index * 0.1),
      sourceType: inferSourceType(url, url, ""),
    }));
  const { selected, rejected } = selectCandidates(mapped, profile);
  mergeCandidateUrls(session, [
    ...selected.map((item) =>
      buildCandidateUrl(
        thread.thread_id,
        thread.subqueries[0] ?? session.goal,
        item,
        true,
        "selected",
        mapOperation.operation_id,
        workItem.work_item_id,
      ),
    ),
    ...rejected.map((item) =>
      buildCandidateUrl(
        thread.thread_id,
        thread.subqueries[0] ?? session.goal,
        item,
        false,
        item.filterReason ?? "filtered",
        mapOperation.operation_id,
        workItem.work_item_id,
      ),
    ),
  ]);

  const selectedUrls = selected.map((item) => item.url);
  if (selectedUrls.length === 0 || claims.length === 0) {
    return;
  }

  if (shouldUseCrawl(session)) {
    const { operation, run, result } = await runtime.runProviderOperation(
      {
        provider: "tavily",
        tool: "crawl",
        inputSummary: `Crawl selected paths for ${thread.title}`,
        scopeType: "thread",
        scopeId: thread.thread_id,
        workItemId: workItem.work_item_id,
      },
      () =>
        runtime.adapters.runTavilyCrawl({
          url: targetUrl,
          instructions: thread.intent,
          depth: session.constraints.depth,
          selectPaths: selectedUrls.map((url) => {
            try {
              return new URL(url).pathname;
            } catch {
              return url;
            }
          }),
        }),
    );

    const evidenceItems = (result.results || []).map((item) =>
      buildEvidenceRecord({
        runId: run.run_id,
        operationId: operation.operation_id,
        workItemId: workItem.work_item_id,
        claims,
        item,
        query: thread.subqueries[0] ?? session.goal,
        strategy: "site_crawl",
      }),
    );
    mergeEvidence(session, evidenceItems);
    recordEvidenceStructures(session, thread, evidenceItems);
    return;
  }

  const { operation, run, result } = await runtime.runProviderOperation(
    {
      provider: "tavily",
      tool: "extract",
      inputSummary: `Extract mapped URLs for ${thread.title}`,
      scopeType: "thread",
      scopeId: thread.thread_id,
      workItemId: workItem.work_item_id,
    },
    () =>
      runtime.adapters.runTavilyExtract({
        urls: selectedUrls,
        query: thread.subqueries[0] ?? session.goal,
      }),
  );
  const evidenceItems = (result.results || []).map((item) =>
    buildEvidenceRecord({
      runId: run.run_id,
      operationId: operation.operation_id,
      workItemId: workItem.work_item_id,
      claims,
      item,
      query: thread.subqueries[0] ?? session.goal,
      strategy: "site_extract",
    }),
  );
  mergeEvidence(session, evidenceItems);
  recordEvidenceStructures(session, thread, evidenceItems);
}

export async function gatherEvidence(session, runtime, workItem) {
  const profile = depthProfile(session.constraints.depth);
  const thread = getThreadById(session, workItem.scope_id);
  if (!thread) {
    appendDecision(session, "gather", "Skipped missing thread work item.", {
      work_item_id: workItem.work_item_id,
    });
    return;
  }

  thread.execution.gather_status = "in_progress";
  const hasScopedSiteTarget =
    /(https?:\/\/|www\.)/.test(session.user_query) || session.constraints.domains.length > 0;

  if (session.task_shape === "site" && !hasScopedSiteTarget) {
    appendDecision(
      session,
      "gather",
      "Skipped site retrieval because no explicit URL or domain scope was provided.",
      { thread_id: thread.thread_id },
    );
    thread.execution.gather_status = "blocked";
    return;
  }

  if (session.task_shape === "site") {
    await gatherSiteEvidence(session, runtime, thread, workItem, profile);
  } else {
    await gatherSearchExtractEvidence(session, runtime, thread, workItem, profile);
  }

  thread.execution.gather_status = "gathered";
  thread.execution.gather_rounds += 1;
  thread.execution.last_gathered_at = isoNow();

  for (const claimId of thread.claim_ids) {
    const claim = getClaimById(session, claimId);
    if (!claim || claim.priority !== "high") {
      continue;
    }
    claim.verification.status = "queued";
    queueWorkItem(session, {
      kind: "verify_claim",
      scopeType: "claim",
      scopeId: claim.claim_id,
      continuationId: workItem.continuation_id ?? null,
      reason: `Gathered new evidence for thread ${thread.title}; verify claim ${claim.text}.`,
      dependsOn: [workItem.work_item_id],
    });
  }

  appendDecision(session, "gather", "Gathered evidence for a thread work item.", {
    thread_id: thread.thread_id,
    work_item_id: workItem.work_item_id,
    gather_round: thread.execution.gather_rounds,
  });
}
