/* eslint-disable @typescript-eslint/no-explicit-any */
// Pre-deploy audit — one command, twelve areas.
//
//   npm run audit              → against production (consentry.app)
//   AUDIT_BASE=http://localhost:3101 npm run audit   → against a local server
//
// Exit code is non-zero when anything FAILS, so it can gate a deploy.
import { preflight } from "./preflight";
import { BASE, actorFor, summary, area, info, warn } from "./lib";
import { buildFixtures } from "./fixtures";
import { auditSecrets, auditAuthz, auditSession, auditMassAssignment, auditWebhooks, auditHeaders } from "./security";
import { auditConcurrency, auditMoney, auditInputValidation, auditIdempotency } from "./integrity";
import { auditDependencies, auditUx, auditStorage } from "./quality";

(async () => {
  const started = Date.now();
  console.log(`\n\x1b[1mCONSENTRY PRE-DEPLOY AUDIT\x1b[0m`);
  console.log(`target: ${BASE}`);
  console.log(`time:   ${new Date().toISOString()}`);

  // Preflight first: never audit (or build) against a broken environment.
  const pf = await preflight({ forBuild: process.argv.includes("--build") });
  area(0, "PREFLIGHT");
  pf.notes.forEach((n) => info(n));
  if (!pf.ok) {
    console.log("\n\x1b[31mPreflight failed — fix the above before continuing.\x1b[0m");
    process.exit(1);
  }

  // Real sessions, minted once and shared.
  let buyer, creator, adminActor;
  try {
    [buyer, creator, adminActor] = await Promise.all([
      actorFor("buyer"), actorFor("creator"), actorFor("admin"),
    ]);
    info("sessions minted", `buyer/creator/admin via anon key (never service role)`);
  } catch (e) {
    console.error(`\n\x1b[31mCould not mint sessions: ${(e as Error).message}\x1b[0m`);
    process.exit(1);
  }

  // Manufacture the preconditions the dangerous tests need, so none of them
  // silently skip. Torn down in the finally block regardless of outcome.
  area(0, "FIXTURES");
  const fx = await buildFixtures(buyer.orgId);

  let failures = 0;
  try {
    // Order matters: cheap static checks first, state-changing ones last.
    await auditSecrets();
    await auditAuthz(buyer, creator, adminActor, fx.foreignGenerationId);
    await auditSession(buyer);
    await auditMassAssignment();
    await auditConcurrency(buyer, fx.pendingLicenseId);
    await auditMoney();
    await auditInputValidation(buyer);
    await auditWebhooks();
    await auditIdempotency(buyer, fx.approvalToken);
    await auditHeaders();
    await auditDependencies();
    await auditStorage();
    await auditUx(creator);
  } finally {
    area(99, "CLEANUP");
    await fx.cleanup();
  }

  failures = summary();
  console.log(`\nfinished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (failures > 0) {
    console.log(`\x1b[31m${failures} FAILURE(S) — do not deploy until these are resolved or consciously accepted.\x1b[0m`);
  } else {
    console.log(`\x1b[32mNo failures. Warnings above are checks that could not be exercised — read them.\x1b[0m`);
  }
  process.exit(failures > 0 ? 1 : 0);
})().catch((e) => {
  console.error("\nAUDIT CRASHED:", e);
  process.exit(2);
});
