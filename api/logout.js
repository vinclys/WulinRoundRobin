import { clearSessionCookie } from "../server/session.js";
import { isSameOrigin, jsonResponse } from "../server/security.js";

export function POST(request) {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Cross-origin request rejected" }, 403);
  return jsonResponse({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
}
