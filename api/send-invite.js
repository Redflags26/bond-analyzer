import { Resend } from 'resend';

const resend = new Resend(process.env.Truvah_Email);

/**
 * POST /api/send-invite
 * Body: { inviteeEmail: string }
 *
 * Sends a crisp, exclusive invitation email to the provided address.
 * Wire this into your Express / Next.js / serverless handler as needed.
 */
export async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { inviteeEmail } = req.body;

    if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }

    try {
        await resend.emails.send({
            from: "Truvah Reports <onboarding@resend.dev>",   // update to your verified sender domain
            to: inviteeEmail,
            subject: 'You've been invited to Truvah',
            html: inviteEmailHtml(inviteeEmail),
            text: inviteEmailText(),
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[send-invite] Resend error:', err);
        return res.status(500).json({ error: 'Failed to send invite. Please try again.' });
    }
}

/* ─── Email templates ─────────────────────────────────────────────────────── */

function inviteEmailHtml(email) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to Truvah</title>
</head>
<body style="margin:0;padding:0;background:#FAF9F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1c1917;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF9F5;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Logo / wordmark -->
          <tr>
            <td style="padding-bottom:40px;">
              <span style="font-size:22px;font-weight:700;letter-spacing:-0.5px;font-style:italic;color:#1c1917;">Truvah</span>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="background:#ffffff;border:1px solid rgba(214,211,209,0.6);border-radius:16px;padding:40px 36px;">

              <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#a8a29e;">
                Invite only
              </p>

              <h1 style="margin:0 0 20px;font-size:26px;font-weight:400;line-height:1.25;color:#1c1917;font-style:italic;">
                Someone thinks you'd benefit from seeing your conversations differently.
              </h1>

              <p style="margin:0 0 28px;font-size:14px;line-height:1.7;color:#78716c;font-weight:300;">
                Truvah is a private space to understand what's really happening in your most important conversations — not just what was said, but how it landed, and what it means for the relationship you're building.
              </p>

              <!-- Value props -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #f5f4f0;font-size:13px;color:#57534e;line-height:1.5;">
                    <span style="color:#1c1917;font-weight:500;">Paste any conversation.</span> Arguments, misunderstandings, texts that felt off — all of it.
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #f5f4f0;font-size:13px;color:#57534e;line-height:1.5;">
                    <span style="color:#1c1917;font-weight:500;">Get a clear read.</span> Warmth, tension, emotional safety, and where things went sideways — scored and explained.
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #f5f4f0;font-size:13px;color:#57534e;line-height:1.5;">
                    <span style="color:#1c1917;font-weight:500;">Walk away with next steps.</span> Specific, kind things to try — not generic relationship advice.
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #f5f4f0;font-size:13px;color:#57534e;line-height:1.5;">
                    <span style="color:#1c1917;font-weight:500;">Completely private.</span> Your conversation is never stored. It's read, analyzed, and gone.
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://truvah.com" 
                       style="display:inline-block;background:#1c1917;color:#FAF9F5;text-decoration:none;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:14px 36px;border-radius:10px;">
                      Try Truvah →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer note -->
          <tr>
            <td style="padding:28px 0 0;text-align:center;font-size:10px;color:#a8a29e;letter-spacing:0.1em;line-height:1.6;">
              You received this because someone with access to Truvah sent you an invitation.<br />
              TRUVAH • DISCUSSIONS MADE SIMPLER
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

function inviteEmailText() {
    return `You're invited to Truvah
─────────────────────────────────

Someone thinks you'd benefit from seeing your conversations differently.

Truvah is a private space to understand what's really happening in your most important conversations — not just what was said, but how it landed, and what it means for the relationship you're building.

Here's what it does:

→ Paste any conversation — arguments, misunderstandings, texts that felt off.
→ Get a clear read — warmth, tension, emotional safety, and where things went sideways, scored and explained.
→ Walk away with next steps — specific, kind things to try, not generic advice.
→ Completely private — your conversation is never stored. It's read, analyzed, and gone.

Try it here: https://truvah.com

─────────────────────────────────
You received this because someone with access to Truvah sent you an invitation.
TRUVAH • DISCUSSIONS MADE SIMPLER
`;
}
