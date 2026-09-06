import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseForRequest } from "@/lib/supabase/server";
import { paymentMode } from "@/lib/payments";

export const maxDuration = 30;

// DEV/DEMO ONLY — stands in for the Razorpay webhook while in mock mode.
// Disabled the moment real Razorpay keys are present. Authorization is real:
// the caller's JWT must belong to the buyer org on the license (RLS-checked
// read); only then does the service client run activate_license (which itself
// re-validates payment_pending). No client-controlled authority leaks in.
const Body = z.object({ license_id: z.string().uuid() });

export async function POST(req: Request) {
  if (paymentMode() !== "mock") {
    return Response.json({ error: "mock_disabled_use_razorpay" }, { status: 409 });
  }
  const supabase = await supabaseForRequest(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // RLS-checked: buyer can only read a license their org is party to
  const { data: license } = await supabase
    .from("licenses")
    .select("id, status, razorpay_order_id, buyer_org_id")
    .eq("id", body.license_id).maybeSingle();
  if (!license) return Response.json({ error: "license_not_found" }, { status: 404 });

  const { data: profile } = await supabase
    .from("profiles").select("org_id").eq("id", user.id).single();
  if (!profile || profile.org_id !== license.buyer_org_id) {
    return Response.json({ error: "not_buyer" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const paymentId = `mock_pay_${license.id}_${Date.now()}`;

  // Record the simulated webhook event for parity + dedupe
  await admin.from("webhook_events").insert({
    provider: "razorpay",
    external_id: `mock_captured:${license.razorpay_order_id ?? license.id}`,
    event_type: "payment.captured",
    payload: { mock: true, license_id: license.id, payment_id: paymentId },
    signature_valid: true,
    processed_at: new Date().toISOString(),
  }).select();

  const { error } = await admin.rpc("activate_license", {
    p_license_id: license.id, p_rzp_payment_id: paymentId,
  });
  if (error && !error.message.includes("not_payment_pending")) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ ok: true, status: "active" });
}
