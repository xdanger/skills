import {
  getClaimById,
  getThreadById,
  isRealEvidence,
  mergeUniqueStrings,
  nextQueuedWorkItem,
  uniqueBy,
} from "./session_schema.mjs";

function confidenceLabel(score) {
  if (score >= 0.8) {
    return "high";
  }
  if (score >= 0.5) {
    return "medium";
  }
  return "low";
}

function citationsForEvidence(evidence) {
  return uniqueBy(
    evidence.filter((item) => item.url),
    (item) => item.url,
  ).map((item) => ({
    title: item.title,
    url: item.url,
  }));
}

function observationsForThread(session, threadId) {
  return session.observations.filter((item) => item.thread_id === threadId);
}

function entityName(session, entityId) {
  return (
    session.entities.find((item) => item.entity_id === entityId)?.display_name ??
    "Unknown entity"
  );
}

function evidenceForThread(session, thread) {
  return session.evidence.filter(
    (item) =>
      isRealEvidence(item) &&
      item.claim_links.some((link) => thread.claim_ids.includes(link.claim_id)),
  );
}

function threadSummary(session, thread) {
  const claims = thread.claim_ids
    .map((claimId) => getClaimById(session, claimId))
    .filter(Boolean);
  const supported = claims.filter(
    (claim) =>
      claim.assessment.sufficiency === "sufficient" && claim.assessment.verdict === "supported",
  );
  const rejected = claims.filter(
    (claim) =>
      claim.assessment.sufficiency === "sufficient" && claim.assessment.verdict === "rejected",
  );
  const mixed = claims.filter(
    (claim) =>
      claim.assessment.resolution_state !== "resolved" ||
      claim.assessment.sufficiency !== "sufficient" ||
      claim.verification.stale,
  );
  const evidence = evidenceForThread(session, thread);
  const citations = citationsForEvidence(evidence).slice(0, 3);
  const observations = observationsForThread(session, thread.thread_id)
    .slice(0, 4)
    .map((item) => ({
      entity: entityName(session, item.entity_id),
      facet: item.facet,
      text: item.text,
    }));

  let summary = "No decisive evidence has been gathered yet.";
  if (supported.length > 0) {
    summary = supported.map((claim) => claim.text).join(" ");
  }
  if (rejected.length > 0) {
    const rejectedSummary = rejected
      .map((claim) => `Available evidence rejects: ${claim.text}`)
      .join(" ");
    summary =
      summary === "No decisive evidence has been gathered yet."
        ? rejectedSummary
        : `${summary} ${rejectedSummary}`.trim();
  }
  if (mixed.length > 0) {
    summary =
      `${summary} Unresolved or stale evidence remains for ${mixed.length} claim(s).`.trim();
  }

  return {
    thread_id: thread.thread_id,
    title: thread.title,
    summary,
    claim_ids: thread.claim_ids,
    citations,
    gather_rounds: thread.execution.gather_rounds,
    entity_observations: observations,
  };
}

export function synthesizeAnswer(session) {
  const threadSummaries = session.threads.map((thread) => threadSummary(session, thread));
  const keyFindings = session.claims
    .filter(
      (claim) =>
        claim.assessment.sufficiency === "sufficient" &&
        (claim.assessment.verdict === "supported" || claim.assessment.verdict === "rejected"),
    )
    .map((claim) =>
      claim.assessment.verdict === "rejected" ? `Rejected: ${claim.text}` : claim.text,
    );
  const unresolvedQuestions = mergeUniqueStrings(
    session.stop_status.remaining_gaps,
    session.claims
      .filter(
        (claim) =>
          claim.assessment.sufficiency !== "sufficient" ||
          claim.assessment.resolution_state !== "resolved" ||
          claim.verification.stale,
      )
      .map((claim) => claim.text),
  );
  const synthesisSections = threadSummaries.map((thread) => ({
    section_id: `section-${thread.thread_id}`,
    title: thread.title,
    summary: thread.summary,
    entity_observations: thread.entity_observations,
    citations: thread.citations,
  }));
  const citations = uniqueBy(
    threadSummaries.flatMap((thread) => thread.citations),
    (item) => item.url,
  ).slice(0, 8);

  session.final_answer = {
    answer_summary:
      keyFindings.length > 0
        ? keyFindings.slice(0, 3).join(" ")
        : "The session did not reach strong evidence-backed findings yet.",
    key_findings: keyFindings,
    thread_summaries: threadSummaries,
    synthesis_sections: synthesisSections,
    unresolved_questions: unresolvedQuestions,
    confidence_explanation: `Confidence is ${confidenceLabel(
      session.scores.confidence_score,
    )} based on claim coverage, primary-source support, diversity, and contradiction penalty.`,
    citations,
    generated_at: new Date().toISOString(),
  };
  session.status = "completed";
}

export function summarizeSession(session) {
  const activeWorkItem = nextQueuedWorkItem(session);
  return {
    session_id: session.session_id,
    session_version: session.session_version,
    status: session.status,
    stage: session.stage,
    task_shape: session.task_shape,
    goal: session.goal,
    scores: session.scores,
    stop_status: session.stop_status,
    active_work_item: activeWorkItem
      ? {
          kind: activeWorkItem.kind,
          scope_type: activeWorkItem.scope_type,
          scope_id: activeWorkItem.scope_id,
          reason: activeWorkItem.reason,
        }
      : null,
    open_high_priority_claims: session.claims
      .filter(
        (claim) =>
          claim.priority === "high" &&
          (claim.assessment.sufficiency !== "sufficient" ||
            claim.assessment.resolution_state !== "resolved" ||
            claim.verification.stale),
      )
      .map((claim) => claim.text),
    unresolved_contradictions: session.contradictions
      .filter((item) => item.status === "open")
      .map((item) => item.summary),
    updated_at: session.updated_at,
  };
}

export function summarizeReport(session) {
  const planLines =
    session.threads.length > 0
      ? session.threads.map((thread) => `- ${thread.title}: ${thread.intent}`).join("\n")
      : "- No research plan recorded.";

  const findingsLines =
    session.final_answer.key_findings.length > 0
      ? session.final_answer.key_findings.map((item) => `- ${item}`).join("\n")
      : "- No evidence-backed findings yet.";

  const gapLines =
    session.final_answer.unresolved_questions.length > 0
      ? session.final_answer.unresolved_questions.map((item) => `- ${item}`).join("\n")
      : "- No unresolved gaps.";

  const synthesisLines =
    session.final_answer.thread_summaries.length > 0
      ? session.final_answer.thread_summaries
          .map((item) => `- ${item.title}: ${item.summary}`)
          .join("\n")
      : session.final_answer.answer_summary || "No final synthesis available yet.";

  const citationLines =
    session.final_answer.citations.length > 0
      ? session.final_answer.citations
          .map((item, index) => `[${index + 1}] ${item.title} — ${item.url}`)
          .join("\n")
      : "- No citations recorded.";

  return [
    "# Research Plan",
    "",
    planLines,
    "",
    "# Interim Findings",
    "",
    findingsLines,
    "",
    "# Evidence Gaps",
    "",
    gapLines,
    "",
    "# Final Synthesis",
    "",
    synthesisLines,
    "",
    "Citations:",
    citationLines,
    "",
    "# Confidence and Unresolved Questions",
    "",
    session.final_answer.confidence_explanation,
    "",
    `Stop decision: ${session.stop_status.decision}`,
    `Reason: ${session.stop_status.reason}`,
    "",
    "Unresolved questions:",
    gapLines,
  ].join("\n");
}

export function sourcesForSession(session) {
  return uniqueBy(
    session.evidence.filter((item) => item.url),
    (item) => item.url,
  ).map((item) => ({
    claims: item.claim_links
      .map((link) => ({
        claim: getClaimById(session, link.claim_id)?.text ?? "",
        stance: link.stance,
      }))
      .filter((link) => link.claim),
    thread_titles: uniqueBy(
      item.claim_links
        .map((link) =>
          getThreadById(session, getClaimById(session, link.claim_id)?.thread_id ?? ""),
        )
        .filter(Boolean)
        .map((thread) => thread.title),
      (threadTitle) => threadTitle,
    ),
    title: item.title,
    url: item.url,
    domain: item.domain,
    source_type: item.source_type,
    quality: item.quality,
  }));
}
