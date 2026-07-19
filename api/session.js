import { getEventSlug } from "../server/config.js";
import { verifyStaffSession } from "../server/session.js";
import { jsonResponse } from "../server/security.js";

export async function GET(request) {
  try {
    const eventSlug = getEventSlug();
    const session = await verifyStaffSession(request, eventSlug);
    return jsonResponse({ authenticated: Boolean(session), eventSlug }, session ? 200 : 401);
  } catch (error) {
    console.error("session error", error);
    return jsonResponse({ authenticated: false, error: "Session service configuration error" }, 500);
  }
}
