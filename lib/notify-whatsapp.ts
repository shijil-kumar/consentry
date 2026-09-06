// WhatsApp notifications (Meta WhatsApp Business Cloud API). Dormant until
// WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are set — in-app notifications remain the
// default channel. In India, email is where notifications go to die; this is
// the go-live channel for "script approved / video delivered / payout earned".
export async function sendWhatsApp(toE164: string, text: string): Promise<{ ok: boolean; skipped?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { ok: false, skipped: "not_configured" };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toE164.replace(/[^0-9]/g, ""),
        type: "text",
        text: { body: text.slice(0, 1024) },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false, skipped: "network_error" };
  }
}
