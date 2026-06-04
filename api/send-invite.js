export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const { inviteeEmail, inviterUserId } = req.body;
  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // ── 1. Validate inputs ──
    if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail))
      throw new Error("A valid email address is required.");
    if (!inviterUserId)
      throw new Error("Inviter identity is missing.");
    if (!supabaseUrl || !supabaseServiceKey)
      throw new Error("Server configuration error.");

    const cleanDbUrl = supabaseUrl.replace(/\/$/, "");
    const dbHeaders  = {
      "apikey":        supabaseServiceKey,
      "Authorization": `Bearer ${supabaseServiceKey}`,
      "Content-Type":  "application/json",
    };

    // ── 2. Load inviter — confirm they exist and get their invite count ──
    const inviterRes = await fetch(
      `${cleanDbUrl}/rest/v1/users?id=eq.${inviterUserId}&select=id,email,invite_count`,
      { headers: { ...dbHeaders, "Accept": "application/json" } }
    );
    const inviterRows = await inviterRes.json();
    if (!inviterRows || inviterRows.length === 0)
      throw new Error("Inviter account not found.");

    const inviter = inviterRows[0];

    // ── 3. Enforce 3-invite limit ──
    if ((inviter.invite_count || 0) >= 3)
      throw new Error("INVITE_LIMIT_REACHED");

    // ── 4. Check invitee email is not already an active user ──
    const existingRes = await fetch(
      `${cleanDbUrl}/rest/v1/users?email=eq.${encodeURIComponent(inviteeEmail)}&select=id,access_granted`,
      { headers: { ...dbHeaders, "Accept": "application/json" } }
    );
    const existingRows = await existingRes.json();
    const existingUser = existingRows && existingRows.length > 0 ? existingRows[0] : null;

    if (existingUser && existingUser.access_granted)
      throw new Error("That person already has access to Truvah.");

    // ── 5. Generate a short, unguessable invite token (12 alphanumeric chars) ──
    const tokenBytes = crypto.getRandomValues(new Uint8Array(9));
    const token = btoa(String.fromCharCode(...tokenBytes))
      .replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=/g, '').slice(0, 12);

    // ── 6. If they requested access, update their row; otherwise create new ──
    if (existingUser) {
      // Update the existing waitlist row with the invite token
      const updateRes = await fetch(`${cleanDbUrl}/rest/v1/users?id=eq.${existingUser.id}`, {
        method:  "PATCH",
        headers: { ...dbHeaders, "Prefer": "return=minimal" },
        body:    JSON.stringify({
          invited_by:   inviterUserId,
          invite_token: token,
          requested:    false,
        })
      });
      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update user record.");
      }
    } else {
      // Create a fresh invited user row
      const createUserRes = await fetch(`${cleanDbUrl}/rest/v1/users`, {
        method:  "POST",
        headers: { ...dbHeaders, "Prefer": "return=representation" },
        body:    JSON.stringify({
          email:          inviteeEmail,
          invited_by:     inviterUserId,
          invite_token:   token,
          access_granted: false,
          invite_count:   0,
        })
      });
      if (!createUserRes.ok) {
        const err = await createUserRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create invited user.");
      }
    }

    // ── 7. Increment inviter's invite_count ──
    await fetch(`${cleanDbUrl}/rest/v1/users?id=eq.${inviterUserId}`, {
      method: "PATCH",
      headers: { ...dbHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ invite_count: (inviter.invite_count || 0) + 1 })
    });

    // ── 8. Build invite link ──
    const appUrl    = process.env.APP_URL || "https://www.asktruvah.com";
    const inviteUrl = `${appUrl}?token=${token}`;

    // ── 9. Build and send the email via Resend ──
    const emailHtml = buildInviteEmail(inviteUrl);

    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.Truvah_Email}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        from:    "Info <info@asktruvah.com>",
        to:      inviteeEmail,
        subject: "You've been invited to Truvah",
        html:    emailHtml
      })
    });

    if (!sendRes.ok) {
      const errData = await sendRes.json().catch(() => ({}));
      throw new Error(errData.message || "Email delivery failed.");
    }

    const remainingInvites = 3 - ((inviter.invite_count || 0) + 1);
    return res.status(200).json({ success: true, remainingInvites });

  } catch (error) {
    console.error("[send-invite] error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}

/* ─── Email template ──────────────────────────────────────────────────────── */
function buildInviteEmail(inviteUrl) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to Truvah</title>
  <style type="text/css">
    body { margin:0; padding:0; background:#f5f4f0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    @media only screen and (max-width:600px) {
      .section-pad { padding:20px 16px !important; }
      .header-pad  { padding:22px 16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f4f0;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;border:1px solid #e7e5e4;overflow:hidden;">

          <!-- HEADER -->
          <tr>
            <td class="header-pad" style="background:#1c1917;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 5px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#57534e;">An invitation from</p>
              <p style="margin:0;font-family:Georgia,serif;font-size:30px;font-style:italic;font-weight:400;color:#faf9f5;">Truvah</p>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td class="section-pad" style="padding:32px 32px 24px 32px;border-bottom:1px solid #f0eeea;">
              <p style="margin:0 0 8px 0;display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:10px;background:#1c1917;color:#faf9f5;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;padding:3px 10px;border-radius:20px;">Invite only</p>
              <h1 style="margin:14px 0 16px 0;font-family:Georgia,serif;font-size:24px;font-weight:400;font-style:italic;color:#1c1917;line-height:1.3;">Someone thinks you'd benefit from seeing your conversations differently.</h1>
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#78716c;line-height:1.7;font-weight:300;">Truvah is a private space to understand what's really happening in your most important conversations — not just what was said, but how it landed, and what it means for the relationship you're building.</p>
            </td>
          </tr>

          <!-- VALUE PROPS -->
          <tr>
            <td class="section-pad" style="padding:24px 32px;border-bottom:1px solid #f0eeea;">
              <p style="margin:0 0 16px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.2em;color:#a8a29e;">What it does</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding:0 0 10px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;border:1px solid #e7e5e4;border-radius:10px;"><tr><td style="padding:14px 16px;"><p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#1c1917;">Paste any conversation.</p><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#78716c;line-height:1.5;font-weight:300;">Arguments, misunderstandings, texts that felt off — all of it.</p></td></tr></table></td></tr>
                <tr><td style="padding:0 0 10px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;border:1px solid #e7e5e4;border-radius:10px;"><tr><td style="padding:14px 16px;"><p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#1c1917;">Get a clear read.</p><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#78716c;line-height:1.5;font-weight:300;">Warmth, tension, emotional safety, and where things went sideways — scored and explained plainly.</p></td></tr></table></td></tr>
                <tr><td style="padding:0 0 10px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;border:1px solid #e7e5e4;border-radius:10px;"><tr><td style="padding:14px 16px;"><p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#1c1917;">Walk away with next steps.</p><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#78716c;line-height:1.5;font-weight:300;">Specific, kind things to try — not generic relationship advice.</p></td></tr></table></td></tr>
                <tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5;border:1px solid #e7e5e4;border-radius:10px;"><tr><td style="padding:14px 16px;"><p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#1c1917;">Completely private.</p><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#78716c;line-height:1.5;font-weight:300;">Your conversation is never stored. It's read, analyzed, and gone.</p></td></tr></table></td></tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="section-pad" style="padding:28px 32px;text-align:center;">
              <a href="${inviteUrl}" style="display:inline-block;background:#1c1917;color:#faf9f5;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:14px 40px;border-radius:10px;">Ask Truvah &rarr;</a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:18px 32px;text-align:center;border-top:1px solid #f0eeea;">
              <p style="margin:0 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#a8a29e;line-height:1.6;">You received this because someone with access to Truvah sent you an invitation.</p>
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#a8a29e;">Truvah &bull; Discussions Made Simpler</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
