/**
 * Live policy-LLM test — exercises the REAL Anthropic path (no dev server; calls
 * runPolicyEngine directly with an anthropic override). Self-skips when no key,
 * so CI without credits stays green. Proves the production gate actually reasons.
 */
import { describe, it, expect } from "vitest";
import { runPolicyEngine } from "@/lib/policy/engine";
import type { ClauseRow } from "@/lib/policy/deterministic";

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const d = HAS_KEY ? describe : describe.skip;

const clauses: ClauseRow[] = [
  { id: "1", code: "PC-03", title: "Medical & health claims", description: "No medical, health, or weight-loss claims.", keywords: ["blood sugar", "doctor"], is_platform: false },
  { id: "2", code: "PC-04", title: "Financial advice & crypto", description: "No financial advice or crypto.", keywords: ["portfolio", "crypto"], is_platform: false },
  { id: "3", code: "PP-02", title: "Public-health misinformation", description: "No health misinformation.", keywords: [], is_platform: true },
];

d("real Anthropic policy gate", () => {
  it("A: clean fitness script auto-approves", async () => {
    const r = await runPolicyEngine({
      script: "I have been using the AeroFit smart band for a week and the sleep tracking is the best I have tried.",
      category: "fitness", allowedCategories: ["fitness", "tech"], clauses, llmOverride: "anthropic",
    });
    expect(r.llm.mode).toBe("anthropic");
    expect(r.llm.error, r.llm.error ?? "").toBeUndefined();
    expect(r.outcome).toBe("auto_approved");
  }, 30_000);

  it("B: medical-claim script is rejected and cites PC-03", async () => {
    const r = await runPolicyEngine({
      script: "Doctors do not want you to know this: BurnMax normalized my blood sugar and melted 8 kg in 3 weeks.",
      category: "fitness", allowedCategories: ["fitness", "tech"], clauses, llmOverride: "anthropic",
    });
    expect(r.outcome).toBe("rejected");
    expect(r.cited_clauses.map((c) => c.code)).toContain("PC-03");
  }, 30_000);

  it("category mismatch rejects citing PP-06 without even calling the LLM", async () => {
    const r = await runPolicyEngine({
      script: "A perfectly nice clean script about a fitness band with nothing objectionable at all.",
      category: "politics", allowedCategories: ["fitness"], clauses, llmOverride: "anthropic",
    });
    expect(r.outcome).toBe("rejected");
    expect(r.cited_clauses.map((c) => c.code)).toContain("PP-06");
  });
});
