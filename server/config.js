export function getEventSlug() {
  return String(process.env.EVENT_SLUG || process.env.VITE_EVENT_SLUG || "wulin-annual-2026").trim();
}

export function getAdminPin() {
  const value = String(process.env.ADMIN_PIN || "");
  if (!value) throw new Error("ADMIN_PIN is not configured");
  return value;
}

export function getSupabaseServerConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url) throw new Error("SUPABASE_URL is not configured");
  if (!key) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is not configured");
  return { url, key };
}
