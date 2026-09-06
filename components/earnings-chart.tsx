// Tiny dependency-free earnings bar chart (last 8 weeks of payouts).
// Pure SVG so it renders in a server component with zero JS shipped.
export function EarningsChart({ payouts }: { payouts: Array<{ net_paise: number; created_at: string }> }) {
  const weeks = 8;
  // Derive "now" from the data (pure render — no clock call): the newest
  // payout anchors the 8-week window, which is what the chart is about anyway.
  const now = payouts.length ? Math.max(...payouts.map((p) => new Date(p.created_at).getTime())) : 0;
  const buckets = Array.from({ length: weeks }, () => 0);
  for (const p of payouts) {
    const age = Math.floor((now - new Date(p.created_at).getTime()) / (7 * 24 * 3600 * 1000));
    if (age >= 0 && age < weeks) buckets[weeks - 1 - age] += p.net_paise;
  }
  const max = Math.max(...buckets, 1);
  const W = 240, H = 56, gap = 6;
  const bw = (W - gap * (weeks - 1)) / weeks;

  if (payouts.length === 0) {
    return <p className="text-xs text-muted-foreground">Earnings appear here after your first license sale.</p>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img"
      aria-label={`Weekly earnings, last ${weeks} weeks`}>
      {buckets.map((v, i) => {
        const h = Math.max(3, (v / max) * (H - 4));
        return (
          <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={2}
            className={v > 0 ? "fill-emerald-500" : "fill-muted"} />
        );
      })}
    </svg>
  );
}
