import test from "node:test";
import assert from "node:assert/strict";
import { POST as login } from "../api/login.js";
import { GET as session } from "../api/session.js";
import { POST as logout } from "../api/logout.js";

process.env.ADMIN_PIN = "5678";
process.env.EVENT_SLUG = "wulin-annual-2026";
process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-thirty-two-characters";
process.env.VERCEL_ENV = "development";

function loginRequest(pin) {
  return new Request("http://localhost:3000/api/login", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ pin, slug: "wulin-annual-2026" }),
  });
}

test("login issues a staff cookie and session endpoint accepts it", async () => {
  const response = await login(loginRequest("5678"));
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /wulin_staff_session=/);
  assert.match(setCookie, /HttpOnly/);

  const cookie = setCookie.split(";")[0];
  const sessionResponse = await session(new Request("http://localhost:3000/api/session", {
    headers: { cookie },
  }));
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).authenticated, true);
});

test("wrong PIN is rejected", async () => {
  const response = await login(loginRequest("0000"));
  assert.equal(response.status, 401);
});

test("logout clears the session cookie", async () => {
  const response = logout(new Request("http://localhost:3000/api/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});
