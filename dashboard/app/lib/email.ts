// Transactional email via Resend.
//
// Bypasses Supabase's built-in mailer entirely — we generate the auth link
// server-side with supabaseAdmin().auth.admin.generateLink(), then send it
// here with full control over the template.
//
// Required env vars:
//   RESEND_API_KEY   — from resend.com/api-keys
//   RESEND_FROM      — e.g. "Purity Research <research@puritycoffee.com>"
//
// All functions throw on send failure so callers can surface the error.

import { Resend } from 'resend';

function resendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return new Resend(key);
}

function fromAddress() {
  return process.env.RESEND_FROM ?? 'Purity Research <research@puritycoffee.com>';
}

// ─── Templates ───────────────────────────────────────────────────────────────

function baseTemplate(bodyContent: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Purity Research Hub</title>
  <style>
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F7F1E8; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
    .outer { padding: 40px 16px 60px; }
    .card { max-width: 560px; margin: 0 auto; background: #FFFFFF; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(43,31,23,.10); }
    .header { background: #2B1F17; padding: 28px 36px; }
    .header-eyebrow { color: #8A8279; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
    .header-title { color: #F7F1E8; font-size: 20px; font-weight: 600; letter-spacing: -0.3px; }
    .header-title span { color: #009F8D; }
    .body { padding: 36px 36px 28px; }
    h1 { color: #2B1F17; font-size: 22px; font-weight: 600; letter-spacing: -0.4px; line-height: 1.3; margin-bottom: 12px; }
    p { color: #5A534C; font-size: 15px; line-height: 1.65; margin-bottom: 16px; }
    .cta-wrap { margin: 28px 0 24px; }
    .cta { display: inline-block; background: #2B1F17; color: #F7F1E8 !important; text-decoration: none; padding: 13px 28px; border-radius: 7px; font-size: 14px; font-weight: 600; letter-spacing: -0.1px; }
    .cta:hover { background: #3F2E22; }
    .divider { border: none; border-top: 1px solid #EDE6D8; margin: 24px 0; }
    .fallback-label { color: #8A8279; font-size: 12px; margin-bottom: 6px; }
    .fallback-link { color: #009F8D; font-size: 12px; word-break: break-all; line-height: 1.5; }
    .footer { background: #F7F1E8; padding: 20px 36px; border-top: 1px solid #EDE6D8; }
    .footer p { color: #8A8279; font-size: 12px; line-height: 1.6; margin: 0; }
    .footer a { color: #3F6B4A; text-decoration: none; }
  </style>
</head>
<body>
  <div class="outer">
    <div class="card">
      <div class="header">
        <div class="header-eyebrow">Purity Coffee</div>
        <div class="header-title">Research <span>Hub</span></div>
      </div>
      <div class="body">
        ${bodyContent}
      </div>
      <div class="footer">
        <p>This is an automated message from <a href="https://puritycoffee.com">Purity Coffee</a>. If you did not request this, you can safely ignore it.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function inviteTemplate(inviteUrl: string, inviterName?: string) {
  const from = inviterName ? `<strong>${inviterName}</strong>` : 'a team member';
  return baseTemplate(`
    <h1>You've been invited to the Research Hub</h1>
    <p>
      ${from} has invited you to join the Purity Research Hub — our internal
      tool for exploring the science behind clean coffee.
    </p>
    <p>Click the button below to accept your invitation and set a password. The link expires in 24 hours.</p>
    <div class="cta-wrap">
      <a href="${inviteUrl}" class="cta">Accept invitation</a>
    </div>
    <hr class="divider" />
    <p class="fallback-label">Or paste this link into your browser:</p>
    <p class="fallback-link">${inviteUrl}</p>
  `);
}

function passwordResetTemplate(resetUrl: string) {
  return baseTemplate(`
    <h1>Reset your password</h1>
    <p>We received a request to reset the password for your Purity Research Hub account.</p>
    <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
    <div class="cta-wrap">
      <a href="${resetUrl}" class="cta">Reset password</a>
    </div>
    <hr class="divider" />
    <p class="fallback-label">Or paste this link into your browser:</p>
    <p class="fallback-link">${resetUrl}</p>
  `);
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

export async function sendInviteEmail(
  to: string,
  inviteUrl: string,
  inviterName?: string,
) {
  const resend = resendClient();
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to,
    subject: 'You have been invited to the Purity Research Hub',
    html: inviteTemplate(inviteUrl, inviterName),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const resend = resendClient();
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to,
    subject: 'Reset your Purity Research Hub password',
    html: passwordResetTemplate(resetUrl),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
