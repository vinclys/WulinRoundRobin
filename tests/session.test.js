import test from "node:test";
import assert from "node:assert/strict";
import {
  createStaffSession,
  verifyStaffSession,
  sessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "../server/session.js";

process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-thirty-two-characters";

test("staff session is signed and scoped to the event slug", async () => {
  const token = await createStaffSession("wulin-annual-2026");
  const request = new Request("https://app.example.com/api/session", {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
  const valid = await verifyStaffSession(request, "wulin-annual-2026");
  const invalid = await verifyStaffSession(request, "another-event");
  assert.equal(valid?.role, "staff");
  assert.equal(invalid, null);
});

test("cookies are HttpOnly and secure on Vercel preview/production", async () => {
  process.env.VERCEL_ENV = "production";
  const cookie = sessionCookie("abc");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(clearSessionCookie(), /Max-Age=0/);
  delete process.env.VERCEL_ENV;
});
