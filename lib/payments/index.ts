import { createHmac, timingSafeEqual } from "node:crypto";

// Payment abstraction. Two modes, same shape as the video provider:
//   mock     — no keys needed; a "mock order" + a dev-only confirm endpoint
//              simulate the full Razorpay Orders → Checkout → webhook loop
//   razorpay — real TEST-mode integration (auto-selected once keys exist)
// COST NOTE: Razorpay test mode is FREE; this abstraction exists so the whole
// payment UX is testable with zero setup, not to save money.
export function paymentMode(): "mock" | "razorpay" {
  const forced = process.env.PAYMENT_PROVIDER;
  if (forced === "mock" || forced === "razorpay") return forced;
  return process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? "razorpay" : "mock";
}

export interface CreatedOrder {
  provider: "mock" | "razorpay";
  orderId: string;
  amountPaise: number;
  currency: "INR";
  keyId: string | null; // publishable key for checkout.js (null in mock)
}

export async function createOrder(input: {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<CreatedOrder> {
  if (paymentMode() === "mock") {
    return {
      provider: "mock",
      orderId: `mock_order_${input.receipt}_${Date.now()}`,
      amountPaise: input.amountPaise,
      currency: "INR",
      keyId: null,
    };
  }
  const keyId = process.env.RAZORPAY_KEY_ID!;
  const auth = Buffer.from(`${keyId}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    }),
  });
  if (!res.ok) throw new Error(`razorpay_order ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const order = (await res.json()) as { id: string; amount: number };
  return { provider: "razorpay", orderId: order.id, amountPaise: order.amount, currency: "INR", keyId };
}

// Checkout return handler: HMAC(order_id|payment_id, key_secret) === signature
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

// Webhook: HMAC-SHA256 of the RAW body with the webhook secret
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
