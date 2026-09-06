import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";
import { createOrder, paymentMode } from "@/lib/payments";

export const maxDuration = 30;

// Phase 5 — checkout start. begin_checkout() (buyer-org checked, idempotent)
// creates/returns the payment_pending license; then the server creates the
// payment order and stamps razorpay_order_id via the service client (an
// order-id stamp is not a status transition — same precedent as the plan).
const Body = z.object({ request_id: z.string().uuid() });

export async function POST(req: Request) {
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // begin_checkout runs with the CALLER's rights → enforces buyer-org + approval
  const { data: licenseId, error: coErr } = await supabase.rpc("begin_checkout", {
    p_request_id: body.request_id,
  });
  if (coErr) {
    const msg = coErr.message;
    const status = msg.includes("not_buyer") ? 403 : msg.includes("not_approved") ? 409 : 400;
    return Response.json({ error: msg }, { status });
  }

  const admin = supabaseAdmin();
  const { data: license } = await admin.from("licenses")
    .select("id, amount_paise, razorpay_order_id, buyer_org_id, creator_org_id")
    .eq("id", licenseId as string).single();
  if (!license) return Response.json({ error: "license_missing" }, { status: 500 });

  // Idempotent retries: only mint a NEW order when the license has none yet.
  // (Razorpay allows multiple payment attempts per order; creating a fresh
  // order on every retry would orphan real unpaid orders + burn API quota.)
  if (license.razorpay_order_id) {
    return Response.json({
      ok: true,
      provider: paymentMode(),
      license_id: license.id,
      order_id: license.razorpay_order_id,
      amount_paise: license.amount_paise,
      key_id: paymentMode() === "razorpay" ? process.env.RAZORPAY_KEY_ID ?? null : null,
    });
  }

  const order = await createOrder({
    amountPaise: license.amount_paise,
    receipt: license.id,
    notes: {
      license_id: license.id,
      buyer_org_id: license.buyer_org_id,
      creator_org_id: license.creator_org_id,
    },
  });
  await admin.from("licenses").update({ razorpay_order_id: order.orderId }).eq("id", license.id);

  return Response.json({
    ok: true,
    provider: order.provider,
    license_id: license.id,
    order_id: order.orderId,
    amount_paise: order.amountPaise,
    key_id: order.keyId,
  });
}
