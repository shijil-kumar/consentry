import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/payments";

export const maxDuration = 30;

// Razorpay webhook — the ONLY path that activates a license. Raw-body HMAC
// (await req.text() BEFORE any parse), idempotent across payment.captured AND
// order.paid, replay-safe via webhook_events(provider, external_id).
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const admin = supabaseAdmin();

  if (!verifyWebhookSignature(raw, signature)) {
    await admin.from("webhook_events").insert({
      provider: "razorpay",
      external_id: `invalid:${Date.now()}`,
      event_type: "invalid_signature",
      payload: safeParse(raw),
      signature_valid: false,
    });
    return Response.json({ error: "bad_signature" }, { status: 400 });
  }

  const event = safeParse(raw) as {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string } };
      order?: { entity?: { id?: string } };
    };
    id?: string;
  };
  const eventType = event.event ?? "unknown";
  const payment = event.payload?.payment?.entity;
  const orderId = payment?.order_id ?? event.payload?.order?.entity?.id;
  const externalId = `${eventType}:${payment?.id ?? orderId ?? event.id ?? Date.now()}`;

  // Dedupe + forensic record
  const { error: dupErr } = await admin.from("webhook_events").insert({
    provider: "razorpay", external_id: externalId, event_type: eventType,
    payload: event, signature_valid: true,
  });
  if (dupErr) return Response.json({ ok: true, duplicate: true }); // unique violation = replay

  if ((eventType === "payment.captured" || eventType === "order.paid") && orderId) {
    const { data: license } = await admin.from("licenses")
      .select("id, amount_paise, currency, status")
      .eq("razorpay_order_id", orderId).maybeSingle();
    if (license) {
      // Defensive re-check: amount + currency must match the license. Works for
      // BOTH events — payment.captured carries payment.amount; order.paid carries
      // the order entity amount.
      const paidAmount = payment?.amount ?? (event.payload?.order?.entity as { amount?: number } | undefined)?.amount;
      const paidCurrency = payment?.currency ?? "INR";
      if (paidAmount !== undefined && (paidAmount !== license.amount_paise || paidCurrency !== license.currency)) {
        await admin.from("webhook_events")
          .update({ error: "amount_or_currency_mismatch" })
          .eq("external_id", externalId).eq("provider", "razorpay");
        return Response.json({ error: "amount_mismatch" }, { status: 400 });
      }
      // CRITICAL: check the RPC result. A transient activation failure must NOT
      // be marked processed — leave processed_at NULL and return 5xx so Razorpay
      // retries, otherwise a paid license is stranded forever.
      const { error: actErr } = await admin.rpc("activate_license", {
        p_license_id: license.id,
        p_rzp_payment_id: payment?.id ?? `order_paid_${orderId}`,
      });
      if (actErr) {
        // Remove the dedupe row so Razorpay's retry can re-process (the
        // insert-before-process idempotency marker must be reconcilable, not
        // terminal). Then 5xx to trigger the retry.
        await admin.from("webhook_events")
          .delete().eq("external_id", externalId).eq("provider", "razorpay");
        return Response.json({ error: "activation_failed_retry" }, { status: 500 });
      }
    }
  }

  await admin.from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("external_id", externalId).eq("provider", "razorpay");
  return Response.json({ ok: true });
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return { raw: s.slice(0, 500) }; }
}
