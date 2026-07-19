import { createHash, timingSafeEqual } from "node:crypto";

export function constantTimeEqual(left, right) {
  const a = createHash("sha256").update(String(left ?? ""), "utf8").digest();
  const b = createHash("sha256").update(String(right ?? ""), "utf8").digest();
  return timingSafeEqual(a, b);
}

export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function noStoreHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: noStoreHeaders(extraHeaders),
  });
}

export async function readJson(request, maxBytes = 3_800_000) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    const error = new Error("Request body is too large");
    error.status = 413;
    throw error;
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    const error = new Error("Request body is too large");
    error.status = 413;
    throw error;
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}
