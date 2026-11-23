import { randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { emailVerifications, users } from "@/db/schema";
import { checkSignupRate, hashPassword } from "./auth";
import { config, log, newId, RelayError, sha256 } from "./config";
import { sendEmail, verificationEmail } from "./email";

// ───────────────────────── email signup with verification codes ─────────────────────────
// Flow: request a code (hash stored, plain code only in the email) → verify (user created, session issued).
// Codes are 6 digits from crypto.randomInt, stored as sha256, valid 10 minutes, single use, 5 attempts max.

export const codeHash = (code: string) => sha256(`email_verification:${code.trim()}`);
const normalizeEmail = (email: string) => email.trim().toLowerCase();

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The existing account for this email, if any. */
async function existingUser(email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  return row ?? null;
}

/**
 * A confirmed account owns its email (409, same shape as core.createUser's duplicate check).
 * An account that exists but was never verified may still complete the signup flow, which is what the
 * "needs_verification" login error offers in the UI.
 */
async function assertSignupAllowed(email: string) {
  const u = await existingUser(email);
  if (u?.emailVerifiedAt) throw new RelayError("conflict", "Email already registered", { status: 409 });
  return u;
}

/** The newest unused, unexpired code row for this email (if any). */
async function latestPending(email: string) {
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.email, email), isNull(emailVerifications.usedAt)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

/** Cooldown for "resend": the most recent code request for this email must be older than 60s. */
async function assertCooldown(email: string) {
  const [row] = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(eq(emailVerifications.email, email))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  if (!row) return;
  const elapsed = (Date.now() - row.createdAt.getTime()) / 1000;
  const wait = Math.ceil(config.verifyResendCooldownSeconds - elapsed);
  if (wait > 0) {
    throw new RelayError("cooldown", `Please wait ${wait}s before requesting another code`, { status: 429, retry_after: wait });
  }
}

/**
 * Create + persist a fresh code and email it. Any previous unused code for the same email is
 * replaced (marked used) so only one code can be valid at a time.
 */
async function issueCode(email: string, name: string, password: string) {
  const u = await assertSignupAllowed(email);
  // Existing-but-unverified account (e.g. created by an admin): the code only confirms the address, so no
  // password is captured or hashed. Otherwise store only the argon2id hash — the plain password is never stored.
  const hashed = u ? "" : await hashPassword(password);
  const pendingName = name || (u?.name ?? email.split("@")[0]);

  const code = newCode(); // never logged, never returned
  const expiresAt = new Date(Date.now() + config.verifyCodeTtlSeconds * 1000);

  await db.update(emailVerifications).set({ usedAt: new Date() }).where(and(eq(emailVerifications.email, email), isNull(emailVerifications.usedAt)));
  await db.insert(emailVerifications).values({
    id: newId("evf"),
    email,
    codeHash: codeHash(code),
    name: pendingName,
    passwordHash: hashed,
    expiresAt,
  });

  const mail = verificationEmail(code, Math.round(config.verifyCodeTtlSeconds / 60));
  try {
    await sendEmail({ to: email, ...mail });
  } catch (e) {
    // Delivery failed: invalidate this row so no orphan code can be verified, and surface the error.
    await db.update(emailVerifications).set({ usedAt: new Date() }).where(and(eq(emailVerifications.email, email), isNull(emailVerifications.usedAt)));
    log("warn", "signup_email_failed", { code: e instanceof RelayError ? e.code : "unknown" });
    throw e;
  }
}

export interface SignupInput {
  email: string;
  name: string;
  password: string;
}

/** Step 1: validate, rate limit, then send a verification code. The response never contains the code. */
export async function requestSignupCode(req: Request, input: SignupInput) {
  const email = normalizeEmail(input.email);
  const name = (input.name || email.split("@")[0]).trim().slice(0, 100);
  await assertSignupAllowed(email);
  checkSignupRate(req, email);
  await issueCode(email, name, input.password);
  return { ok: true, email, expires_in: config.verifyCodeTtlSeconds, resend_after: config.verifyResendCooldownSeconds };
}

/** Step 2 of the resend flow: only for an email that already requested a code and is not yet verified. */
export async function resendSignupCode(req: Request, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const u = await assertSignupAllowed(email);
  const pending = await latestPending(email);
  // Unverified accounts (no signup attempt yet) may still request a code to confirm their address.
  if (!pending && !u) throw new RelayError("not_found", "No pending verification for this email. Start signup again.", { status: 404 });
  checkSignupRate(req, email);
  await assertCooldown(email);

  // Reuse the name/password captured at the first request so the code alone is enough to finish signup.
  await issueCode(email, pending?.name ?? u?.name ?? "", pending?.passwordHash ?? "");
  return { ok: true, email, expires_in: config.verifyCodeTtlSeconds, resend_after: config.verifyResendCooldownSeconds };
}

export interface VerifyResult {
  email: string;
  name: string;
  passwordHash: string;
}

/**
 * Step 2: check a code and, on success, hand back the signup details so the caller can create the user.
 * Generic error messages: never reveal whether the email exists or which part failed.
 */
export async function consumeSignupCode(rawEmail: string, rawCode: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) throw new RelayError("invalid_code", "Invalid or expired code. Request a new one.", { status: 400 });

  const row = await latestPending(email);
  if (!row) throw new RelayError("code_expired", "This code has expired. Request a new one.", { status: 410 });
  if (row.usedAt) throw new RelayError("code_expired", "This code has expired. Request a new one.", { status: 410 });
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new RelayError("code_expired", "This code has expired. Request a new one.", { status: 410 });
  }
  if (row.attempts >= config.verifyCodeMaxAttempts) {
    throw new RelayError("too_many_attempts", "Too many incorrect attempts. Request a new code.", { status: 410 });
  }

  if (row.codeHash !== codeHash(code)) {
    const [updated] = await db
      .update(emailVerifications)
      .set({ attempts: row.attempts + 1 })
      .where(eq(emailVerifications.id, row.id))
      .returning({ attempts: emailVerifications.attempts });
    const left = Math.max(0, config.verifyCodeMaxAttempts - (updated?.attempts ?? row.attempts + 1));
    throw new RelayError("invalid_code", left > 0 ? `Invalid code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Request a new code.", {
      status: 400,
      attempts_left: left,
    });
  }

  // Single use: mark consumed atomically (only if still unused) before the caller creates the user.
  const [consumed] = await db
    .update(emailVerifications)
    .set({ usedAt: new Date(), attempts: row.attempts + 1 })
    .where(and(eq(emailVerifications.id, row.id), isNull(emailVerifications.usedAt)))
    .returning();
  if (!consumed) throw new RelayError("code_expired", "This code has already been used. Request a new one.", { status: 410 });

  return { email: row.email, name: row.name, passwordHash: row.passwordHash };
}
