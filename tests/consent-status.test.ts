import { describe, it, expect } from "vitest";
import { pickConsent } from "../lib/consent-status";

const rec = (id: string, status: string) => ({ id, status });

describe("which consent record governs", () => {
  it("no records at all", () => {
    expect(pickConsent([])).toEqual({ governing: undefined, awaiting: undefined });
    expect(pickConsent(null)).toEqual({ governing: undefined, awaiting: undefined });
  });

  it("a single verified grant governs", () => {
    const v = pickConsent([rec("a", "verified")]);
    expect(v.governing?.id).toBe("a");
    expect(v.awaiting).toBeUndefined();
  });

  it("THE BUG: a newer unverified take must not unseat a live verified grant", () => {
    // Newest first. Before the fix the dashboards read rows[0] and reported
    // "Pending" for a creator whose replica was live and generating.
    const v = pickConsent([rec("new", "pending"), rec("old", "verified")]);
    expect(v.governing?.id).toBe("old");
    expect(v.governing?.status).toBe("verified");
    expect(v.awaiting?.id).toBe("new");
  });

  it("a first-ever pending take governs, because nothing else does", () => {
    const v = pickConsent([rec("first", "pending")]);
    expect(v.governing?.id).toBe("first");
    expect(v.awaiting).toBeUndefined();
  });

  it("revocation is a deliberate end state and wins outright", () => {
    const v = pickConsent([rec("new", "revoked"), rec("old", "verified")]);
    expect(v.governing?.id).toBe("new");
    expect(v.governing?.status).toBe("revoked");
    expect(v.awaiting).toBeUndefined();
  });

  it("re-recording after a revocation shows the new take, not the dead one", () => {
    const v = pickConsent([rec("fresh", "pending"), rec("dead", "revoked")]);
    expect(v.governing?.id).toBe("fresh");
    expect(v.awaiting).toBeUndefined();
  });

  it("a newly verified re-record replaces the older grant", () => {
    const v = pickConsent([rec("new", "verified"), rec("old", "verified")]);
    expect(v.governing?.id).toBe("new");
    expect(v.awaiting).toBeUndefined();
  });
});
