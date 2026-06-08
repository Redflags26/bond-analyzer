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

    // ── 1. Check if email already exists ──
    const existingRes  = await fetch(
      `${cleanDbUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,access_granted,invite_token`,
      { headers: dbHeaders }
    );
    const existingRows = await existingRes.json();
    const existingUser = existingRows && existingRows.length > 0 ? existingRows[0] : null;

    let token = "";

    if (existingUser) {
      // If user exists, retrieve their existing token or generate one if they don't have one
      if (existingUser.invite_token) {
        token = existingUser.invite_token;
      } else {
        const tokenBytes = crypto.getRandomValues(new Uint8Array(9));
        token = btoa(String.fromCharCode(...tokenBytes))
          .replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=/g, '').slice(0, 12);

        const updateRes = await fetch(`${cleanDbUrl}/rest/v1/users?id=eq.${existingUser.id}`, {
          method:  "PATCH",
          headers: { ...dbHeaders, "Prefer": "return=minimal" },
          body:    JSON.stringify({ invite_token: token })
        });
        if (!updateRes.ok) throw new Error("Failed to assign security token.");
      }
    } else {
      // ── 2. Create a new user with a fresh invite token ──
      const tokenBytes = crypto.getRandomValues(new Uint8Array(9));
      token = btoa(String.fromCharCode(...tokenBytes))
        .replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=/g, '').slice(0, 12);

      const createUserRes = await fetch(`${cleanDbUrl}/rest/v1/users`, {
        method:  "POST",
        headers: { ...dbHeaders, "Prefer": "return=representation" },
        body:    JSON.stringify({
          email:          email,
          invited_by:     null,
          invite_token:   token,
          access_granted: false, // Remains false; verify-token endpoint will handle status toggling
          invite_count:   0,
          requested:      true,
        })
      });

      if (!createUserRes.ok) {
        const err = await createUserRes.json().catch(() => ({}));
        throw new Error(err.message || "Could not register access.");
      }
    }

    // Return token to the client immediately
    return res.status(200).json({ success: true, token });

  } catch (error) {
    console.error("[request-without-invite] error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
