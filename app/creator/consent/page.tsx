import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { pickConsent } from "@/lib/consent-status";
import { ConsentRecorder } from "@/components/consent-recorder";
import { ConsentPhoneHandoff } from "@/components/consent-phone-handoff";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Smartphone, ShieldCheck } from "lucide-react";

const checklist = [
  "One continuous shot — no cuts, no filters",
  "1080p camera, 25fps or higher (most modern phones and webcams qualify)",
  "Even lighting on your face, plain background",
  "Quiet room — your spoken verification phrase is checked automatically",
  "This exact recording later trains your AI replica — quality matters",
];

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { supabase, profile } = await requireProfile("creator");

  // A creator arriving here may already be protected. Recording again is
  // allowed — people change their mind about wording, lighting, or scope — but
  // it must not look like a blank first-time form, and it must be clear that
  // nothing is torn down while the new take is checked.
  const { data: consentRows } = await supabase.from("consent_records")
    .select("id, status").order("created_at", { ascending: false }).limit(5);
  const { governing } = pickConsent(consentRows);
  const alreadyProtected = governing?.status === "verified";
  // The QR handoff redirects the phone here with ?from=phone. Without reading
  // that flag the phone got the DESKTOP page: a "scan this QR with your phone"
  // panel it had just used, with the recorder pushed below it — so the one thing
  // you came to do was off-screen and the scan looked like it had done nothing.
  const { from } = await searchParams;
  const onPhone = from === "phone";

  return (
    <AppShell role="creator" displayName={profile.display_name}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Record your consent</h1>
          <p className="text-sm text-muted-foreground">
            The recording is hashed and anchored in the consent ledger. You can revoke it
            at any time — revocation instantly blocks all future video generation.
          </p>
        </div>

        {alreadyProtected && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-medium">You already have verified consent on record</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                You can record a new one — to change the wording, the framing, or just to
                improve the take. Your current consent stays in force and your replica keeps
                working until the new recording passes its checks. To withdraw permission
                instead, use <span className="font-medium text-foreground">Revoke consent</span> in
                your studio; recording again does not revoke anything.
              </p>
            </div>
          </div>
        )}

        {onPhone && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">You&apos;re on your phone — record right here</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Signed in automatically from the QR scan. Tap <b>Start camera</b> below, allow
                camera and microphone access, then read the phrase shown on screen.
              </p>
            </div>
          </div>
        )}

        {/* On the phone the recorder comes FIRST — it is the only reason you are
            here. On desktop the checklist and the hand-off-to-phone option come
            first, because choosing WHERE to record is the decision you make there. */}
        {onPhone ? (
          <>
            <div className="mb-6">
              <ConsentRecorder orgId={profile.org_id} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tips for a good take</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2">
                  {checklist.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Before you start</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {checklist.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="mb-6">
              <ConsentPhoneHandoff />
            </div>

            <ConsentRecorder orgId={profile.org_id} />
          </>
        )}
      </div>
    </AppShell>
  );
}
