export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { inviteeEmail } = req.body;

  try {
    if (
      !inviteeEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)
    ) {
      throw new Error("A valid email address is required.");
    }

    console.log("Sending invite to:", inviteeEmail);
    console.log(
      "API key exists:",
      !!process.env.Truvah_Email
    );

    const emailHtml = `YOUR EXISTING EMAIL HTML HERE`;

    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.Truvah_Email}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Truvah Reports <onboarding@resend.dev>",
        to: inviteeEmail,
        subject: "You've been invited to Truvah",
        html: emailHtml
      })
    });

    const responseData = await result.json().catch(() => ({}));

    console.log("Resend status:", result.status);
    console.log("Resend response:", responseData);

    if (!result.ok) {
      throw new Error(
        responseData.message ||
        responseData.error ||
        JSON.stringify(responseData) ||
        "Failed to send invite"
      );
    }

    return res.status(200).json({
      success: true,
      resend: responseData
    });

  } catch (error) {
    console.error("Invite error:", error);

    return res.status(500).json({
      error: error.message || "Unknown error"
    });
  }
}
