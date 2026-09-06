// Local render check: runs assets/mock-raw.mp4 through the real pipeline and
// writes frames out so the burn-in can be inspected by eye.
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { makePreview, processDeliverable, probeMedia, extractFrame } from "../lib/media/pipeline";

(async () => {
  console.log("probe:", JSON.stringify(await probeMedia()));
  const raw = await readFile(path.join(process.cwd(), "assets", "mock-raw.mp4"));
  const prev = await makePreview(raw);
  console.log("preview bytes:", prev?.length, "| identical to master?", prev?.equals(raw));
  if (prev) await writeFile("probe-preview.jpg", (await extractFrame(prev, 2))!);
  const res = await processDeliverable(raw, {
    generationId: "x", licenseId: "y", requestId: "z", creatorHandle: "arjun",
    buyerOrgName: "Acme Wellness", consentRecordHash: "h", consentVerifiedAt: null,
    scriptSha256: "s", licenseExpiresAt: null, verifyUrl: "https://x/verify/1", provider: "mock",
  });
  console.log("delivery watermarked:", res.watermarked, "| signed:", res.signed, "| notes:", res.notes);
  await writeFile("probe-delivery.jpg", (await extractFrame(res.bytes, 2))!);
})().catch((e) => { console.error(e); process.exit(1); });
