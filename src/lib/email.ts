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

export function verificationEmail(code: string, minutes: number) {
  const safeCode = code.replace(/\D/g, "").slice(0, 6);
  const subject = "Kode verifikasi AgentRelay";
  const text = [
    "Your AgentRelay verification code is:",
    "",
    `    ${safeCode}`,
    "",
    `This code expires in ${minutes} minutes and can be used only once.`,
    "",
    "If you did not request this code, you can safely ignore this email.",
    "",
    "— AgentRelay",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1ea;font-family:Helvetica,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #d8d2c4">
            <tr>
              <td style="padding:32px">
                <p style="margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#ff4a1c">AgentRelay</p>
                <h1 style="margin:12px 0 0;font-size:24px;line-height:1.2">Kode verifikasi Anda</h1>
                <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#444">Masukkan kode berikut untuk menyelesaikan pendaftaran akun AgentRelay Anda.</p>
                <div style="margin:28px 0;padding:20px 0;border-top:1px solid #e6e1d6;border-bottom:1px solid #e6e1d6;text-align:center">
                  <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#111">${safeCode}</span>
                </div>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#444">Kode ini berlaku selama <strong>${minutes} menit</strong> dan hanya bisa dipakai sekali.</p>
                <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#777">Jika Anda tidak meminta kode ini, abaikan saja email ini — tidak ada akun yang dibuat.</p>
                <p style="margin:24px 0 0;font-size:13px;color:#777">— AgentRelay</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9a9488">Jangan bagikan kode ini kepada siapa pun.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject, html, text };
}
