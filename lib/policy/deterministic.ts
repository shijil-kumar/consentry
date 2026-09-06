// Layer 0/1 — deterministic checks (pure, <1ms). POLICY_AND_CONSENT_SPEC §3.1.
export interface ClauseRow {
  id: string;
  code: string;
  title: string;
  description: string;
  keywords: string[];
  is_platform: boolean;
}

export interface Suspicion {
  clause_code: string;
  keyword: string;
  excerpt: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary, case-insensitive, whitespace-normalized (multi-word phrases ok)
export function findSuspicions(script: string, clauses: ClauseRow[]): Suspicion[] {
  const normalized = script.toLowerCase().replace(/\s+/g, " ");
  const out: Suspicion[] = [];
  for (const clause of clauses) {
    for (const kw of clause.keywords) {
      const phrase = kw.toLowerCase().trim().replace(/\s+/g, " ");
      if (!phrase) continue;
      const re = new RegExp(`\\b${escapeRegex(phrase).replace(/ /g, "\\s+")}\\b`, "i");
      const m = re.exec(normalized);
      if (m) {
        const at = m.index;
        out.push({
          clause_code: clause.code,
          keyword: phrase,
          excerpt: normalized.slice(Math.max(0, at - 40), at + phrase.length + 40).trim(),
        });
      }
    }
  }
  return out;
}

export function categoryAllowed(category: string, allowed: string[]): boolean {
  return allowed.map((c) => c.toLowerCase()).includes(category.toLowerCase());
}

// ── Prompt-injection defenses (Layer 0.5) ────────────────────────────────
// Scripts are ENDORSEMENT COPY a replica will speak on camera. Text that
// addresses "the AI/checker/system", tries to override instructions, or
// smuggles encoded payloads has no legitimate reason to exist in one — so
// these fire as PP-INJ suspicions, which (per the engine invariant) makes
// auto-approval impossible and forces at least human review.
export const INJECTION_CLAUSE = "PP-INJ";

// Strip invisible characters used to split trigger words (zero-width, BOM,
// soft hyphen, bidi controls) + normalize unicode so homoglyph games get
// folded before ANY layer sees the text.
const INVISIBLES = new RegExp("[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]", "g");
const CONTROLS = new RegExp("[\u0000-\u0008\u000B-\u001F\u007F-\u009F]", "g");

export function sanitizeScript(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(INVISIBLES, "")
    .replace(CONTROLS, " ")
    .slice(0, 4000);
}

const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(ignore|disregard|forget|override)\b[^.!?]{0,60}\b(previous|prior|above|earlier|all|your)\b[^.!?]{0,60}\b(instruction|prompt|rule|guideline|direction)/i, label: "instruction-override phrasing" },
  { re: /\b(system\s*prompt|developer\s*message|hidden\s*prompt|your\s+instructions|initial\s+prompt)\b/i, label: "prompt-probing phrasing" },
  { re: /\b(you\s+are\s+(now|no\s+longer)|act\s+as|pretend\s+to\s+be|roleplay\s+as|jailbreak|DAN\s+mode|developer\s+mode)\b/i, label: "role-reassignment phrasing" },
  { re: /^\s*(system|assistant|user|human|ai)\s*:/im, label: "chat role marker" },
  { re: /<\/?\s*(system|instructions?|admin|prompt|policy)\b[^>]*>/i, label: "instruction-tag markup" },
  { re: /\b(verdict|outcome|result)\b[^.!?]{0,40}\b(pass|approved?|auto[\s_-]?approved?)\b/i, label: "verdict-forcing phrasing" },
  { re: /\b(mark|set|return|output|report)\b[^.!?]{0,40}\b(as\s+)?(pass(ed)?|approved?|compliant|safe)\b/i, label: "verdict-forcing phrasing" },
  { re: /\b(report_policy_verdict|tool_use|input_schema|function\s+call)\b/i, label: "tool/schema reference" },
  { re: /\b(this\s+(script|message|request)\s+(has|was|is)\s+(been\s+)?(pre[- ]?approved|authori[sz]ed|whitelisted|cleared))\b/i, label: "false-authorization claim" },
  { re: /[A-Za-z0-9+/]{80,}={0,2}/, label: "long encoded blob" },
  { re: /\bcompliance\s+(gate|checker|reviewer|system)\b/i, label: "addresses the checker" },
  { re: /\b(1gn0re|ign0re|d[i1]sregard)\b/i, label: "leetspeak override phrasing" },
  { re: /\bdo\s+anything\s+now\b/i, label: "DAN jailbreak phrasing" },
  { re: /\b(as\s+an\s+ai|you\s+must\s+comply|end\s+of\s+(rules|instructions|policy))\b/i, label: "AI-directive phrasing" },
];

export function findInjectionSignals(script: string): Suspicion[] {
  const out: Suspicion[] = [];
  for (const { re, label } of INJECTION_PATTERNS) {
    const m = re.exec(script);
    if (m) {
      const at = m.index;
      out.push({
        clause_code: INJECTION_CLAUSE,
        keyword: label,
        excerpt: script.slice(Math.max(0, at - 30), at + Math.min(m[0].length, 60) + 30).trim(),
      });
    }
  }
  return out;
}
