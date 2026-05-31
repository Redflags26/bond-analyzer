export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const { token } = req.body;
  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    if (!token) throw new Error("Token is required.");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Server configuration error.");

    const cleanDbUrl = supabaseUrl.replace(/\/$/, "");
    const dbHeaders  = {
      "apikey":        supabaseServiceKey,
      "Authorization": `Bearer ${supabaseServiceKey}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    };

    // ── Look up user by token ──
    const userRes  = await fetch(
      `${cleanDbUrl}/rest/v1/users?invite_token=eq.${encodeURIComponent(token)}&select=id,email,access_granted,invite_count`,
      { headers: dbHeaders }
    );
    const userRows = await userRes.json();

    if (!userRows || userRows.length === 0)
      return res.status(403).json({ error: "INVALID_TOKEN" });

    const user = userRows[0];

    // ── If not yet granted, activate them now (first-time visit via link) ──
    if (!user.access_granted) {
      await fetch(`${cleanDbUrl}/rest/v1/users?id=eq.${user.id}`, {
        method:  "PATCH",
        headers: { ...dbHeaders, "Prefer": "return=minimal" },
        body:    JSON.stringify({ access_granted: true })
      });
    }

    // ── Return the user identity to the frontend ──
    return res.status(200).json({
      valid:        true,
      userId:       user.id,
      email:        user.email,
      inviteCount:  user.invite_count || 0,
    });

  } catch (error) {
    console.error("[verify-token] error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
