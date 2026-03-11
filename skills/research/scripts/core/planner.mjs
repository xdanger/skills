import {
  appendDecision,
  createId,
  fail,
  getThreadById,
  mergeUniqueStrings,
  queueWorkItem,
  syncSessionStage,
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

export function applyResearchPlan(
  session,
  rawPlan,
  { mode = "replace", parentWorkItemId = null } = {},
) {
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
  if (session.planning_artifacts.comparison_axes.length === 0 && session.task_shape) {
    session.planning_artifacts.comparison_axes = defaultComparisonAxes(session.task_shape);
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
    if (session.planning_artifacts.comparison_axes.length === 0) {
      session.planning_artifacts.comparison_axes = defaultComparisonAxes(session.task_shape);
    }
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

function createContinuationThread(session, continuation) {
  const title = continuation.instruction.slice(0, 72);
  const thread = createThread(
    `Follow-up: ${title}`,
    `address the continuation instruction: ${continuation.instruction}`,
    [continuation.instruction],
    "Created from a continuation instruction.",
  );
  const claimText =
    continuation.mode === "verify"
      ? continuation.instruction
      : `There is URL-backed evidence that refines the session for: ${continuation.instruction}.`;
  const claim = createClaim(thread.thread_id, claimText, "follow_up", "high");
  thread.claim_ids = [claim.claim_id];
  thread.execution.open_claim_ids = [claim.claim_id];
  session.threads.push(thread);
  session.claims.push(claim);
  continuation.created_thread_ids.push(thread.thread_id);
  return thread;
}

export function applyContinuationInstruction(session, instruction, domains = []) {
  const trimmed = String(instruction).trim();
  if (!trimmed) {
    return null;
  }

  const continuation = {
    continuation_id: createId("continuation"),
    instruction: trimmed,
    mode: inferContinuationMode(trimmed),
    created_at: new Date().toISOString(),
    applied_at: new Date().toISOString(),
    domains,
    affected_thread_ids: [],
    created_thread_ids: [],
    stale_claim_ids: [],
    notes: [],
  };
  session.continuations.push(continuation);

  session.stop_status.remaining_gaps = mergeUniqueStrings(session.stop_status.remaining_gaps, [
    trimmed,
  ]);
  session.planning_artifacts.continuation_notes = mergeUniqueStrings(
    session.planning_artifacts.continuation_notes,
    [trimmed],
  );

  if (continuation.mode === "verify") {
    const matchedClaims = matchingClaims(session, trimmed).slice(0, 3);
    if (matchedClaims.length > 0) {
      for (const claim of matchedClaims) {
        claim.verification.stale = true;
        claim.verification.status = "queued";
        claim.verification.last_continuation_id = continuation.continuation_id;
        continuation.stale_claim_ids.push(claim.claim_id);
        queueWorkItem(session, {
          kind: "verify_claim",
          scopeType: "claim",
          scopeId: claim.claim_id,
          continuationId: continuation.continuation_id,
          reason: `Continuation requested verification for claim: ${claim.text}`,
        });
      }
    } else {
      const thread = createContinuationThread(session, continuation);
      queueWorkItem(session, {
        kind: "gather_thread",
        scopeType: "thread",
        scopeId: thread.thread_id,
        continuationId: continuation.continuation_id,
        keySuffix: "round-1",
        reason: `Continuation created a new focused verification thread.`,
      });
    }
  } else {
    const matchedThreads =
      continuation.mode === "branch" ? [] : matchingThreads(session, trimmed).slice(0, 2);
    const targets =
      matchedThreads.length > 0
        ? matchedThreads
        : [createContinuationThread(session, continuation)];
    for (const thread of targets) {
      const targetThread = getThreadById(session, thread.thread_id) ?? thread;
      targetThread.execution.gather_status = "queued";
      targetThread.execution.last_continuation_id = continuation.continuation_id;
      continuation.affected_thread_ids.push(targetThread.thread_id);
      queueWorkItem(session, {
        kind: "gather_thread",
        scopeType: "thread",
        scopeId: targetThread.thread_id,
        continuationId: continuation.continuation_id,
        keySuffix: `round-${targetThread.execution.gather_rounds + 1}`,
        reason: `Continuation requested deeper gathering for thread: ${targetThread.title}`,
      });
    }
  }

  appendDecision(session, "instruction", `Applied continuation instruction: ${trimmed}`, {
    continuation_id: continuation.continuation_id,
    mode: continuation.mode,
    affected_thread_ids: continuation.affected_thread_ids,
    created_thread_ids: continuation.created_thread_ids,
    stale_claim_ids: continuation.stale_claim_ids,
  });
  return continuation;
}
