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
  cancellation_reason?: string | null;
  cook_assigned?: string | null;
  subscription_enquiry?: string | null;
  conversation_source?: string | null;
  pre_booking_payment_link?: string | null;
  full_payment_link?: string | null;

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
      .select("id, phone, mode, area, booking_date, booking_time, people, status, last_message_at, history, location_lat, location_lng, subscription_enquiry, conversation_source")
      .eq("id", data.id)
      .maybeSingle();

    if (error) {
      console.error("[conversations] detail error:", error);
      return { row: null as ConversationRow | null, error: GENERIC_READ_ERROR };
    }

    let cancellation_reason: string | null = null;
    let cook_assigned: string | null = null;
    let pre_booking_payment_link: string | null = null;
    let full_payment_link: string | null = null;
    if (row) {
      const { data: order, error: orderErr } = await supabase
        .from("orders")
        .select("cancellation_reason, cook_assigned, pre_booking_payment_link, full_payment_link")
        .eq("conversation_id", data.id)
        .maybeSingle();
      if (orderErr) {
        console.error("[conversations] order lookup error:", orderErr);
      } else if (order) {
        cancellation_reason = (order.cancellation_reason as string | null) ?? null;
        cook_assigned = (order.cook_assigned as string | null) ?? null;
        pre_booking_payment_link = (order.pre_booking_payment_link as string | null) ?? null;
        full_payment_link = (order.full_payment_link as string | null) ?? null;
      }
    }

    const merged = row
      ? ({ ...row, cancellation_reason, cook_assigned, pre_booking_payment_link, full_payment_link } as ConversationRow)
      : null;

    return { row: merged, error: null as string | null };
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
  "payment_pending",
  "cook_job_enquiry",
  "cooking_confirmed",
  "completed",
  "cancelled",
  "repeat_booking",
  "archived",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Editable booking fields on the conversations table
const EDITABLE_FIELDS = ["area", "booking_date", "booking_time", "people", "subscription_enquiry", "conversation_source"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export const updateConversationFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string | number;
    fields: Partial<Record<EditableField, string | number | null>>;
  }) => {
    if (input?.id === undefined || input?.id === null || input.id === "") {
      throw new Error("id is required");
    }
    if (!input.fields || typeof input.fields !== "object") {
      throw new Error("fields is required");
    }
    const cleaned: Partial<Record<EditableField, string | number | null>> = {};
    for (const key of Object.keys(input.fields) as EditableField[]) {
      if (!EDITABLE_FIELDS.includes(key)) continue;
      let val = input.fields[key];
      if (typeof val === "string") {
        const trimmed = val.trim();
        val = trimmed === "" ? null : trimmed;
      }
      if (key === "people" && val != null && val !== "") {
        const n = typeof val === "number" ? val : Number(val);
        if (Number.isNaN(n)) throw new Error("people must be a number");
        val = n;
      }
      cleaned[key] = val as string | number | null;
    }
    if (Object.keys(cleaned).length === 0) throw new Error("no fields to update");
    return { id: input.id, fields: cleaned };
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("conversations")
      .update(data.fields)
      .eq("id", data.id);
    if (error) {
      console.error("[conversations] update fields error:", error);
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    return { ok: true, error: null as string | null };
  });

export const updateOrderCookAssigned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversation_id: string | number; cook_assigned: string | null }) => {
    if (input?.conversation_id === undefined || input?.conversation_id === null || input.conversation_id === "") {
      throw new Error("conversation_id is required");
    }
    const val = typeof input.cook_assigned === "string" ? input.cook_assigned.trim() : input.cook_assigned;
    return { conversation_id: input.conversation_id, cook_assigned: val === "" ? null : (val as string | null) };
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("orders")
      .update({ cook_assigned: data.cook_assigned })
      .eq("conversation_id", data.conversation_id);
    if (error) {
      console.error("[conversations] update cook_assigned error:", error);
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    return { ok: true, error: null as string | null };
  });

const ORDER_PAYMENT_FIELDS = ["pre_booking_payment_link", "full_payment_link"] as const;
type OrderPaymentField = (typeof ORDER_PAYMENT_FIELDS)[number];

export const updateOrderPaymentLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    conversation_id: string | number;
    fields: Partial<Record<OrderPaymentField, string | null>>;
  }) => {
    if (input?.conversation_id === undefined || input?.conversation_id === null || input.conversation_id === "") {
      throw new Error("conversation_id is required");
    }
    if (!input.fields || typeof input.fields !== "object") {
      throw new Error("fields is required");
    }
    const cleaned: Partial<Record<OrderPaymentField, string | null>> = {};
    for (const key of Object.keys(input.fields) as OrderPaymentField[]) {
      if (!ORDER_PAYMENT_FIELDS.includes(key)) continue;
      let val = input.fields[key];
      if (typeof val === "string") {
        const trimmed = val.trim();
        val = trimmed === "" ? null : trimmed;
      }
      cleaned[key] = val as string | null;
    }
    if (Object.keys(cleaned).length === 0) throw new Error("no fields to update");
    return { conversation_id: input.conversation_id, fields: cleaned };
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("orders")
      .update(data.fields)
      .eq("conversation_id", data.conversation_id);
    if (error) {
      console.error("[conversations] update order payment links error:", error);
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    return { ok: true, error: null as string | null };
  });



// Deprecated single-status writer kept for compatibility.
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

export function parseStatuses(value: string | null | undefined): BookingStatus[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BookingStatus => (BOOKING_STATUSES as readonly string[]).includes(s));
}

export const saveBookingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id: string | number;
    statuses: BookingStatus[];
    cancellation_reason?: string | null;
  }) => {
    if (input?.id === undefined || input?.id === null || input.id === "") {
      throw new Error("id is required");
    }
    if (!Array.isArray(input?.statuses) || input.statuses.length === 0) {
      throw new Error("statuses must be a non-empty array");
    }
    const seen = new Set<BookingStatus>();
    for (const s of input.statuses) {
      if (!BOOKING_STATUSES.includes(s)) throw new Error(`invalid status: ${s}`);
      seen.add(s);
    }
    const statuses = Array.from(seen);
    if (statuses.includes("cancelled")) {
      const r = (input.cancellation_reason ?? "").trim();
      if (!r) throw new Error("cancellation_reason is required when cancelling");
      if (r.length > 2000) throw new Error("cancellation_reason too long");
    }
    return { id: input.id, statuses, cancellation_reason: input.cancellation_reason ?? null };
  })
  .handler(async ({ data }) => {
    const supabase = await getSupabase();
    // Preserve BOOKING_STATUSES order for stable storage
    const ordered = (BOOKING_STATUSES as readonly BookingStatus[]).filter((s) => data.statuses.includes(s));
    const serialized = ordered.join(",");

    const { error: statusErr } = await supabase
      .from("conversations")
      .update({ status: serialized })
      .eq("id", data.id);
    if (statusErr) {
      console.error("[conversations] save status error:", statusErr);
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    if (ordered.includes("cancelled")) {
      const reason = (data.cancellation_reason ?? "").trim();
      const { error: orderErr } = await supabase
        .from("orders")
        .update({ cancellation_reason: reason })
        .eq("conversation_id", data.id);
      if (orderErr) {
        console.error("[conversations] save cancellation reason error:", orderErr);
        return { ok: false, error: GENERIC_WRITE_ERROR };
      }
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
