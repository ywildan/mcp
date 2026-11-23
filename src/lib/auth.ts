import { hash, verify } from "@node-rs/argon2";
import { eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { userSessions, users } from "@/db/schema";
import { config, randomToken, RelayError, sha256 } from "./config";
import { ensureWorkspace, userHandle, type Actor } from "./core";
import { shared } from "./events";

export const COOKIE = "ar_session";
const SESSION_DAYS = 7;

// Argon2id (algorithm 2) with OWASP-recommended parameters.
export const hashPassword = (pw: string) => hash(pw, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export function checkLoginRate(req: Request, email: string) {
  const a = shared.rate.hit(`login:ip:${clientIp(req)}`, config.loginRatePerMin);
  const b = shared.rate.hit(`login:email:${email.toLowerCase()}`, config.loginRatePerMin);
  const wait = Math.max(a, b);
  if (wait) throw new RelayError("rate_limited", "Too many login attempts", { retry_after: wait });
}

export async function createSession(userId: string) {
  const raw = randomToken(32);
  const csrf = randomToken(24);
  await db.insert(userSessions).values({ id: sha256(raw), userId, csrfToken: csrf, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) });
  await db.delete(userSessions).where(lt(userSessions.expiresAt, new Date()));
  return { raw, csrf };
}

export function sessionCookie(req: Request, value: string, maxAge = SESSION_DAYS * 86400) {
  const https = config.publicUrl.startsWith("https") || req.headers.get("x-forwarded-proto") === "https";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? "; Secure" : ""}`;
}

function readCookie(req: Request, name: string) {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export type SessionUser = { actor: Actor; user: typeof users.$inferSelect; csrf: string; sessionId: string };

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const sid = sha256(raw);
  const [sess] = await db.select().from(userSessions).where(eq(userSessions.id, sid));
  if (!sess || sess.expiresAt < new Date()) return null;
  const [user] = await db.select().from(users).where(eq(users.id, sess.userId));
  if (!user) return null;
  return { actor: { kind: "user", id: user.id, name: userHandle(user) }, user, csrf: sess.csrfToken, sessionId: sid };
}

/** Require a logged-in human. Mutations additionally require the CSRF header. */
export async function requireUser(req: Request, o: { admin?: boolean } = {}): Promise<SessionUser> {
  await ensureWorkspace();
  const su = await getSessionUser(req);
  if (!su) throw new RelayError("unauthorized", "Login required");
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (mutating) {
    const h = req.headers.get("x-csrf-token");
    if (!h || h !== su.csrf) throw new RelayError("forbidden", "Invalid CSRF token", { status: 403 });
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new RelayError("forbidden", "Cross-origin request blocked", { status: 403 });
  }
  if (o.admin && su.user.role !== "admin") throw new RelayError("forbidden", "Admin only", { status: 403 });
  return su;
}

export async function destroySession(sessionId: string) {
  await db.delete(userSessions).where(eq(userSessions.id, sessionId));
}
