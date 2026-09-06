// Which consent record actually GOVERNS a creator right now?
//
// `submit_consent` always inserts, so a creator who records a second time has
// two rows. Every dashboard used to read "the newest row", which produced a
// straightforwardly false claim: a creator with a live, verified consent and a
// working replica who recorded again saw their status flip to "Pending" — while
// the avatar carried on generating under the consent it was actually trained on.
// Worse, the Revoke button is gated on `status === "verified"`, so re-recording
// silently removed the one control the whole product promises.
//
// The record that governs is the one that authorises the live replica: the most
// recent VERIFIED grant. A newer unverified take is a separate thing — worth
// surfacing, but it does not revoke anything and must not be mistaken for the
// current state.

export interface ConsentLike {
  id: string;
  status: string;
}

export interface ConsentView<T extends ConsentLike> {
  /** The grant in force. What every status badge and the Revoke control use. */
  governing: T | undefined;
  /** A newer take still being checked, if any. Shown as an aside, never as the status. */
  awaiting: T | undefined;
}

/** @param rows consent records for one org, NEWEST FIRST. */
export function pickConsent<T extends ConsentLike>(rows: readonly T[] | null | undefined): ConsentView<T> {
  const list = rows ?? [];
  const newest = list[0];
  if (!newest) return { governing: undefined, awaiting: undefined };

  // A newest row that is itself verified — or revoked, which is a deliberate
  // end state the creator chose — is the whole truth.
  if (newest.status === "verified" || newest.status === "revoked") {
    return { governing: newest, awaiting: undefined };
  }

  // Otherwise a fresh take is in flight. An earlier verified grant, if there is
  // one, is still what authorises everything running today.
  const verified = list.find((r) => r.status === "verified");
  return verified ? { governing: verified, awaiting: newest } : { governing: newest, awaiting: undefined };
}
