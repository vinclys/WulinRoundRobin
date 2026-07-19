import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerConfig } from "./config.js";

let client;

export function getSupabaseAdmin() {
  if (client) return client;
  const { url, key } = getSupabaseServerConfig();
  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "wulin-vercel-admin/1.0" },
    },
  });
  return client;
}
