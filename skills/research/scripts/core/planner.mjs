import {
  appendDecision,
  createId,
  getThreadById,
  mergeUniqueStrings,
  queueWorkItem,
} from "./session_schema.mjs";
import { classifyTaskShape, normalizeGoal } from "./router.mjs";

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

function buildVerificationPlan(goal) {
  const directThread = createThread(
    "Direct verification",
    "verify the user’s core assertion directly",
    [`${goal} official evidence`],
  );
  const caveatThread = createThread(
    "Caveats and contradictory evidence",
    "look for exceptions, caveats, or contradictory statements",
    [`${goal} contradictory evidence`],
  );

  const claims = [
    createClaim(directThread.thread_id, goal, "fact", "high"),
    createClaim(
      caveatThread.thread_id,
      `There is official or primary-source evidence that can confirm, qualify, or reject: ${goal}.`,
      "policy",
      "high",
    ),
  ];

  return {
    threads: attachClaimsToThreads([directThread, caveatThread], claims),
    claims,
    remainingGaps: [
      "Does any primary source contradict or qualify the claim?",
      "Is the evidence current enough for the user’s question?",
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
