import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getSupabase() {
  const url = process.env.CUSTOM_SUPABASE_URL;
  const anonKey = process.env.CUSTOM_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("[conversations] Missing CUSTOM_SUPABASE_URL or CUSTOM_SUPABASE_ANON_KEY");
    throw new Error("Service temporarily unavailable");
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ConversationRow = {
  id: string | number;
  phone: string | null;
  mode: string | null;
  area: string | null;
  booking_date: string | null;
  booking_time: string | null;
  people: number | string | null;
  status: string | null;
  last_message_at: string | null;
  history: string | null;
  location_lat: number | string | null;
  location_lng: number | string | null;
};

const GENERIC_READ_ERROR = "Unable to load conversations";
const GENERIC_WRITE_ERROR = "Unable to save changes";
const GENERIC_SEND_ERROR = "Unable to send message";

export const getConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, phone, mode, area, booking_date, booking_time, people, status, last_message_at, location_lat, location_lng")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      console.error("[conversations] list error:", error);
      return { rows: [] as ConversationRow[], error: GENERIC_READ_ERROR };
    }
    return { rows: (data ?? []) as ConversationRow[], error: null as string | null };
  });

export const getConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string | number }) => {
    if (input?.id === undefined || input?.id === null || input.id === "") {
      throw new Error("id is required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    const { data: row, error } = await supabase
      .from("conversations")
      .select("id, phone, mode, area, booking_date, booking_time, people, status, last_message_at, history, location_lat, location_lng")
      .eq("id", data.id)
      .maybeSingle();

    if (error) {
      console.error("[conversations] detail error:", error);
      return { row: null as ConversationRow | null, error: GENERIC_READ_ERROR };
    }
    return { row: (row ?? null) as ConversationRow | null, error: null as string | null };
  });

export const updateConversationMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string | number; mode: "bot" | "human" }) => {
    if (input?.id === undefined || input?.id === null || input.id === "") {
      throw new Error("id is required");
    }
    if (input?.mode !== "bot" && input?.mode !== "human") {
      throw new Error("mode must be 'bot' or 'human'");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("conversations")
      .update({ mode: data.mode })
      .eq("id", data.id);
    if (error) {
      console.error("[conversations] update mode error:", error);
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    return { ok: true, error: null as string | null };
  });

export const BOOKING_STATUSES = [
  "new",
  "booking_pending",
  "cooking_confirmed",
  "completed",
  "cancelled",
  "repeat_booking",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const updateConversationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string | number; status: BookingStatus }) => {
    if (input?.id === undefined || input?.id === null || input.id === "") {
      throw new Error("id is required");
    }
    if (!BOOKING_STATUSES.includes(input?.status as BookingStatus)) {
      throw new Error("invalid status");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("conversations")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) {
      console.error("[conversations] update status error:", error);
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    return { ok: true, error: null as string | null };
  });

export const sendOperatorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string | number; phone: string | null; message: string }) => {
    if (!input || typeof input.message !== "string" || input.message.trim().length === 0) {
      throw new Error("message is required");
    }
    if (input.conversation_id === undefined || input.conversation_id === null || input.conversation_id === "") {
      throw new Error("conversation_id is required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const webhookUrl = process.env.MAKE_OPERATOR_WEBHOOK;
    if (!webhookUrl) {
      console.error("[conversations] MAKE_OPERATOR_WEBHOOK is not set");
      return { ok: false, error: GENERIC_SEND_ERROR };
    }
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: data.conversation_id,
          phone: data.phone,
          message: data.message,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[conversations] webhook ${res.status}:`, text.slice(0, 500));
        return { ok: false, error: GENERIC_SEND_ERROR };
      }
      return { ok: true, error: null as string | null };
    } catch (e) {
      console.error("[conversations] webhook fetch failed:", e);
      return { ok: false, error: GENERIC_SEND_ERROR };
    }
  });
