import Link from "next/link";

// Upgraded stat card (21st.dev stats-card pattern): tinted icon chip, big
// value, optional hint or custom body — with a soft gradient + hover lift.
//
// The card lifts on hover, which reads as "clickable" — but it was always a
// plain div, so every click did nothing. Pass `href` to make the affordance
// honest; without one the card stays visibly static.
export function StatCard({ icon: Icon, label, value, hint, tone = "emerald", href, children }: {
  icon: React.ElementType;
  label: string;
  value?: string;
  hint?: string;
  tone?: "emerald" | "sky" | "amber" | "violet";
  href?: string;
  children?: React.ReactNode;
}) {
  const tones = {
    emerald: "bg-emerald-100 text-emerald-700",
    sky: "bg-sky-100 text-sky-700",
    amber: "bg-amber-100 text-amber-700",
    violet: "bg-violet-100 text-violet-700",
  } as const;
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={`flex size-8 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="size-4" />
        </span>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      {value !== undefined && <p className="mt-2.5 text-2xl font-semibold capitalize tracking-tight">{value}</p>}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </>
  );
  const base = "block rounded-2xl border bg-gradient-to-b from-card to-muted/30 p-4 shadow-sm";
  return href ? (
    <Link href={href} className={`group ${base} transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}
