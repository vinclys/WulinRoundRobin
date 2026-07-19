import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, isSameOrigin, readJson } from "../server/security.js";


test("constantTimeEqual accepts exact values only", () => {
  assert.equal(constantTimeEqual("5678", "5678"), true);
  assert.equal(constantTimeEqual("5678", "5679"), false);
  assert.equal(constantTimeEqual("", "5678"), false);
});

test("isSameOrigin accepts same-origin and rejects cross-origin requests", () => {
  const same = new Request("https://app.example.com/api/login", { headers: { origin: "https://app.example.com" } });
  const other = new Request("https://app.example.com/api/login", { headers: { origin: "https://evil.example" } });
  assert.equal(isSameOrigin(same), true);
  assert.equal(isSameOrigin(other), false);
});

test("readJson parses a bounded JSON body", async () => {
  const request = new Request("https://app.example.com/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await readJson(request), { ok: true });
});
