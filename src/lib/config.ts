import { createHash, randomBytes, randomUUID } from "node:crypto";

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== "" ? v : d;
};

// Without SESSION_SECRET we generate a random per-process secret (shared across route bundles via globalThis);
// there is deliberately no predictable default. Signed artifact URLs simply expire on restart.
const gs = globalThis as typeof globalThis & { __arSecret?: string };
gs.__arSecret ??= process.env.SESSION_SECRET || randomBytes(32).toString("hex");

export const config = {
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/$/, ""),
  sessionSecret: gs.__arSecret,
  waitDefaultSeconds: num("WAIT_DEFAULT_SECONDS", 0),
  waitChunkSeconds: num("WAIT_CHUNK_SECONDS", 30),
  waitKeepaliveSeconds: num("WAIT_KEEPALIVE_SECONDS", 15),
  waitInfiniteMaxSeconds: num("WAIT_INFINITE_MAX_SECONDS", 3600),
  maxActiveWaits: num("MAX_ACTIVE_WAITS", 500),
  loginRatePerMin: num("LOGIN_RATE_LIMIT_PER_MIN", 10),
  inboxLeaseSeconds: num("INBOX_LEASE_SECONDS", 120),
  hopLimitDefault: num("HOP_LIMIT_DEFAULT", 20),
  rateMsgPerMin: num("RATE_LIMIT_MSG_PER_MIN", 60),
  rateCallsPerMin: num("RATE_LIMIT_CALLS_PER_MIN", 600),
  retentionDaysMessages: num("RETENTION_DAYS_MESSAGES", 90),
  retentionDaysInbox: num("RETENTION_DAYS_INBOX", 7),
  retentionDaysActivity: num("RETENTION_DAYS_ACTIVITY", 30),
  maxArtifactBytes: num("MAX_ARTIFACT_BYTES", 10 * 1024 * 1024),
  maxContentBytes: 32 * 1024,
  maxMetadataBytes: 16 * 1024,
  logLevel: process.env.LOG_LEVEL ?? "info",
  // Resend transactional email (email signup verification). Required — no default; the signup flow reports a
  // clear error if it is missing rather than silently dropping codes.
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "AgentRelay <admin@helux.web.id>",
  verifyCodeTtlSeconds: num("VERIFY_CODE_TTL_SECONDS", 600),
  verifyCodeMaxAttempts: num("VERIFY_CODE_MAX_ATTEMPTS", 5),
  verifyResendCooldownSeconds: num("VERIFY_RESEND_COOLDOWN_SECONDS", 60),
  verifyRequestsPerHour: num("VERIFY_REQUESTS_PER_HOUR", 5),
};

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

const levels: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_RE = /(ar_live_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,})/g;
export const redact = (s: string) => s.replace(SECRET_RE, "[REDACTED]");

/** Structured JSON logger. Never pass raw secrets; values are redacted defensively. */
export function log(level: "debug" | "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  if ((levels[level] ?? 20) < (levels[config.logLevel] ?? 20)) return;
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
  (level === "error" ? console.error : console.log)(line);
}

export class RelayError extends Error {
  constructor(
    public code: string,
    message: string,
    public extra: { retry_after?: number; status?: number; [k: string]: unknown } = {},
  ) {
    super(message);
  }
  get status() {
    return (this.extra.status as number | undefined) ?? defaultStatus[this.code] ?? 400;
  }
}
const defaultStatus: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  recipient_not_found: 404,
  rate_limited: 429,
  payload_too_large: 413,
  room_paused: 409,
  duplicate_message: 409,
};
