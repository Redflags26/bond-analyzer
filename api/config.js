// ============================================================
// config.js  —  Serves public frontend config securely.
// Keys stay in environment variables, never in HTML source.
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  // Only expose keys that are safe for the frontend to use
  // (PostHog uses a public project API key — it is designed to be used client-side,
  //  but keeping it server-served means it never appears in your source code)
  return res.status(200).json({
    posthogKey:  process.env.POSTHOG_KEY  || '',
    posthogHost: process.env.POSTHOG_HOST || 'https://app.posthog.com',
  });
}
