import {
  appendDecision,
  createId,
  ensureArray,
  fail,
  getThreadById,
  mergeUniqueStrings,
  queueWorkItem,
  recordDeltaPlan,
  recordPlanVersion,
  syncSessionStage,
  upsertGap,
  uniqueBy,
} from "./session_schema.mjs";
import { classifyTaskShape, normalizeGoal } from "./router.mjs";

const VALID_TASK_SHAPES = new Set(["broad", "verification", "site", "async"]);

function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function domainsFromText(text) {
  return mergeUniqueStrings(
    [],
    (String(text).match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/giu) || []).map((item) =>
      item.replace(/^www\./u, "").toLowerCase(),
    ),
  );
}

function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 2),
  );
}

function overlapScore(leftText, rightText) {
  const left = tokenize(leftText);
  const right = tokenize(rightText);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of left) {
    if (right.has(token)) {
      matches += 1;
    }
  }
  return matches;
}

function defaultComparisonAxes(taskShape) {
  if (taskShape === "broad") {
    return ["pricing", "deployment", "security", "adoption", "workflow"];
  }
  if (taskShape === "site") {
    return ["coverage", "policy", "documentation", "limitations"];
  }
  return ["claim", "official evidence", "caveats"];
}

function createThread(title, intent, subqueries, notes = "") {
  return {
    thread_id: createId("thread"),
    title,
    intent,
    subqueries,
    claim_ids: [],
    notes,
    execution: {
      gather_status: "queued",
      verify_status: "queued",
      gather_rounds: 0,
      last_gathered_at: null,
      last_verified_at: null,
      open_claim_ids: [],
      last_continuation_id: null,
    },
  };
}

function createClaim(threadId, text, claimType, priority, answerRelevance = "high") {
  return {
    claim_id: createId("claim"),
    thread_id: threadId,
    text,
    claim_type: claimType,
    answer_relevance: answerRelevance,
    priority,
    status: "open",
    why_it_matters: "",
    evidence_ids: [],
    verification: {
      status: "queued",
      attempts: 0,
      stale: false,
      last_checked_at: null,
      last_continuation_id: null,
    },
    assessment: {
      verdict: "unproven",
      sufficiency: "unassessed",
      resolution_state: "unassessed",
      support_evidence_ids: [],
      oppose_evidence_ids: [],
      context_evidence_ids: [],
      primary_evidence_ids: [],
      missing_dimensions: [],
      reason: "",
      confidence_label: "low",
      last_evaluated_at: null,
    },
  };
}

function createClaimFromSpec(threadId, spec = {}) {
  const text = String(spec.text ?? "").trim();
  if (!text) {
    fail("Agent-authored claim is missing `text`.");
  }
  const claim = createClaim(
    threadId,
    text,
    spec.claim_type ?? "fact",
    spec.priority ?? "medium",
    spec.answer_relevance ?? (spec.priority === "high" ? "high" : "medium"),
  );
  claim.why_it_matters = String(spec.why_it_matters ?? "").trim();
  return claim;
}

function createThreadFromSpec(spec = {}) {
  const title = String(spec.title ?? "").trim();
  const intent = String(spec.intent ?? "").trim();
  if (!title) {
    fail("Agent-authored thread is missing `title`.");
  }
  if (!intent) {
    fail(`Agent-authored thread "${title}" is missing \`intent\`.`);
  }
  return createThread(
    title,
    intent,
    Array.isArray(spec.subqueries)
      ? spec.subqueries.map((item) => String(item).trim()).filter(Boolean)
      : [],
    String(spec.notes ?? "").trim(),
  );
}

function compileResearchBrief(rawPlan = {}) {
  const rawBrief =
    rawPlan.research_brief && typeof rawPlan.research_brief === "object"
      ? rawPlan.research_brief
      : {};
  const rawSourcePolicy =
    rawBrief.source_policy && typeof rawBrief.source_policy === "object"
      ? rawBrief.source_policy
      : rawPlan.source_policy && typeof rawPlan.source_policy === "object"
        ? rawPlan.source_policy
        : null;
  return {
    objective: String(rawBrief.objective ?? rawPlan.goal ?? "").trim(),
    deliverable: String(rawBrief.deliverable ?? "").trim(),
    source_policy: rawSourcePolicy
      ? {
          mode: typeof rawSourcePolicy.mode === "string" ? rawSourcePolicy.mode.trim() : "",
          allow_domains: mergeUniqueStrings(
            [],
            ensureArray(rawSourcePolicy.allow_domains ?? rawSourcePolicy.domains)
              .map((item) => String(item).trim())
              .filter(Boolean),
          ),
          preferred_domains: mergeUniqueStrings(
            [],
            ensureArray(rawSourcePolicy.preferred_domains)
              .map((item) => String(item).trim())
              .filter(Boolean),
          ),
          notes: ensureArray(rawSourcePolicy.notes)
            .map((item) => String(item).trim())
            .filter(Boolean),
        }
      : null,
    clarification_notes: ensureArray(rawBrief.clarification_notes)
      .map((item) => String(item).trim())
      .filter(Boolean),
  };
}

function compileGapSpec(rawGap = {}, fallbackSummary = "") {
  const summary =
    typeof rawGap === "string"
      ? rawGap.trim()
      : String(rawGap.summary ?? rawGap.gap ?? rawGap.text ?? fallbackSummary).trim();
  if (!summary) {
    fail("Gap entries require a non-empty `summary`.");
  }
  return {
    kind:
      typeof rawGap === "object" && !Array.isArray(rawGap) && rawGap.kind
        ? String(rawGap.kind).trim()
        : "evidence_gap",
    summary,
    scope_type:
      typeof rawGap === "object" && !Array.isArray(rawGap)
        ? rawGap.scope_type ?? rawGap.scopeType ?? null
        : null,
    scope_id:
      typeof rawGap === "object" && !Array.isArray(rawGap)
        ? rawGap.scope_id ?? rawGap.scopeId ?? null
        : null,
    severity:
      typeof rawGap === "object" && !Array.isArray(rawGap) && rawGap.severity
        ? String(rawGap.severity).trim()
        : "medium",
    status:
      typeof rawGap === "object" && !Array.isArray(rawGap) && rawGap.status
        ? String(rawGap.status).trim()
        : "open",
    recommended_next_action:
      typeof rawGap === "object" && !Array.isArray(rawGap)
        ? String(rawGap.recommended_next_action ?? rawGap.recommendedNextAction ?? "").trim()
        : "",
    created_by:
      typeof rawGap === "object" && !Array.isArray(rawGap)
        ? String(rawGap.created_by ?? rawGap.createdBy ?? "agent").trim()
        : "agent",
  };
}

function compileSourcePolicyUpdate(rawSourcePolicy = null) {
  if (!rawSourcePolicy || typeof rawSourcePolicy !== "object" || Array.isArray(rawSourcePolicy)) {
    return null;
  }
  return {
    mode: typeof rawSourcePolicy.mode === "string" ? rawSourcePolicy.mode.trim() : "",
    allow_domains: mergeUniqueStrings(
      [],
      ensureArray(rawSourcePolicy.allow_domains ?? rawSourcePolicy.domains)
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
    preferred_domains: mergeUniqueStrings(
      [],
      ensureArray(rawSourcePolicy.preferred_domains)
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
    notes: ensureArray(rawSourcePolicy.notes)
      .map((item) => String(item).trim())
      .filter(Boolean),
  };
}

function compileQueueProposal(proposal = {}) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    fail("Delta plan queue proposals must be JSON objects.");
  }
  const kind = String(proposal.kind ?? "").trim();
  const scopeType = String(proposal.scope_type ?? proposal.scopeType ?? "").trim();
  const scopeId = String(proposal.scope_id ?? proposal.scopeId ?? "").trim();
  if (!kind || !scopeType || !scopeId) {
    fail("Delta plan queue proposals require `kind`, `scope_type`, and `scope_id`.");
  }
  if (!["gather_thread", "verify_claim", "synthesize_session", "handoff_session"].includes(kind)) {
    fail(`Unsupported delta plan queue proposal kind: ${kind}`);
  }
  return {
    kind,
    scope_type: scopeType,
    scope_id: scopeId,
    reason: String(proposal.reason ?? "").trim() || `Delta plan proposed ${kind}.`,
    key_suffix: String(proposal.key_suffix ?? proposal.keySuffix ?? "delta-plan").trim(),
  };
}

function compileDeltaPlan(rawPlan = {}) {
  const rawDelta =
    rawPlan?.delta_plan && typeof rawPlan.delta_plan === "object" ? rawPlan.delta_plan : rawPlan;
  if (!rawDelta || typeof rawDelta !== "object" || Array.isArray(rawDelta)) {
    fail("Delta plan must be a JSON object.");
  }
  const gapUpdates = ensureArray(rawDelta.gap_updates).map((item) => {
    const action = String(item.action ?? "upsert").trim() || "upsert";
    if (!["upsert", "resolve", "close"].includes(action)) {
      fail(`Unsupported delta plan gap action: ${action}`);
    }
    return {
      action,
      gap_id: typeof item.gap_id === "string" ? item.gap_id.trim() : "",
      summary: typeof item.summary === "string" ? item.summary.trim() : "",
      gap: action === "upsert" ? compileGapSpec(item.gap ?? item) : null,
    };
  });
  const threadActions = ensureArray(rawDelta.thread_actions).map((item) => {
    const action = String(item.action ?? item.type ?? "").trim();
    if (!["deepen", "pause", "branch"].includes(action)) {
      fail(`Unsupported delta plan thread action: ${action}`);
    }
    if (action === "branch") {
      const spec = item.thread ?? item.payload ?? {};
      const thread = createThreadFromSpec(spec);
      const rawClaims = Array.isArray(spec.claims) ? spec.claims : [];
      if (rawClaims.length === 0) {
        fail("Delta plan thread action `branch` requires at least one claim.");
      }
      const claims = rawClaims.map((claim) => createClaimFromSpec(thread.thread_id, claim));
      thread.claim_ids = claims.map((claim) => claim.claim_id);
      thread.execution.open_claim_ids = [...thread.claim_ids];
      return { action, thread, claims, reason: String(item.reason ?? "").trim() };
    }
    const threadId = String(item.thread_id ?? item.threadId ?? "").trim();
    if (!threadId) {
      fail(`Delta plan thread action \`${action}\` requires \`thread_id\`.`);
    }
    return { action, thread_id: threadId, reason: String(item.reason ?? "").trim() };
  });
  const claimActions = ensureArray(rawDelta.claim_actions).map((item) => {
    const action = String(item.action ?? item.type ?? "").trim();
    if (!["mark_stale", "set_priority"].includes(action)) {
      fail(`Unsupported delta plan claim action: ${action}`);
    }
    const claimId = String(item.claim_id ?? item.claimId ?? "").trim();
    if (!claimId) {
      fail(`Delta plan claim action \`${action}\` requires \`claim_id\`.`);
    }
    const priority = action === "set_priority" ? String(item.priority ?? "").trim() : "";
    if (action === "set_priority" && !priority) {
      fail("Delta plan claim action `set_priority` requires `priority`.");
    }
    return {
      action,
      claim_id: claimId,
      priority,
      reason: String(item.reason ?? "").trim(),
    };
  });
  return {
    delta_plan_id: String(rawDelta.delta_plan_id ?? "").trim() || createId("delta"),
    summary: String(rawDelta.summary ?? rawDelta.what_changed ?? "").trim(),
    what_changed: String(rawDelta.what_changed ?? rawDelta.summary ?? "").trim(),
    goal_update: String(rawDelta.goal_update ?? "").trim(),
    source_policy_update: compileSourcePolicyUpdate(rawDelta.source_policy_update),
    gap_updates: gapUpdates,
    thread_actions: threadActions,
    claim_actions: claimActions,
    queue_proposals: ensureArray(rawDelta.queue_proposals).map((item) => compileQueueProposal(item)),
    why_now: String(rawDelta.why_now ?? "").trim(),
  };
}

function compileAgentPlan(rawPlan = {}) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    fail("Agent-authored plan must be a JSON object.");
  }

  const rawThreads = Array.isArray(rawPlan.threads) ? rawPlan.threads : [];
  if (rawThreads.length === 0) {
    fail("Agent-authored plan must include a non-empty `threads` array.");
  }

  const threads = [];
  const claims = [];
  for (const rawThread of rawThreads) {
    const thread = createThreadFromSpec(rawThread);
    const rawClaims = Array.isArray(rawThread.claims) ? rawThread.claims : [];
    if (rawClaims.length === 0) {
      fail(`Agent-authored thread "${thread.title}" must include at least one claim.`);
    }
    const compiledClaims = rawClaims.map((item) => createClaimFromSpec(thread.thread_id, item));
    thread.claim_ids = compiledClaims.map((item) => item.claim_id);
    thread.execution.open_claim_ids = [...thread.claim_ids];
    threads.push(thread);
    claims.push(...compiledClaims);
  }

  const artifacts = rawPlan.planning_artifacts ?? {};
  const taskShape =
    typeof rawPlan.task_shape === "string" ? rawPlan.task_shape.trim().toLowerCase() : null;
  if (taskShape && !VALID_TASK_SHAPES.has(taskShape)) {
    fail(`Invalid agent-authored task_shape: ${rawPlan.task_shape}`);
  }
  return {
    goal: typeof rawPlan.goal === "string" ? normalizeGoal(rawPlan.goal) : "",
    task_shape: taskShape,
    plan_id: typeof rawPlan.plan_id === "string" ? rawPlan.plan_id.trim() : "",
    threads,
    claims,
    remainingGaps: Array.isArray(rawPlan.remaining_gaps)
      ? rawPlan.remaining_gaps.map((item) => String(item).trim()).filter(Boolean)
      : [],
    gaps: [
      ...ensureArray(rawPlan.gaps).map((item) => compileGapSpec(item)),
      ...ensureArray(rawPlan.remaining_gaps).map((item) =>
        compileGapSpec(
          typeof item === "string"
            ? { summary: item, status: "tracking", created_by: "compat" }
            : { ...item, status: item.status ?? "tracking", created_by: item.created_by ?? "compat" },
        ),
      ),
    ],
    planningArtifacts: {
      hypotheses: Array.isArray(artifacts.hypotheses)
        ? artifacts.hypotheses.map((item) => String(item).trim()).filter(Boolean)
        : [],
      domain_hints: Array.isArray(artifacts.domain_hints)
        ? artifacts.domain_hints.map((item) => String(item).trim()).filter(Boolean)
        : [],
      comparison_axes: Array.isArray(artifacts.comparison_axes)
        ? artifacts.comparison_axes.map((item) => String(item).trim()).filter(Boolean)
        : [],
      continuation_notes: Array.isArray(artifacts.continuation_notes)
        ? artifacts.continuation_notes.map((item) => String(item).trim()).filter(Boolean)
        : [],
    },
    constraints: rawPlan.constraints ?? {},
    researchBrief: compileResearchBrief(rawPlan),
    summary: String(rawPlan.summary ?? rawPlan.notes ?? "").trim(),
  };
}

function attachClaimsToThreads(threads, claims) {
  const claimsByThread = new Map(threads.map((thread) => [thread.thread_id, []]));
  for (const claim of claims) {
    claimsByThread.get(claim.thread_id)?.push(claim.claim_id);
  }
  return threads.map((thread) => ({
    ...thread,
    claim_ids: claimsByThread.get(thread.thread_id) ?? [],
    execution: {
      ...thread.execution,
      open_claim_ids: claimsByThread.get(thread.thread_id) ?? [],
    },
  }));
}

function buildBroadPlan(goal) {
  const landscapeThread = createThread(
    "Product landscape",
    "identify the main products or categories relevant to the goal",
    [`${goal} leading products`, `${goal} market landscape`],
  );
  const pricingThread = createThread(
    "Pricing and packaging",
    "determine pricing visibility, packaging differences, and sales-gated plans",
    [`${goal} pricing`, `${goal} pricing packaging`],
  );
  const deploymentThread = createThread(
    "Deployment and security posture",
    "compare deployment, security, hosting, and compliance positioning",
    [`${goal} deployment security`, `${goal} hosting compliance`],
  );
  const adoptionThread = createThread(
    "Audience and adoption",
    "compare target users, enterprise proof points, and workflow fit",
    [`${goal} enterprise adoption`, `${goal} target users workflow`],
  );

  const claims = [
    createClaim(
      landscapeThread.thread_id,
      `The leading options in ${goal} differ in scope, positioning, or product category.`,
      "positioning",
      "high",
    ),
    createClaim(
      pricingThread.thread_id,
      `The leading options in ${goal} differ in pricing visibility, packaging, or sales-gated plans.`,
      "comparison",
      "high",
    ),
    createClaim(
      deploymentThread.thread_id,
      `The leading options in ${goal} differ in deployment model, security posture, or data handling.`,
      "capability",
      "high",
    ),
    createClaim(
      adoptionThread.thread_id,
      `The leading options in ${goal} target different audiences or show different levels of enterprise adoption.`,
      "positioning",
      "high",
    ),
  ];

  return {
    threads: attachClaimsToThreads(
      [landscapeThread, pricingThread, deploymentThread, adoptionThread],
      claims,
    ),
    claims,
    remainingGaps: [
      "Which high-priority claims still lack primary-source evidence?",
      "Which important comparison dimensions remain under-covered?",
    ],
  };
}

function capitalizeSentence(text) {
  const value = String(text).trim();
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function ensureSentence(text) {
  const value = String(text)
    .trim()
    .replace(/[.?!]+$/u, "");
  if (!value) {
    return value;
  }
  return `${capitalizeSentence(value)}.`;
}

function stripVerificationFollowUps(goal) {
  return String(goal)
    .replace(/,?\s+and\s+if\s+so\b.*$/iu, "")
    .replace(/,?\s+if\s+so\b.*$/iu, "")
    .replace(/,?\s+and\s+(what|which|how|where|when)\b.*$/iu, "")
    .replace(/,?\s+(what|which)\s+is\s+the\s+evidence\b.*$/iu, "")
    .trim();
}

function conjugateThirdPerson(verb) {
  const lower = String(verb).toLowerCase();
  if (lower === "have") {
    return "has";
  }
  if (/(s|sh|ch|x|z|o)$/u.test(lower)) {
    return `${lower}es`;
  }
  if (/[^aeiou]y$/u.test(lower)) {
    return `${lower.slice(0, -1)}ies`;
  }
  return `${lower}s`;
}

function statementFromQuestion(goal) {
  const clean = stripVerificationFollowUps(goal).replace(/\?+$/u, "").trim();
  if (!clean) {
    return ensureSentence(goal);
  }

  const doesMatch = clean.match(/^does\s+(.+?)\s+([a-z][a-z-]+)\s+(.+)$/iu);
  if (doesMatch) {
    const [, subject, verb, rest] = doesMatch;
    return ensureSentence(`${subject} ${conjugateThirdPerson(verb)} ${rest}`);
  }

  const modalMatch = clean.match(
    /^(can|could|should|would|will|did|do|has|have)\s+(.+?)\s+([a-z][a-z-]+)\s+(.+)$/iu,
  );
  if (modalMatch) {
    const [, modal, subject, verb, rest] = modalMatch;
    return ensureSentence(`${subject} ${modal.toLowerCase()} ${verb} ${rest}`);
  }

  const beMatch = clean.match(
    /^(is|are|was|were)\s+(.+?)\s+((?:soc ?2|iso ?27001|gdpr|hipaa|fedramp|available|supported|certified|deprecated|documented|enabled|included|listed|public|private|required|free|ga|beta)\b.+)$/iu,
  );
  if (beMatch) {
    const [, auxiliary, subject, predicate] = beMatch;
    return ensureSentence(`${subject} ${auxiliary.toLowerCase()} ${predicate}`);
  }

  return ensureSentence(clean);
}

function subjectFromStatement(statement) {
  const clean = String(statement)
    .replace(/[.?!]+$/u, "")
    .trim();
  const match = clean.match(
    /^(.+?)\s+(?:is|are|was|were|has|have|supports?|exposes?|offers?|documents?|allows?|includes?|lists?|uses?)\b/iu,
  );
  return match?.[1]?.trim() ?? "";
}

function endpointSubqueries(goal) {
  const directStatement = statementFromQuestion(goal);
  const subject = subjectFromStatement(directStatement);
  const subjectDomainHint =
    /^[a-z0-9-]+$/iu.test(subject) && !/\s/u.test(subject)
      ? `site:${subject.toLowerCase().replace(/[^a-z0-9-]+/giu, "")}.com`
      : "";
  const focus = [
    subject,
    /\bdeep research\b/iu.test(goal) ? "deep research" : "",
    /\bapi\b/iu.test(goal) ? "API" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!focus) {
    return [`${goal} endpoint`, `${goal} official docs`, `${goal} API reference`];
  }
  return uniqueBy(
    [
      `${focus} Responses API`,
      `${focus} endpoint`,
      `${focus} API reference`,
      subjectDomainHint ? `${focus} endpoint ${subjectDomainHint}` : "",
      `${focus} official docs`,
    ].filter(Boolean),
    (item) => item.toLowerCase(),
  );
}

function detailThreadForGoal(goal, directClaim) {
  const normalizedDirectClaim = String(directClaim).replace(/[.?!]+$/u, "");
  if (/\b(endpoint|api surface|route|path|responses api|response api)\b/iu.test(goal)) {
    return {
      title: "Concrete API surface",
      intent:
        "identify the exact endpoint, API surface, or mechanism named in official sources",
      subqueries: endpointSubqueries(goal),
      claim: normalizedDirectClaim
        ? `${normalizedDirectClaim} through a documented endpoint or API surface.`
        : `Official sources name the endpoint, API surface, or mechanism needed to answer: ${goal}.`,
      claimType: "capability",
    };
  }

  if (/\b(price|pricing|cost|billing|plan)\b/iu.test(goal)) {
    return {
      title: "Pricing details",
      intent:
        "identify the concrete pricing, packaging, or billing details that answer the question",
      subqueries: [`${goal} pricing`, `${goal} official pricing`],
      claim: `Official pricing or packaging details directly answer: ${goal}.`,
      claimType: "comparison",
    };
  }

  return {
    title: "Primary documentation",
    intent:
      "find the official documentation or policy page that most directly answers the question",
    subqueries: [`${goal} official documentation`, `${goal} docs`],
    claim: `A primary or official source directly answers: ${goal}.`,
    claimType: "documentation",
  };
}

function buildVerificationPlan(goal) {
  const directClaim = statementFromQuestion(goal);
  const detailThreadPlan = detailThreadForGoal(goal, directClaim);
  const directThread = createThread(
    "Direct answer",
    "answer the user's question directly from primary or official evidence",
    [`${goal} official evidence`, `${goal} primary source`],
  );
  const detailThread = createThread(
    detailThreadPlan.title,
    detailThreadPlan.intent,
    detailThreadPlan.subqueries,
  );
  const caveatThread = createThread(
    "Caveats and contradictory evidence",
    "look for exceptions, caveats, dates, or contradictory statements",
    [`${goal} caveats`, `${goal} contradictory evidence`],
  );

  const claims = [
    createClaim(directThread.thread_id, directClaim, "fact", "high"),
    createClaim(
      detailThread.thread_id,
      detailThreadPlan.claim,
      detailThreadPlan.claimType,
      "high",
    ),
    createClaim(
      caveatThread.thread_id,
      `Important caveats, exclusions, or contradictory evidence exist for: ${goal}.`,
      "policy",
      "medium",
    ),
  ];

  return {
    threads: attachClaimsToThreads([directThread, detailThread, caveatThread], claims),
    claims,
    remainingGaps: [
      "Which official source most directly answers the user's question?",
      "Which concrete detail would a user need to act on the answer?",
      "Does any primary source contradict, qualify, or narrow the answer?",
      "Is the evidence current enough for the user's question?",
    ],
  };
}

function buildSitePlan(goal) {
  const docsThread = createThread(
    "Relevant documentation",
    "identify the pages that directly document the requested topic",
    [goal],
  );
  const policyThread = createThread(
    "Policy or explicit statements",
    "capture direct statements or policy language related to the goal",
    [goal],
  );
  const limitationThread = createThread(
    "Gaps or omissions",
    "identify what the site does not make explicit",
    [goal],
  );

  const claims = [
    createClaim(
      docsThread.thread_id,
      `The target site documents the requested topic for: ${goal}.`,
      "capability",
      "high",
    ),
    createClaim(
      policyThread.thread_id,
      `The target site includes explicit statements or policy language relevant to: ${goal}.`,
      "policy",
      "high",
    ),
    createClaim(
      limitationThread.thread_id,
      `The target site leaves important details unspecified or scattered for: ${goal}.`,
      "fact",
      "medium",
    ),
  ];

  return {
    threads: attachClaimsToThreads([docsThread, policyThread, limitationThread], claims),
    claims,
    remainingGaps: [
      "Which paths on the site contain the strongest evidence?",
      "What important details are still not explicit on the site?",
    ],
  };
}

function buildAsyncPlan(goal) {
  const asyncThread = createThread(
    "Async handoff",
    "prepare a remote handoff for artifact-heavy or connector-heavy work",
    [goal],
  );
  const claims = [
    createClaim(
      asyncThread.thread_id,
      `This task needs async execution or artifact generation for: ${goal}.`,
      "capability",
      "high",
    ),
  ];
  return {
    threads: attachClaimsToThreads([asyncThread], claims),
    claims,
    remainingGaps: ["What follow-up or deliverable format will the remote worker need?"],
  };
}

function planningArtifactsFromResearch(result, taskShape) {
  const content = String(result.content ?? result.answer ?? "").trim();
  if (!content) {
    return {
      hypotheses: [],
      domain_hints: [],
      comparison_axes: defaultComparisonAxes(taskShape),
    };
  }
  const sentences = splitSentences(content);
  return {
    hypotheses: sentences.slice(0, 4),
    domain_hints: domainsFromText(content),
    comparison_axes: defaultComparisonAxes(taskShape),
  };
}

function queuePlanWork(session, parentWorkItemId = null) {
  if (session.task_shape === "async") {
    queueWorkItem(session, {
      kind: "handoff_session",
      scopeType: "session",
      scopeId: session.session_id,
      reason: "Task shape requires async remote execution.",
      dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
    });
    return;
  }

  for (const thread of session.threads) {
    queueWorkItem(session, {
      kind: "gather_thread",
      scopeType: "thread",
      scopeId: thread.thread_id,
      keySuffix: `round-${thread.execution.gather_rounds + 1}`,
      reason: "Initial gathering pass for planned thread.",
      dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
    });
  }
}

function queueThreadsForGathering(session, threads, parentWorkItemId = null, reason) {
  for (const thread of threads) {
    queueWorkItem(session, {
      kind: "gather_thread",
      scopeType: "thread",
      scopeId: thread.thread_id,
      keySuffix: `round-${thread.execution.gather_rounds + 1}`,
      reason,
      dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
    });
  }
}

function requiresPlanApproval(session) {
  return session.plan_state?.approval_status === "pending";
}

function mergeResearchBrief(session, researchBrief = {}) {
  if (!session.research_brief) {
    return;
  }
  if (researchBrief.objective) {
    session.research_brief.objective = normalizeGoal(researchBrief.objective);
  } else if (!session.research_brief.objective && session.goal) {
    session.research_brief.objective = session.goal;
  }
  if (researchBrief.deliverable) {
    session.research_brief.deliverable = researchBrief.deliverable;
  }
  if (researchBrief.source_policy) {
    const existing = session.research_brief.source_policy ?? {
      mode: "open",
      allow_domains: [],
      preferred_domains: [],
      notes: [],
    };
    const allowDomains = mergeUniqueStrings(
      existing.allow_domains,
      researchBrief.source_policy.allow_domains,
    );
    session.research_brief.source_policy = {
      ...existing,
      ...researchBrief.source_policy,
      allow_domains: allowDomains,
      preferred_domains: mergeUniqueStrings(
        existing.preferred_domains,
        researchBrief.source_policy.preferred_domains,
      ),
      notes: mergeUniqueStrings(existing.notes, researchBrief.source_policy.notes),
      mode:
        researchBrief.source_policy.mode ||
        (allowDomains.length > 0 ? "allowlist" : existing.mode ?? "open"),
    };
  }
  session.research_brief.clarification_notes = mergeUniqueStrings(
    session.research_brief.clarification_notes,
    researchBrief.clarification_notes,
  );
  session.research_brief.updated_at = new Date().toISOString();
}

function ensureNotAwaitingPlanApproval(session) {
  if (requiresPlanApproval(session) && session.plan_state?.pending_plan_version_id) {
    fail("This session has a pending plan approval. Approve the prepared plan before mutating it.");
  }
}

function looksLikeDeltaPlan(rawPlan = {}) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    return false;
  }
  return Boolean(rawPlan.delta_plan && typeof rawPlan.delta_plan === "object");
}

function looksLikeContinuationPatch(rawPlan = {}) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) {
    return false;
  }
  return Boolean(rawPlan.continuation_patch && typeof rawPlan.continuation_patch === "object");
}

function cancelQueuedThreadWork(session, threadId, reason) {
  for (const item of session.work_items) {
    if (
      item.scope_id === threadId &&
      item.kind === "gather_thread" &&
      item.status === "queued"
    ) {
      item.status = "skipped";
      item.last_error = reason;
      item.completed_at = new Date().toISOString();
      item.updated_at = item.completed_at;
    }
  }
}

function validateQueueProposalTarget(session, proposal) {
  if (proposal.kind === "gather_thread") {
    if (proposal.scope_type !== "thread" || !getThreadById(session, proposal.scope_id)) {
      fail("Delta plan queue proposal referenced a missing thread.");
    }
    return;
  }
  if (proposal.kind === "verify_claim") {
    if (
      proposal.scope_type !== "claim" ||
      !session.claims.some((claim) => claim.claim_id === proposal.scope_id)
    ) {
      fail("Delta plan queue proposal referenced a missing claim.");
    }
    return;
  }
  if (proposal.kind === "synthesize_session" || proposal.kind === "handoff_session") {
    if (proposal.scope_type !== "session" || proposal.scope_id !== session.session_id) {
      fail("Delta plan queue proposal referenced an invalid session target.");
    }
  }
}

function compileContinuationOperation(operation = {}) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    fail("Continuation patch operations must be JSON objects.");
  }
  const type = String(operation.type ?? "").trim();
  if (!type) {
    fail("Continuation patch operation is missing `type`.");
  }

  if (type === "merge_domains") {
    const domains = mergeUniqueStrings(
      [],
      operation.domains?.map((item) => String(item).trim()).filter(Boolean) ?? [],
    );
    if (domains.length === 0) {
      fail("Continuation patch operation `merge_domains` requires `domains`.");
    }
    return {
      type,
      domains,
      reason: String(operation.reason ?? "Continuation narrowed or expanded the source scope."),
    };
  }

  if (type === "add_gap") {
    const gap = compileGapSpec(operation.gap ?? operation);
    if (!gap.summary) {
      fail("Continuation patch operation `add_gap` requires `gap`.");
    }
    return {
      type,
      gap,
      reason: String(operation.reason ?? "Continuation recorded an explicit evidence gap."),
    };
  }

  if (type === "note") {
    const note = String(operation.note ?? operation.text ?? "").trim();
    if (!note) {
      fail("Continuation patch operation `note` requires `note`.");
    }
    return {
      type,
      note,
      reason: String(operation.reason ?? "Continuation recorded a follow-up note."),
    };
  }

  if (type === "mark_claim_stale") {
    const claimId = String(operation.claim_id ?? "").trim();
    if (!claimId) {
      fail("Continuation patch operation `mark_claim_stale` requires `claim_id`.");
    }
    return {
      type,
      claim_id: claimId,
      reason: String(operation.reason ?? "Continuation requested claim re-verification."),
    };
  }

  if (type === "requeue_thread") {
    const threadId = String(operation.thread_id ?? "").trim();
    if (!threadId) {
      fail("Continuation patch operation `requeue_thread` requires `thread_id`.");
    }
    return {
      type,
      thread_id: threadId,
      reason: String(operation.reason ?? "Continuation requested a deeper gather pass."),
    };
  }

  if (type === "add_thread") {
    const spec = operation.thread ?? operation.payload ?? {};
    const thread = createThreadFromSpec(spec);
    const rawClaims = Array.isArray(spec.claims) ? spec.claims : [];
    if (rawClaims.length === 0) {
      fail("Continuation patch operation `add_thread` requires at least one claim.");
    }
    const claims = rawClaims.map((item) => createClaimFromSpec(thread.thread_id, item));
    thread.claim_ids = claims.map((item) => item.claim_id);
    thread.execution.open_claim_ids = [...thread.claim_ids];
    return {
      type,
      thread,
      claims,
      reason: String(operation.reason ?? `Continuation created a new thread: ${thread.title}`),
    };
  }

  fail(`Unsupported continuation patch operation: ${type}`);
}

function compileContinuationPatch(rawPatch = {}) {
  const patch =
    rawPatch?.continuation_patch && typeof rawPatch.continuation_patch === "object"
      ? rawPatch.continuation_patch
      : rawPatch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    fail("Continuation patch must be a JSON object.");
  }
  const operations = ensureArray(patch.operations).map((item) => compileContinuationOperation(item));
  if (operations.length === 0) {
    fail("Continuation patch must include a non-empty `operations` array.");
  }
  return {
    instruction: String(patch.instruction ?? rawPatch.instruction ?? "").trim(),
    mode: String(patch.mode ?? "deepen").trim() || "deepen",
    domains: mergeUniqueStrings(
      ensureArray(patch.domains).map((item) => String(item).trim()).filter(Boolean),
      operations.flatMap((operation) => operation.domains ?? []),
    ),
    notes: ensureArray(patch.notes).map((item) => String(item).trim()).filter(Boolean),
    operations,
  };
}

function applyContinuationPatch(
  session,
  rawPatch,
  { parentWorkItemId = null, action = "continuation_patch" } = {},
) {
  const compiled = compileContinuationPatch(rawPatch);
  const continuation = {
    continuation_id: createId("continuation"),
    instruction: compiled.instruction,
    mode: compiled.mode,
    created_at: new Date().toISOString(),
    applied_at: new Date().toISOString(),
    domains: compiled.domains,
    affected_thread_ids: [],
    created_thread_ids: [],
    stale_claim_ids: [],
    notes: [...compiled.notes],
    operations: [],
  };
  session.continuations.push(continuation);

  if (compiled.instruction) {
    session.planning_artifacts.continuation_notes = mergeUniqueStrings(
      session.planning_artifacts.continuation_notes,
      [compiled.instruction],
    );
  }

  for (const operation of compiled.operations) {
    continuation.operations.push(operation);

    if (operation.type === "merge_domains") {
      session.constraints.domains = mergeUniqueStrings(session.constraints.domains, operation.domains);
      if (session.research_brief?.source_policy) {
        session.research_brief.source_policy.allow_domains = mergeUniqueStrings(
          session.research_brief.source_policy.allow_domains,
          operation.domains,
        );
        session.research_brief.source_policy.mode =
          session.research_brief.source_policy.allow_domains.length > 0 ? "allowlist" : "open";
      }
      continue;
    }

    if (operation.type === "add_gap") {
      upsertGap(session, {
        ...operation.gap,
        created_by: operation.gap.created_by ?? "agent",
      });
      session.stop_status.remaining_gaps = mergeUniqueStrings(session.stop_status.remaining_gaps, [
        operation.gap.summary,
      ]);
      continue;
    }

    if (operation.type === "note") {
      continuation.notes.push(operation.note);
      session.planning_artifacts.continuation_notes = mergeUniqueStrings(
        session.planning_artifacts.continuation_notes,
        [operation.note],
      );
      continue;
    }

    if (operation.type === "mark_claim_stale") {
      const claim = session.claims.find((item) => item.claim_id === operation.claim_id);
      if (!claim) {
        fail(`Continuation patch referenced an unknown claim: ${operation.claim_id}`);
      }
      claim.verification.stale = true;
      claim.verification.status = "queued";
      claim.verification.last_continuation_id = continuation.continuation_id;
      continuation.stale_claim_ids.push(claim.claim_id);
      queueWorkItem(session, {
        kind: "verify_claim",
        scopeType: "claim",
        scopeId: claim.claim_id,
        continuationId: continuation.continuation_id,
        reason: operation.reason,
        dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
      });
      continue;
    }

    if (operation.type === "requeue_thread") {
      const thread = getThreadById(session, operation.thread_id);
      if (!thread) {
        fail(`Continuation patch referenced an unknown thread: ${operation.thread_id}`);
      }
      thread.execution.gather_status = "queued";
      thread.execution.last_continuation_id = continuation.continuation_id;
      continuation.affected_thread_ids.push(thread.thread_id);
      queueWorkItem(session, {
        kind: "gather_thread",
        scopeType: "thread",
        scopeId: thread.thread_id,
        continuationId: continuation.continuation_id,
        keySuffix: `round-${thread.execution.gather_rounds + 1}`,
        reason: operation.reason,
        dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
      });
      continue;
    }

    if (operation.type === "add_thread") {
      session.threads.push(operation.thread);
      session.claims.push(...operation.claims);
      continuation.created_thread_ids.push(operation.thread.thread_id);
      queueWorkItem(session, {
        kind: "gather_thread",
        scopeType: "thread",
        scopeId: operation.thread.thread_id,
        continuationId: continuation.continuation_id,
        keySuffix: `round-${operation.thread.execution.gather_rounds + 1}`,
        reason: operation.reason,
        dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
      });
    }
  }

  appendDecision(
    session,
    action,
    compiled.instruction
      ? `Applied continuation mutation: ${compiled.instruction}`
      : "Applied a structured continuation mutation patch.",
    {
      continuation_id: continuation.continuation_id,
      mode: continuation.mode,
      operation_count: continuation.operations.length,
      affected_thread_ids: continuation.affected_thread_ids,
      created_thread_ids: continuation.created_thread_ids,
      stale_claim_ids: continuation.stale_claim_ids,
      domains: continuation.domains,
    },
  );
  syncSessionStage(session);
  return continuation;
}

function applyDeltaPlan(
  session,
  rawDelta,
  { parentWorkItemId = null, action = "delta_plan" } = {},
) {
  const compiled = compileDeltaPlan(rawDelta);
  const existing = ensureArray(session.delta_plans).find(
    (item) => item.delta_plan_id === compiled.delta_plan_id,
  );
  if (existing) {
    appendDecision(session, "delta_plan_skip", "Skipped a duplicate agent-authored delta plan.", {
      delta_plan_id: compiled.delta_plan_id,
    });
    return existing;
  }

  if (compiled.goal_update) {
    session.goal = normalizeGoal(compiled.goal_update);
  }
  mergeResearchBrief(session, {
    objective: compiled.goal_update || "",
    source_policy: compiled.source_policy_update,
    clarification_notes: [],
  });

  for (const update of compiled.gap_updates) {
    if (update.action === "upsert" && update.gap) {
      upsertGap(session, {
        ...update.gap,
        created_by: update.gap.created_by ?? "agent",
      });
      session.stop_status.remaining_gaps = mergeUniqueStrings(session.stop_status.remaining_gaps, [
        update.gap.summary,
      ]);
      continue;
    }
    const targetGap = ensureArray(session.gaps).find(
      (gap) =>
        (update.gap_id && gap.gap_id === update.gap_id) ||
        (update.summary && gap.summary === update.summary),
    );
    if (!targetGap) {
      fail("Delta plan gap update referenced a missing gap.");
    }
    targetGap.status = update.action === "resolve" ? "resolved" : "closed";
    targetGap.updated_at = new Date().toISOString();
  }

  for (const threadAction of compiled.thread_actions) {
    if (threadAction.action === "branch") {
      session.threads.push(threadAction.thread);
      session.claims.push(...threadAction.claims);
      queueWorkItem(session, {
        kind: "gather_thread",
        scopeType: "thread",
        scopeId: threadAction.thread.thread_id,
        keySuffix: `delta-${compiled.delta_plan_id}`,
        reason: threadAction.reason || "Delta plan proposed a new branch.",
        dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
      });
      continue;
    }
    const thread = getThreadById(session, threadAction.thread_id);
    if (!thread) {
      fail("Delta plan thread action referenced a missing thread.");
    }
    if (threadAction.action === "pause") {
      thread.execution.gather_status = "blocked";
      thread.notes = [thread.notes, threadAction.reason].filter(Boolean).join(" ").trim();
      cancelQueuedThreadWork(
        session,
        thread.thread_id,
        threadAction.reason || "Delta plan paused queued gather work for this thread.",
      );
      continue;
    }
    if (threadAction.action === "deepen") {
      thread.execution.gather_status = "queued";
      queueWorkItem(session, {
        kind: "gather_thread",
        scopeType: "thread",
        scopeId: thread.thread_id,
        keySuffix: `delta-${compiled.delta_plan_id}`,
        reason: threadAction.reason || "Delta plan requested a deeper gather pass.",
        dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
      });
    }
  }

  for (const claimAction of compiled.claim_actions) {
    const claim = session.claims.find((item) => item.claim_id === claimAction.claim_id);
    if (!claim) {
      fail("Delta plan claim action referenced a missing claim.");
    }
    if (claimAction.action === "mark_stale") {
      claim.verification.stale = true;
      claim.verification.status = "queued";
      queueWorkItem(session, {
        kind: "verify_claim",
        scopeType: "claim",
        scopeId: claim.claim_id,
        keySuffix: `delta-${compiled.delta_plan_id}`,
        reason: claimAction.reason || "Delta plan requested claim re-verification.",
        dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
      });
      continue;
    }
    if (claimAction.action === "set_priority" && claimAction.priority) {
      claim.priority = claimAction.priority;
      claim.answer_relevance = claimAction.priority === "high" ? "high" : claim.answer_relevance;
    }
  }

  for (const proposal of compiled.queue_proposals) {
    validateQueueProposalTarget(session, proposal);
    queueWorkItem(session, {
      kind: proposal.kind,
      scopeType: proposal.scope_type,
      scopeId: proposal.scope_id,
      keySuffix: proposal.key_suffix || `delta-${compiled.delta_plan_id}`,
      reason: proposal.reason,
      dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
    });
  }

  const recorded = recordDeltaPlan(session, compiled);
  appendDecision(session, action, "Applied an agent-authored delta plan.", {
    delta_plan_id: recorded.delta_plan_id,
    summary: recorded.summary,
    gap_update_count: recorded.gap_updates.length,
    thread_action_count: recorded.thread_actions.length,
    claim_action_count: recorded.claim_actions.length,
    queue_proposal_count: recorded.queue_proposals.length,
  });
  syncSessionStage(session);
  return recorded;
}

export function applyResearchPlan(
  session,
  rawPlan,
  { mode = "replace", parentWorkItemId = null } = {},
) {
  ensureNotAwaitingPlanApproval(session);
  if (looksLikeDeltaPlan(rawPlan)) {
    return applyDeltaPlan(session, rawPlan, {
      parentWorkItemId,
      action: "delta_plan",
    });
  }
  if (looksLikeContinuationPatch(rawPlan)) {
    return applyContinuationPatch(session, rawPlan, {
      parentWorkItemId,
      action: "continuation_patch",
    });
  }
  const compiled = compileAgentPlan(rawPlan);
  const isAppend = mode === "append";
  if (!isAppend && mode !== "replace") {
    fail(`Invalid agent-authored plan mode: ${mode}`);
  }
  if (
    compiled.plan_id &&
    session.decision_log.some(
      (item) => item.action === "agent_plan" && item.details?.plan_id === compiled.plan_id,
    )
  ) {
    appendDecision(session, "agent_plan_skip", "Skipped a duplicate agent-authored plan.", {
      mode,
      plan_id: compiled.plan_id,
    });
    return compiled;
  }

  if (compiled.goal) {
    session.goal = compiled.goal;
  } else if (!session.goal) {
    session.goal = normalizeGoal(session.user_query);
  }
  mergeResearchBrief(session, compiled.researchBrief);

  if (compiled.task_shape) {
    session.task_shape = compiled.task_shape;
  } else if (!session.task_shape) {
    session.task_shape = classifyTaskShape(
      session.goal || session.user_query,
      session.constraints.domains,
    );
  }

  if (Array.isArray(compiled.constraints.domains) && compiled.constraints.domains.length > 0) {
    session.constraints.domains = mergeUniqueStrings(
      session.constraints.domains,
      compiled.constraints.domains.map((item) => String(item).trim()).filter(Boolean),
    );
  }
  if (compiled.constraints.time_range) {
    session.constraints.time_range = compiled.constraints.time_range;
  }
  if (compiled.constraints.country) {
    session.constraints.country = compiled.constraints.country;
  }

  if (isAppend) {
    session.threads.push(...compiled.threads);
    session.claims.push(...compiled.claims);
  } else {
    session.threads = compiled.threads;
    session.claims = compiled.claims;
    session.work_items = session.work_items.filter(
      (item) => !(item.kind === "plan_session" && item.status === "queued"),
    );
  }

  session.planning_artifacts.hypotheses = isAppend
    ? mergeUniqueStrings(
        session.planning_artifacts.hypotheses,
        compiled.planningArtifacts.hypotheses,
      )
    : compiled.planningArtifacts.hypotheses;
  session.planning_artifacts.domain_hints = isAppend
    ? mergeUniqueStrings(
        session.planning_artifacts.domain_hints,
        compiled.planningArtifacts.domain_hints,
      )
    : compiled.planningArtifacts.domain_hints;
  session.planning_artifacts.comparison_axes = isAppend
    ? mergeUniqueStrings(
        session.planning_artifacts.comparison_axes,
        compiled.planningArtifacts.comparison_axes,
      )
    : compiled.planningArtifacts.comparison_axes;
  session.planning_artifacts.continuation_notes = isAppend
    ? mergeUniqueStrings(
        session.planning_artifacts.continuation_notes,
        compiled.planningArtifacts.continuation_notes,
      )
    : compiled.planningArtifacts.continuation_notes;

  session.stop_status.remaining_gaps = mergeUniqueStrings(
    session.stop_status.remaining_gaps,
    compiled.remainingGaps,
  );
  for (const gap of compiled.gaps) {
    upsertGap(session, gap);
  }
  if (session.planning_artifacts.comparison_axes.length === 0 && session.task_shape) {
    session.planning_artifacts.comparison_axes = defaultComparisonAxes(session.task_shape);
  }

  if (requiresPlanApproval(session)) {
    recordPlanVersion(session, {
      planId: compiled.plan_id || null,
      source: "agent_authored",
      mode,
      status: "pending_approval",
      summary:
        compiled.summary ||
        (isAppend
          ? "Prepared an agent-authored follow-up research plan for approval."
          : "Prepared an agent-authored research plan for approval."),
      threads: compiled.threads,
      claims: compiled.claims,
      gaps: compiled.gaps,
      researchBrief: session.research_brief,
      remainingGaps: compiled.remainingGaps,
    });
    appendDecision(
      session,
      "agent_plan_prepare",
      isAppend
        ? "Prepared an agent-authored follow-up plan and paused for approval."
        : "Prepared an agent-authored plan and paused for approval.",
      {
        mode,
        plan_id: compiled.plan_id || null,
        task_shape: session.task_shape,
        thread_count: compiled.threads.length,
        claim_count: compiled.claims.length,
        summary: compiled.summary,
      },
    );
    syncSessionStage(session);
    return compiled;
  }

  if (session.task_shape === "async") {
    queueWorkItem(session, {
      kind: "handoff_session",
      scopeType: "session",
      scopeId: session.session_id,
      reason: "Agent-authored plan marked the task as async.",
      dependsOn: parentWorkItemId ? [parentWorkItemId] : [],
    });
  } else {
    queueThreadsForGathering(
      session,
      compiled.threads,
      parentWorkItemId,
      isAppend
        ? "Agent-authored follow-up plan queued new gathering work."
        : "Agent-authored plan queued the initial gathering work.",
    );
  }

  appendDecision(
    session,
    "agent_plan",
    isAppend
      ? "Applied an agent-authored follow-up research plan."
      : "Applied an agent-authored research plan.",
    {
      mode,
      plan_id: compiled.plan_id || null,
      task_shape: session.task_shape,
      thread_count: compiled.threads.length,
      claim_count: compiled.claims.length,
      summary: compiled.summary,
    },
  );
  syncSessionStage(session);
  return compiled;
}

export async function planSession(session, runtime, workItem = null) {
  if (!session.goal) {
    session.goal = normalizeGoal(session.user_query);
  }
  if (!session.task_shape) {
    session.task_shape = classifyTaskShape(session.user_query, session.constraints.domains);
  }

  if (
    session.task_shape === "broad" &&
    session.constraints.depth !== "quick" &&
    session.planning_artifacts.hypotheses.length === 0
  ) {
    const { result } = await runtime.runProviderOperation(
      {
        provider: "tavily",
        tool: "research",
        inputSummary: `Planning accelerator for: ${session.goal}`,
        scopeType: "session",
        scopeId: session.session_id,
        workItemId: workItem?.work_item_id ?? null,
      },
      () =>
        runtime.adapters.runTavilyResearch({
          input: session.goal,
          depth: session.constraints.depth,
        }),
    );
    const artifacts = planningArtifactsFromResearch(result, session.task_shape);
    session.planning_artifacts.hypotheses = artifacts.hypotheses;
    session.planning_artifacts.domain_hints = artifacts.domain_hints;
    session.planning_artifacts.comparison_axes = artifacts.comparison_axes;
  }

  if (session.threads.length === 0 || session.claims.length === 0) {
    const plan =
      session.task_shape === "broad"
        ? buildBroadPlan(session.goal)
        : session.task_shape === "site"
          ? buildSitePlan(session.goal)
          : session.task_shape === "async"
            ? buildAsyncPlan(session.goal)
            : buildVerificationPlan(session.goal);

    session.threads = plan.threads;
    session.claims = plan.claims;
    session.stop_status.remaining_gaps = mergeUniqueStrings(
      session.stop_status.remaining_gaps,
      plan.remainingGaps,
    );
    for (const gap of plan.remainingGaps) {
      upsertGap(session, { summary: gap, created_by: "runtime", status: "tracking" });
    }
    if (session.planning_artifacts.comparison_axes.length === 0) {
      session.planning_artifacts.comparison_axes = defaultComparisonAxes(session.task_shape);
    }
  }

  if (requiresPlanApproval(session)) {
    recordPlanVersion(session, {
      source: "runtime_fallback",
      mode: "replace",
      status: "pending_approval",
      summary: "Prepared a runtime-generated research plan for approval.",
      threads: session.threads,
      claims: session.claims,
      gaps: ensureArray(session.gaps),
      researchBrief: session.research_brief,
      remainingGaps: session.stop_status.remaining_gaps,
    });
    appendDecision(session, "plan_prepare", "Prepared a research plan and paused for approval.", {
      task_shape: session.task_shape,
      thread_count: session.threads.length,
      claim_count: session.claims.length,
    });
    syncSessionStage(session);
    return;
  }

  queuePlanWork(session, workItem?.work_item_id ?? null);
  appendDecision(session, "plan", "Generated answer-bearing threads and queued work items.", {
    task_shape: session.task_shape,
    thread_count: session.threads.length,
    claim_count: session.claims.length,
  });
}

function inferContinuationMode(instruction) {
  const text = String(instruction).toLowerCase();
  if (/\b(branch|separate|new angle|new thread)\b/.test(text)) {
    return "branch";
  }
  if (/\b(verify|re-verify|double-check|confirm|validate|prove)\b/.test(text)) {
    return "verify";
  }
  return "deepen";
}

function matchingThreads(session, instruction) {
  return session.threads
    .map((thread) => ({
      thread,
      score: overlapScore(instruction, `${thread.title} ${thread.intent} ${thread.notes}`),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.thread);
}

function matchingClaims(session, instruction) {
  return session.claims
    .map((claim) => ({
      claim,
      score: overlapScore(instruction, claim.text),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.claim);
}

function createContinuationThreadSpec(instruction, mode = "deepen") {
  const title = String(instruction).slice(0, 72);
  return {
    title: `Follow-up: ${title}`,
    intent: `address the continuation instruction: ${instruction}`,
    subqueries: [instruction],
    notes: "Created from a continuation instruction.",
    claims: [
      {
        text:
          mode === "verify"
            ? instruction
            : `There is URL-backed evidence that refines the session for: ${instruction}.`,
        claim_type: "follow_up",
        priority: "high",
      },
    ],
  };
}

export function applyContinuationInstruction(session, instruction, domains = []) {
  const trimmed = String(instruction).trim();
  if (!trimmed) {
    return null;
  }
  ensureNotAwaitingPlanApproval(session);
  const mode = inferContinuationMode(trimmed);
  const operations = [
    {
      type: "add_gap",
      gap: trimmed,
      reason: "Continuation kept this angle explicitly open in the ledger.",
    },
  ];
  if (domains.length > 0) {
    operations.push({
      type: "merge_domains",
      domains,
      reason: "Continuation introduced or reinforced domain constraints.",
    });
  }

  if (mode === "verify") {
    const matchedClaims = matchingClaims(session, trimmed).slice(0, 3);
    if (matchedClaims.length > 0) {
      for (const claim of matchedClaims) {
        operations.push({
          type: "mark_claim_stale",
          claim_id: claim.claim_id,
          reason: `Continuation requested verification for claim: ${claim.text}`,
        });
      }
    } else {
      operations.push({
        type: "add_thread",
        thread: createContinuationThreadSpec(trimmed, mode),
        reason: "Continuation created a new focused verification thread.",
      });
    }
  } else {
    const matchedThreads = mode === "branch" ? [] : matchingThreads(session, trimmed).slice(0, 2);
    if (matchedThreads.length > 0) {
      for (const thread of matchedThreads) {
        operations.push({
          type: "requeue_thread",
          thread_id: thread.thread_id,
          reason: `Continuation requested deeper gathering for thread: ${thread.title}`,
        });
      }
    } else {
      operations.push({
        type: "add_thread",
        thread: createContinuationThreadSpec(trimmed, mode),
        reason:
          mode === "branch"
            ? "Continuation branched into a new thread."
            : "Continuation created a new follow-up thread.",
      });
    }
  }

  return applyContinuationPatch(
    session,
    {
      instruction: trimmed,
      mode,
      domains,
      operations,
    },
    { action: "instruction" },
  );
}
