export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const { recipientEmail, analytics } = req.body;

  try {
    if (!recipientEmail || !analytics) throw new Error("Missing recipient or analytics data.");

    // ── Metric rows (each metric is a full-width table row) ──
    const metricRows = [
      ['General Warmth &amp; Kindness',      analytics.bond_positivity,      analytics.bond_positivity_reason],
      ['Solving Problems Together',           analytics.conflict_resolution,  analytics.conflict_resolution_reason],
      ['Comfortable Sharing Feelings',        analytics.safety_trust,         analytics.safety_trust_reason],
      ['Teamwork &amp; Connection',           analytics.relationship_dynamics,analytics.relationship_dynamics_reason],
      ['Toxicity Level',                      analytics.toxicity,             analytics.toxicity_reason],
    ].map(([label, val, reason]) => `
      <tr>
        <td style="padding: 0 0 10px 0;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5; border:1px solid #e7e5e4; border-radius:10px;">
            <tr>
              <td style="padding: 14px 16px 6px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="font-family:Helvetica,Arial,sans-serif; font-size:13px; font-weight:600; color:#1c1917; padding-right:12px;">${label}</td>
                    <td width="60" style="text-align:right; font-family:'Courier New',monospace; font-size:14px; font-weight:700; color:#1c1917; white-space:nowrap;">${val || '--'}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 16px 12px 16px; font-family:Georgia,serif; font-size:12px; color:#78716c; font-style:italic; line-height:1.5;">${reason || ''}</td>
            </tr>
          </table>
        </td>
      </tr>
    `).join('');

    // ── Profile cards ──
    const profileCards = analytics.profiles.map(p => {
      const statsRows = [
        ['Calmness &amp; Security',  p.attachment_security],
        ['Managing Frustration',     p.emotional_regulation],
        ['Willingness to Listen',    p.receptivity],
        ['Owning Personal Errors',   p.accountability],
      ].map(([label, val]) => `
        <tr>
          <td style="padding: 7px 0; border-bottom: 1px solid #e7e5e4; font-family:Helvetica,Arial,sans-serif; font-size:13px; color:#78716c;">${label}</td>
          <td style="padding: 7px 0; border-bottom: 1px solid #e7e5e4; text-align:right; font-family:'Courier New',monospace; font-size:13px; font-weight:700; color:#1c1917; white-space:nowrap;">${val || '--'}</td>
        </tr>
      `).join('');

      const actionItems = p.actionables && p.actionables.length
        ? p.actionables.map(a => `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #f0eeea; font-family:Helvetica,Arial,sans-serif; font-size:13px; color:#44403c; line-height:1.5;">
                <span style="color:#a8a29e; margin-right:6px;">→</span>${a}
              </td>
            </tr>
          `).join('')
        : '';

      return `
        <tr>
          <td style="padding: 0 0 14px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f5; border:1px solid #e7e5e4; border-radius:12px;">
              <!-- Profile name -->
              <tr>
                <td style="padding: 18px 20px 10px 20px; border-bottom: 1px solid #e7e5e4;">
                  <p style="margin:0 0 2px 0; font-family:Helvetica,Arial,sans-serif; font-size:10px; text-transform:uppercase; letter-spacing:0.15em; color:#a8a29e; font-weight:700;">Personal Style</p>
                  <p style="margin:0; font-family:Georgia,serif; font-size:17px; color:#1c1917;">${p.name}</p>
                </td>
              </tr>
              <!-- Stats -->
              <tr>
                <td style="padding: 4px 20px 8px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${statsRows}
                  </table>
                </td>
              </tr>
              ${actionItems ? `
              <!-- Next steps -->
              <tr>
                <td style="padding: 0 20px 6px 20px; border-top: 1px solid #e7e5e4;">
                  <p style="margin: 14px 0 8px 0; font-family:Helvetica,Arial,sans-serif; font-size:10px; text-transform:uppercase; letter-spacing:0.15em; color:#a8a29e; font-weight:700;">Easy Next Steps</p>
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${actionItems}
                  </table>
                </td>
              </tr>` : ''}
            </table>
          </td>
        </tr>
      `;
    }).join('');

    // ── Full email ──
    const emailHtml = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Truvah Report</title>
  <style type="text/css">
    body { margin:0; padding:0; background:#f5f4f0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
    @media only screen and (max-width: 600px) {
      .wrapper { width:100% !important; padding: 12px !important; }
      .main-card { border-radius: 12px !important; }
      .section-pad { padding: 20px 16px !important; }
      .header-pad { padding: 22px 16px !important; }
      .score-block { display: block !important; width: 100% !important; text-align: center !important; margin-top: 14px !important; }
      .summary-text { font-size: 13px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f5f4f0;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f4f0;">
    <tr>
      <td align="center" style="padding: 28px 12px;">

        <!-- Main card -->
        <table class="main-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#ffffff; border-radius:16px; border:1px solid #e7e5e4; overflow:hidden;">

          <!-- ── HEADER ── -->
          <tr>
            <td style="background:#1c1917; padding:28px 32px; text-align:center;" class="header-pad">
              <p style="margin:0 0 5px 0; font-family:Helvetica,Arial,sans-serif; font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:#57534e;">Your Report from</p>
              <p style="margin:0; font-family:Georgia,serif; font-size:30px; font-style:italic; font-weight:400; color:#faf9f5;">Truvah</p>
            </td>
          </tr>

          <!-- ── OVERALL SUMMARY + MATCH SCORE ── -->
          <tr>
            <td style="padding:28px 32px; border-bottom:1px solid #f0eeea;" class="section-pad">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <!-- Summary text -->
                  <td valign="top" style="padding-right:20px;">
                    <p style="margin:0 0 10px 0; display:inline-block; font-family:Helvetica,Arial,sans-serif; font-size:10px; background:#f0eeea; color:#78716c; font-weight:700; letter-spacing:0.15em; text-transform:uppercase; padding:3px 8px; border-radius:4px;">Overall Summary</p>
                    <p class="summary-text" style="margin:0; font-family:Georgia,serif; font-size:14px; color:#44403c; line-height:1.7; font-style:italic;">&ldquo;${analytics.bond_strength_reason || ''}&rdquo;</p>
                  </td>
                  <!-- Score box -->
                  <td class="score-block" valign="top" width="120" style="text-align:center; background:#faf9f5; border:1px solid #e7e5e4; border-radius:12px; padding:14px 16px; white-space:nowrap;">
                    <p style="margin:0 0 4px 0; font-family:Helvetica,Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.2em; color:#a8a29e; font-weight:700;">Match Level</p>
                    <p style="margin:0; font-family:Georgia,serif; font-size:32px; font-weight:300; color:#1c1917; line-height:1;">${analytics.bond_strength || '0%'}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── HOW WELL THINGS WENT ── -->
          <tr>
            <td style="padding:24px 32px; border-bottom:1px solid #f0eeea;" class="section-pad">
              <p style="margin:0 0 16px 0; font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.2em; color:#a8a29e;">How Well Things Went</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${metricRows}
              </table>
            </td>
          </tr>

          <!-- ── PERSONAL COMMUNICATION STYLES ── -->
          <tr>
            <td style="padding:24px 32px; border-bottom:1px solid #f0eeea;" class="section-pad">
              <p style="margin:0 0 16px 0; font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.2em; color:#a8a29e;">Personal Communication Styles</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${profileCards}
              </table>
            </td>
          </tr>

          <!-- ── TAKEAWAY SUMMARY ── -->
          <tr>
            <td style="padding:24px 32px;" class="section-pad">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1c1917; border-radius:12px;">
                <tr>
                  <td style="padding:22px 24px;">
                    <p style="margin:0 0 10px 0; font-family:Helvetica,Arial,sans-serif; font-size:9px; text-transform:uppercase; letter-spacing:0.25em; color:#57534e; font-weight:700;">Friendly Takeaway Advice</p>
                    <p style="margin:0; font-family:Georgia,serif; font-size:14px; font-style:italic; font-weight:300; line-height:1.8; color:#d6d3d1;">&ldquo;${analytics.summary || ''}&rdquo;</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td style="padding:18px 32px; text-align:center; border-top:1px solid #f0eeea;">
              <p style="margin:0; font-family:Helvetica,Arial,sans-serif; font-size:10px; letter-spacing:0.15em; text-transform:uppercase; color:#a8a29e;">Truvah &bull; Discussions Made Simpler</p>
            </td>
          </tr>

        </table>
        <!-- /Main card -->

      </td>
    </tr>
  </table>

</body>
</html>
    `;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.Truvah_Email}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Truvah Reports <onboarding@resend.dev>",
        to: recipientEmail,
        subject: "Your Truvah Relationship Report",
        html: emailHtml
      })
    });

    if (!emailResponse.ok) {
      const errData = await emailResponse.json();
      throw new Error(errData.message || "Resend API failed");
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
