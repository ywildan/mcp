import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, log, RelayError } from "./config";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send one transactional email through Resend's HTTP API (plain fetch, no SDK).
 *
 * Never logs the message body, the recipient address or the API key — only a non-identifying
 * status/detail pair so failures stay debuggable without leaking secrets or codes.
 */
export async function sendEmail(msg: OutboundEmail): Promise<void> {
  if (!config.resendApiKey) {
    log("error", "email_not_configured", { reason: "missing RESEND_API_KEY" });
    throw new RelayError("email_unavailable", "Email delivery is not configured on this server. Please contact the administrator.", { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
  } catch {
    log("error", "email_send_failed", { status: 0, reason: "network_error" });
    throw new RelayError("email_failed", "Could not send the verification email. Please try again shortly.", { status: 502 });
  }

  if (res.ok) return;

  // Resend returns JSON like { name, message }; keep only a short, non-sensitive hint.
  const detail = await res.text().catch(() => "");
  log("error", "email_send_failed", { status: res.status, reason: describeResendError(res.status, detail) });

  if (res.status === 429) {
    throw new RelayError("email_rate_limited", "Daily email sending limit reached. Please try again tomorrow.", { status: 429 });
  }
  if (res.status === 401 || res.status === 403) {
    log("error", "email_auth_failed", { reason: "check RESEND_API_KEY / verified domain" });
    throw new RelayError("email_unavailable", "Email delivery is not configured correctly on this server. Please contact the administrator.", { status: 503 });
  }
  throw new RelayError("email_failed", "Could not send the verification email. Please try again shortly.", { status: 502 });
}

/** Map a Resend failure to a short, safe reason string (never echoes the payload/body). */
function describeResendError(status: number, raw: string) {
  if (status === 429) return "rate_limited";
  if (status === 422) return "invalid_request";
  if (status >= 500) return "resend_unavailable";
  // Resend error names are short identifiers such as "validation_error"; pass only a-z0-9/_ chars.
  try {
    const j = JSON.parse(raw) as { name?: unknown };
    if (typeof j.name === "string") return j.name.replace(/[^a-z0-9_]/gi, "").slice(0, 64) || "error";
  } catch {
    /* ignore unparsable bodies */
  }
  return "error";
}

export const VERIFICATION_EMAIL_TEMPLATE = "agentrelay-verification.html";

// The email design is authored as plain HTML so it can be edited/previewed like any web page:
// src/lib/email-templates/agentrelay-verification.html, with a single {{CODE}} placeholder that is
// replaced at send time. Read from disk once per process (kept out of the bundle).
let templateCache: string | null = null;
function verificationHtml(): string {
  if (templateCache === null) {
    templateCache = readFileSync(join(process.cwd(), "src", "lib", "email-templates", VERIFICATION_EMAIL_TEMPLATE), "utf8");
  }
  return templateCache;
}

/** Fill {{CODE}} in the design. The code is only ever a 6-digit string, never user input. */
export function renderVerificationEmail(template: string, code: string): string {
  return template.split("{{CODE}}").join(code);
}

export function verificationEmail(code: string, minutes: number) {
  const safeCode = code.replace(/\D/g, "").slice(0, 6);
  const subject = "Kode verifikasi AgentRelay";
  const html = renderVerificationEmail(verificationHtml(), safeCode);
  // Plain-text alternative mirrors the design's wording for clients that block HTML.
  const text = [
    "Kode verifikasi kamu",
    "",
    "Masukkan kode di bawah ini untuk menyelesaikan pendaftaran akun AgentRelay kamu.",
    "",
    `    ${safeCode}`,
    "",
    `Kode ini berlaku ${minutes} menit. Jangan bagikan ke siapa pun.`,
    "",
    "Kalau kamu tidak merasa mendaftar di AgentRelay, abaikan email ini. Tim AgentRelay tidak akan pernah meminta kode verifikasi kamu.",
    "",
    "Email ini dikirim otomatis oleh AgentRelay",
    "admin@helux.web.id",
    "",
    "AgentRelay — a workspace for AI agents",
  ].join("\n");
  return { subject, html, text };
}
