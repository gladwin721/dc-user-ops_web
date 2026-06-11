import { createServerFn } from "@tanstack/react-start";

export const getConversations = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.CUSTOM_SUPABASE_URL;
  const anonKey = process.env.CUSTOM_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing CUSTOM_SUPABASE_URL or CUSTOM_SUPABASE_ANON_KEY");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("conversations")
    .select("phone, mode, area, booking_date, booking_time")
    .order("booking_date", { ascending: false })
    .limit(100);

  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: data ?? [], error: null as string | null };
});
