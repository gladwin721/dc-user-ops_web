import { createServerFn } from "@tanstack/react-start";

export const sendOperatorMessage = createServerFn({ method: "POST" })
  .inputValidator((input: { message: string; phone?: string; meta?: Record<string, unknown> }) => {
    if (!input || typeof input.message !== "string" || input.message.trim().length === 0) {
      throw new Error("message is required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const webhookUrl = process.env.MAKE_OPERATOR_WEBHOOK;
    if (!webhookUrl) {
      return { ok: false, error: "MAKE_OPERATOR_WEBHOOK is not set" };
    }

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: data.message,
          phone: data.phone ?? null,
          meta: data.meta ?? null,
          sent_at: new Date().toISOString(),
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, error: `Webhook responded ${res.status}: ${text.slice(0, 300)}` };
      }
      return { ok: true, status: res.status, response: text.slice(0, 500) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
