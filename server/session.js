import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "wulin_staff_session";
const ISSUER = "wulin-tournament-control";
const AUDIENCE = "wulin-staff";
const SESSION_SECONDS = 12 * 60 * 60;

function getSessionSecret() {
  const value = String(process.env.SESSION_SECRET || "");
  if (value.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return value;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signValue(value) {
  return createHmac("sha256", getSessionSecret()).update(value, "utf8").digest("base64url");
}

function signaturesMatch(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseCookies(header = "") {
  const result = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

export async function createStaffSession(eventSlug) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    role: "staff",
    eventSlug,
    iat: now,
    exp: now + SESSION_SECONDS,
    iss: ISSUER,
    aud: AUDIENCE,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signValue(unsigned)}`;
}

export async function verifyStaffSession(request, expectedEventSlug) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  try {
    const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart || extra) return null;
    const unsigned = `${headerPart}.${payloadPart}`;
    if (!signaturesMatch(signaturePart, signValue(unsigned))) return null;

    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) return null;
    if (payload.role !== "staff") return null;
    if (String(payload.eventSlug || "") !== String(expectedEventSlug || "")) return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
    if (!Number.isFinite(payload.iat) || payload.iat > now + 60) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieSecurityParts() {
  const deployedOverHttps = ["preview", "production"].includes(String(process.env.VERCEL_ENV || ""));
  return deployedOverHttps ? ["Secure"] : [];
}

export function sessionCookie(token) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_SECONDS}`,
    "HttpOnly",
    ...cookieSecurityParts(),
    "SameSite=Lax",
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    ...cookieSecurityParts(),
    "SameSite=Lax",
  ].join("; ");
}
