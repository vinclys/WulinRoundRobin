import { getAdminPin, getEventSlug } from "../server/config.js";
import { createStaffSession, sessionCookie } from "../server/session.js";
import { constantTimeEqual, isSameOrigin, jsonResponse, readJson } from "../server/security.js";

export async function POST(request) {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Cross-origin request rejected" }, 403);
  try {
    const body = await readJson(request, 20_000);
    const eventSlug = getEventSlug();
    if (String(body.slug || eventSlug) !== eventSlug) {
      return jsonResponse({ error: "Event slug mismatch" }, 403);
    }
    if (!constantTimeEqual(body.pin, getAdminPin())) {
      return jsonResponse({ error: "工作人员密码不正确" }, 401);
    }
    const token = await createStaffSession(eventSlug);
    return jsonResponse(
      { authenticated: true, eventSlug, expiresInSeconds: 43_200 },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  } catch (error) {
    console.error("login error", error);
    return jsonResponse({ error: "后台登录服务配置错误" }, error.status || 500);
  }
}

export function GET() {
  return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST" });
}
