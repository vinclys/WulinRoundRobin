import { getEventSlug } from "../server/config.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";
import { jsonResponse } from "../server/security.js";

export async function GET() {
  try {
    const eventSlug = getEventSlug();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("tournaments")
      .select("slug,version,updated_at")
      .eq("slug", eventSlug)
      .single();
    if (error) throw error;
    return jsonResponse({
      ok: true,
      service: "wulin-tournament-control",
      database: "connected",
      eventSlug: data.slug,
      version: Number(data.version || 0),
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error("health error", error);
    return jsonResponse({ ok: false, error: "Server or database configuration error" }, 500);
  }
}
