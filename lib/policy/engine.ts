import {
  categoryAllowed, findSuspicions, findInjectionSignals, sanitizeScript,
  INJECTION_CLAUSE, type ClauseRow, type Suspicion,
} from "./deterministic";
import { runLlm, type LlmVerdict } from "./llm";

// Verdict merge — POLICY_AND_CONSENT_SPEC §3.1. FAIL-CLOSED:
// anything uncertain, low-confidence, contradictory, or errored → needs_review.
export const ENGINE_VERSION = "engine/0.1.0";

export interface CitedClause {
  code: string;
  title: string;
  description: string;
  evidence_excerpt?: string;
}

export interface PolicyReport {
  outcome: "auto_approved" | "rejected" | "needs_review";
  engine_version: string;
  cited_clauses: CitedClause[];
  layer1: { category_ok: boolean; suspicions: Suspicion[] };
  llm: LlmVerdict;
  checked_at: string;
  latency_ms: number;
}

export async function runPolicyEngine(input: {
  script: string;
  category: string;
  allowedCategories: string[];
  clauses: ClauseRow[]; // enabled creator clauses + ALL platform clauses
  llmOverride?: string | null; // dev/test only (DEV_OPEN-gated in the route)
}): Promise<PolicyReport> {
  const started = Date.now();
  const catalog = new Map(input.clauses.map((c) => [c.code, c]));
  const cite = (code: string, excerpt?: string): CitedClause => {
    const c = catalog.get(code);
    if (code === INJECTION_CLAUSE && !c) {
      return { code, title: "Manipulation attempt", description: "The script contains text aimed at the review system rather than an audience — instruction overrides, verdict forcing, false authorization claims, or encoded payloads.", ...(excerpt ? { evidence_excerpt: excerpt } : {}) };
    }
    return {
      code,
      title: c?.title ?? code,
      description: c?.description ?? "",
      ...(excerpt ? { evidence_excerpt: excerpt } : {}),
    };
  };

  // Layer 0 — sanitize BEFORE anything reads the text (strips zero-width
  // smuggling, folds homoglyphs, caps length)
  const script = sanitizeScript(input.script);

  // Layer 0.5/1 — deterministic: injection signals + clause keywords.
  // Injection signals join the suspicion list, so the auto-approve invariant
  // below (requires ZERO suspicions) makes a successful jailbreak of the LLM
  // insufficient on its own — the deterministic layer cannot be sweet-talked.
  const categoryOk = categoryAllowed(input.category, input.allowedCategories);
  const injectionSignals = findInjectionSignals(script);
  const suspicions = [...injectionSignals, ...findSuspicions(script, input.clauses)];
  const base = {
    engine_version: ENGINE_VERSION,
    layer1: { category_ok: categoryOk, suspicions },
    checked_at: new Date().toISOString(),
  };

  if (!categoryOk) {
    return {
      ...base,
      outcome: "rejected",
      cited_clauses: [cite("PP-06")],
      llm: { mode: "off" as const, verdict: "uncertain", confidence: 0, violations: [], reasoning: "not run: category rejected deterministically" },
      latency_ms: Date.now() - started,
    };
  }

  // Layer 2 — LLM (or its stand-ins). Receives the SANITIZED script.
  const llm = await runLlm(script, input.category, input.clauses, suspicions, input.llmOverride);

  let outcome: PolicyReport["outcome"];
  let cited: CitedClause[] = [];
  if (llm.verdict === "violation" && llm.confidence >= 0.8) {
    outcome = "rejected";
    cited = llm.violations.map((v) => cite(v.clause_code, v.evidence_excerpt));
    if (cited.length === 0) cited = suspicions.map((s) => cite(s.clause_code, s.excerpt));
    // Invariant: a rejection MUST cite ≥1 clause (buyer's blocked screen needs a
    // reason). If the model claimed a violation with no citable clause, fail
    // closed to manual review instead of a reasonless block.
    if (cited.length === 0) outcome = "needs_review";
  } else if (llm.verdict === "pass" && llm.confidence >= 0.8 && suspicions.length === 0 && !llm.error) {
    outcome = "auto_approved";
  } else {
    outcome = "needs_review"; // fail-closed: uncertainty, contradiction, or error
    cited = llm.violations.map((v) => cite(v.clause_code, v.evidence_excerpt));
  }

  return { ...base, outcome, cited_clauses: cited, llm, latency_ms: Date.now() - started };
}
