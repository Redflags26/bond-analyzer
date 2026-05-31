export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body;
  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("A valid email address is required.");
    if (!supabaseUrl || !supabaseServiceKey)
      throw new Error("Server configuration error.");

    const cleanDbUrl = supabaseUrl.replace(/\/$/, "");
    const dbHeaders  = {
      "apikey":        supabaseServiceKey,
      "Authorization": `Bearer ${supabaseServiceKey}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    };

    // ── Check if email already exists (invited or requested) ──
    const existingRes  = await fetch(
      `${cleanDbUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,access_granted`,
      { headers: dbHeaders }
    );
    const existingRows = await existingRes.json();

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.access_granted) {
        // They already have access — tell them to check their email
        throw new Error("This email already has access. Check your inbox for an invite link.");
      }
      // Already on the waitlist — silently succeed (no duplicate)
      return res.status(200).json({ success: true });
    }

    // ── Insert new waitlist entry ──
    // invited_by = 'Requested', access_granted = false, no invite_token
    const insertRes = await fetch(`${cleanDbUrl}/rest/v1/users`, {
      method:  "POST",
      headers: { ...dbHeaders, "Prefer": "return=minimal" },
      body:    JSON.stringify({
        email:          email,
        invited_by:     null,
        invite_token:   null,
        access_granted: false,
        invite_count:   0,
        requested:      true,   // flag to distinguish from invited users
      })
    });

    if (!insertRes.ok) {
      const err = await insertRes.json().catch(() => ({}));
      throw new Error(err.message || "Could not save your request.");
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("[request-access] error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
