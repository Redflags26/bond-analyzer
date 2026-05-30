export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const { recipientEmail, analytics } = req.body;

  try {
    if (!recipientEmail || !analytics) throw new Error("Missing recipient or analytics data.");

    const profilesHtml = analytics.profiles.map(p => `
      <div style="margin-bottom: 24px; padding: 20px; background: #faf9f5; border-radius: 12px; border: 1px solid #e7e5e4;">
        <h3 style="margin: 0 0 12px 0; font-family: Georgia, serif; font-size: 18px; color: #1c1917;">${p.name}</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #78716c; width: 55%;">Calmness &amp; Security</td>
            <td style="padding: 6px 0; font-weight: 600; color: #1c1917;">${p.attachment_security}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #78716c;">Managing Frustration</td>
            <td style="padding: 6px 0; font-weight: 600; color: #1c1917;">${p.emotional_regulation}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #78716c;">Willingness to Listen</td>
            <td style="padding: 6px 0; font-weight: 600; color: #1c1917;">${p.receptivity}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #78716c;">Owning Personal Errors</td>
            <td style="padding: 6px 0; font-weight: 600; color: #1c1917;">${p.accountability}</td>
          </tr>
        </table>
        ${p.actionables && p.actionables.length ? `
          <div style="margin-top: 14px;">
            <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #a8a29e; font-weight: 700;">Easy Next Steps</p>
            <ul style="margin: 0; padding: 0; list-style: none;">
              ${p.actionables.map(a => `<li style="padding: 6px 0; font-size: 13px; color: #44403c; border-bottom: 1px solid #e7e5e4;">→ ${a}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `).join('');

    const metricsHtml = `
      <div style="display: grid; gap: 12px; margin-bottom: 24px;">
        ${[
          ['General Warmth & Kindness', analytics.bond_positivity, analytics.bond_positivity_reason],
          ['Solving Problems Together', analytics.conflict_resolution, analytics.conflict_resolution_reason],
          ['Comfortable Sharing Feelings', analytics.safety_trust, analytics.safety_trust_reason],
          ['Teamwork & Connection', analytics.relationship_dynamics, analytics.relationship_dynamics_reason],
          ['Toxicity Level', analytics.toxicity, analytics.toxicity_reason],
        ].map(([label, val, reason]) => `
          <div style="padding: 14px 16px; background: #faf9f5; border-radius: 10px; border: 1px solid #e7e5e4;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 13px; font-weight: 500; color: #1c1917;">${label}</span>
              <span style="font-size: 13px; font-weight: 700; color: #44403c; font-family: monospace;">${val || '--'}</span>
            </div>
            <p style="margin: 0; font-size: 12px; color: #78716c; font-style: italic;">${reason || ''}</p>
          </div>
        `).join('')}
      </div>
    `;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="margin: 0; padding: 0; background: #f5f4f0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
        <div style="max-width: 620px; margin: 32px auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e7e5e4;">

          <!-- Header -->
          <div style="background: #1c1917; padding: 28px 32px; text-align: center;">
            <p style="margin: 0 0 4px 0; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #78716c;">Your Report from</p>
            <h1 style="margin: 0; font-family: Georgia, serif; font-size: 28px; font-style: italic; font-weight: 400; color: #faf9f5;">Truvah</h1>
          </div>

          <!-- Match Score -->
          <div style="padding: 28px 32px; border-bottom: 1px solid #f0eeea; display: flex; align-items: flex-start; gap: 24px;">
            <div style="flex: 1;">
              <span style="display: inline-block; font-size: 10px; background: #f0eeea; color: #78716c; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; margin-bottom: 10px;">Overall Summary</span>
              <p style="margin: 0; font-family: Georgia, serif; font-size: 15px; color: #44403c; line-height: 1.6; font-style: italic;">"${analytics.bond_strength_reason || ''}"</p>
            </div>
            <div style="text-align: center; background: #faf9f5; border: 1px solid #e7e5e4; border-radius: 12px; padding: 16px 20px; min-width: 110px;">
              <p style="margin: 0 0 4px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 0.2em; color: #a8a29e; font-weight: 700;">Match Level</p>
              <p style="margin: 0; font-family: Georgia, serif; font-size: 30px; font-weight: 300; color: #1c1917;">${analytics.bond_strength || '0%'}</p>
            </div>
          </div>

          <!-- Metrics -->
          <div style="padding: 24px 32px; border-bottom: 1px solid #f0eeea;">
            <p style="margin: 0 0 16px 0; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; color: #a8a29e;">How Well Things Went</p>
            ${metricsHtml}
          </div>

          <!-- Profiles -->
          <div style="padding: 24px 32px; border-bottom: 1px solid #f0eeea;">
            <p style="margin: 0 0 16px 0; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.2em; color: #a8a29e;">Personal Communication Styles</p>
            ${profilesHtml}
          </div>

          <!-- Summary Takeaway -->
          <div style="margin: 24px 32px; padding: 24px; background: #1c1917; border-radius: 12px;">
            <p style="margin: 0 0 10px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 0.25em; color: #78716c; font-weight: 700;">Friendly Takeaway Advice</p>
            <p style="margin: 0; font-family: Georgia, serif; font-size: 14px; font-style: italic; font-weight: 300; line-height: 1.7; color: #d6d3d1;">"${analytics.summary || ''}"</p>
          </div>

          <!-- Footer -->
          <div style="padding: 20px 32px; text-align: center; border-top: 1px solid #f0eeea;">
            <p style="margin: 0; font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #a8a29e;">Truvah • Discussions Made Simpler</p>
          </div>

        </div>
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
