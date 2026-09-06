/* eslint-disable @typescript-eslint/no-explicit-any */
// Audit areas 11–12: dependencies and UX integrity.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { BASE, admin, area, check, warn, info, type Actor, REF } from "./lib";

// ── 11. DEPENDENCIES ────────────────────────────────────────────────────────
// ── 13. STORAGE HYGIENE ─────────────────────────────────────────────────────
// Every render writes a preview and a master. Demo runs and probes deleted the
// DATABASE rows and left the FILES, so the bucket grew unbounded — 413 MB of
// unreachable objects by 2026-08-18. The first visible symptom of a project
// nearing its storage ceiling is an upload failing, which on stage looks like
// "the video didn't render". Catch it here, weeks earlier.
export async function auditStorage() {
  area(13, "STORAGE HYGIENE — orphaned renders");
  const { data: live } = await admin.from("generations").select("id");
  const liveIds = new Set((live ?? []).map((g: { id: string }) => g.id));

  let orphans = 0, kept = 0, bytes = 0;
  const { data: orgs } = await admin.storage.from("deliverables").list("", { limit: 1000 });
  for (const org of orgs ?? []) {
    const { data: gens } = await admin.storage.from("deliverables").list(org.name, { limit: 1000 });
    for (const gen of gens ?? []) {
      const { data: files } = await admin.storage
        .from("deliverables").list(`${org.name}/${gen.name}`, { limit: 100 });
      for (const f of files ?? []) {
        const size = Number((f as { metadata?: { size?: number } }).metadata?.size ?? 0);
        bytes += size;
        if (liveIds.has(gen.name)) kept++;
        else { orphans++; }
      }
    }
  }
  const mb = (n: number) => `${(n / 1_000_000).toFixed(0)} MB`;
  info("deliverables bucket", `${kept + orphans} file(s), ${mb(bytes)}`);
  // A handful in flight is normal; a pile means cleanup is not running.
  check("no pile of orphaned renders (deleted generations leaving files behind)",
    orphans <= 20, `${orphans} orphan(s) — run: npm run purge:media -- --apply`);
  // Free-tier Supabase gives 1 GB. Warn well before an upload starts failing.
  check("storage is comfortably below the 1 GB tier limit", bytes < 700_000_000, mb(bytes));

  // The admin console prints an organisation count. Test runs create orgs and
  // never remove them, and by 2026-08-21 that had reached 631 of 650 — so the
  // console advertised traction that did not exist. An inflated number in front
  // of an investor is worse than an untidy database.
  const { findOrphanOrgs } = await import("../purge-orphan-orgs");
  const orphanOrgs = await findOrphanOrgs();
  const { count: totalOrgs } = await admin.from("orgs").select("id", { count: "exact", head: true });
  info("organisations", `${totalOrgs} total, ${(totalOrgs ?? 0) - orphanOrgs.length} with real activity`);
  check("the organisation count on the console is honest (few orphans)",
    orphanOrgs.length <= 10,
    `${orphanOrgs.length} orphan(s) — run: npm run purge:orgs -- --apply`);
}

export async function auditDependencies() {
  area(11, "DEPENDENCIES — production tree only");
  let raw = "";
  try {
    raw = execFileSync("npm", ["audit", "--omit=dev", "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true });
  } catch (e: any) {
    // npm audit exits non-zero when vulnerabilities exist — the JSON is still on stdout.
    raw = e?.stdout ?? "";
  }
  if (!raw) { warn("npm audit", "could not run"); return; }
  let report: any;
  try { report = JSON.parse(raw); } catch { warn("npm audit", "unparseable output"); return; }

  const v = report.metadata?.vulnerabilities ?? {};
  const total = Object.values(v).reduce((a: number, b: any) => a + Number(b), 0);
  info("production vulnerability counts",
    `critical=${v.critical ?? 0} high=${v.high ?? 0} moderate=${v.moderate ?? 0} low=${v.low ?? 0}`);

  check("no CRITICAL vulnerabilities in production dependencies", (v.critical ?? 0) === 0, `${v.critical ?? 0} found`);
  check("no HIGH vulnerabilities in production dependencies", (v.high ?? 0) === 0, `${v.high ?? 0} found`);
  if ((v.moderate ?? 0) > 0 || (v.low ?? 0) > 0) {
    const names = Object.keys(report.vulnerabilities ?? {}).slice(0, 8).join(", ");
    warn("moderate/low advisories present", `${(v.moderate ?? 0) + (v.low ?? 0)} — ${names}`);
  }
  if (total === 0) info("clean", "no advisories in the production tree");
}

// ── 12. UX INTEGRITY ────────────────────────────────────────────────────────
export async function auditUx(creator: Actor) {
  area(12, "UX INTEGRITY — every page loads, is titled, labelled and linked");

  const PUBLIC = ["/", "/celebrities", "/actors", "/marketplace", "/inspect",
                  "/request-a-star", "/login", "/signup", "/c/arjun"];
  const PRIVATE = ["/creator", "/creator/requests", "/creator/protection", "/creator/listing"];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{
    name: `sb-${REF}-auth-token`,
    value: creator.cookie.split("=").slice(1).join("="),
    domain: new URL(BASE).hostname, path: "/", sameSite: "Lax", secure: true,
  }]);
  const page = await ctx.newPage();

  const consoleErrors: Record<string, string[]> = {};
  let current = "";
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Third-party/media noise that is not an app defect.
    if (/favicon|ERR_INTERNET_DISCONNECTED|Download the React DevTools|net::ERR_ABORTED.*\.mp4/i.test(t)) return;
    (consoleErrors[current] ??= []).push(t.slice(0, 140));
  });

  const titles = new Map<string, string>();
  const allPaths = [...PUBLIC, ...PRIVATE];

  for (const p of allPaths) {
    current = p;
    const resp = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }).catch(() => null);
    const status = resp?.status() ?? 0;
    check(`${p} returns 200`, status === 200, `HTTP ${status}`);
    if (status !== 200) continue;

    const m = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")];
      const btns = [...document.querySelectorAll("button")];
      const unlabelled = btns.filter((b) => {
        const text = (b.textContent ?? "").trim();
        const aria = b.getAttribute("aria-label") ?? b.getAttribute("title") ?? "";
        return !text && !aria;
      }).length;
      return {
        title: document.title,
        imgsMissingAlt: imgs.filter((i) => !i.hasAttribute("alt")).length,
        imgCount: imgs.length,
        unlabelledButtons: unlabelled,
        internalLinks: [...new Set([...document.querySelectorAll("a[href^='/']")]
          .map((a) => (a as HTMLAnchorElement).getAttribute("href")!)
          .filter((h) => !h.startsWith("//") && !h.includes("#")))].slice(0, 25),
      };
    });

    titles.set(p, m.title);
    check(`${p} has a non-empty <title>`, m.title.trim().length > 0, `"${m.title}"`);
    check(`${p} — every image has alt text`, m.imgsMissingAlt === 0,
      `${m.imgsMissingAlt} of ${m.imgCount} missing`);
    check(`${p} — every button is labelled`, m.unlabelledButtons === 0,
      `${m.unlabelledButtons} unlabelled`);

    // Internal links must not 404.
    const broken: string[] = [];
    for (const href of m.internalLinks) {
      const r = await fetch(`${BASE}${href}`, { method: "GET", redirect: "manual" }).catch(() => null);
      const s = r?.status ?? 0;
      if (s === 404 || s === 500 || s === 0) broken.push(`${href} → ${s}`);
    }
    check(`${p} — no broken internal links (${m.internalLinks.length} checked)`,
      broken.length === 0, broken.join(", "));
  }

  // Titles must be DISTINCT — duplicate titles are a real SEO/usability defect
  // and usually mean a page forgot its own metadata.
  const seen = new Map<string, string[]>();
  for (const [p, t] of titles) (seen.get(t) ?? seen.set(t, []).get(t)!).push(p);
  const dupes = [...seen.entries()].filter(([, ps]) => ps.length > 1);
  check("every page has a DISTINCT title", dupes.length === 0,
    dupes.map(([t, ps]) => `"${t}" on ${ps.join(" + ")}`).join("; "));

  const noisy = Object.entries(consoleErrors).filter(([, errs]) => errs.length > 0);
  check("no console errors on any page", noisy.length === 0,
    noisy.map(([p, e]) => `${p}: ${e[0]}`).join(" | "));

  await browser.close();
}
