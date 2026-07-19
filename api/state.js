import { getEventSlug } from "../server/config.js";
import { verifyStaffSession } from "../server/session.js";
import { getSupabaseAdmin } from "../server/supabase-admin.js";
import { isSameOrigin, jsonResponse, readJson } from "../server/security.js";
import { validateTournamentState } from "../server/validate-state.js";

async function latestState(supabase, slug) {
  const { data } = await supabase
    .from("tournaments")
    .select("state,version,updated_at")
    .eq("slug", slug)
    .single();
  return data || null;
}

export async function POST(request) {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Cross-origin request rejected" }, 403);

  try {
    const eventSlug = getEventSlug();
    const session = await verifyStaffSession(request, eventSlug);
    if (!session) return jsonResponse({ error: "Staff session required" }, 401);

    const body = await readJson(request);
    const slug = String(body.slug || "").trim();
    const expectedVersion = Number(body.expectedVersion);
    if (slug !== eventSlug) return jsonResponse({ error: "Event slug mismatch" }, 403);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return jsonResponse({ error: "expectedVersion must be a positive integer" }, 400);
    }
    const validationError = validateTournamentState(body.state);
    if (validationError) return jsonResponse({ error: validationError }, 400);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("save_tournament_state", {
      p_slug: slug,
      p_state: body.state,
      p_expected_version: expectedVersion,
      p_actor: "staff-pin",
    });

    if (error) {
      const isConflict = error.code === "40001" || String(error.message || "").includes("VERSION_CONFLICT");
      if (isConflict) {
        const latest = await latestState(supabase, slug);
        return jsonResponse({
          error: "version_conflict",
          version: Number(latest?.version || 0),
          state: latest?.state || null,
          updatedAt: latest?.updated_at || null,
        }, 409);
      }
      console.error("Supabase save error", error);
      return jsonResponse({ error: "Unable to save tournament state" }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return jsonResponse({
      ok: true,
      version: Number(row?.new_version || row?.version || expectedVersion + 1),
      updatedAt: row?.new_updated_at || row?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    console.error("state API error", error);
    return jsonResponse({ error: error.message || "Unexpected server error" }, error.status || 500);
  }
}

export function GET() {
  return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST" });
}
