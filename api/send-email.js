export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

  const { recipientEmail, analytics } = req.body;

  try {
    if (!recipientEmail || !analytics) throw new Error("Missing recipient or data.");

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
        html: `
          <div style="font-family:sans-serif; padding: 20px; line-height: 1.6;">
            <h1 style="color: #4f46e5;">Relationship Analysis Report</h1>
            <p>${analytics.summary}</p>
            <hr />
            <h3>Key Metrics</h3>
            ${analytics.profiles.map(p => `
              <div style="margin-bottom: 20px;">
                <h4 style="margin-bottom: 5px;">${p.name}</h4>
                <p>Attachment Security: ${p.attachment_security}</p>
                <p>Emotional Regulation: ${p.emotional_regulation}</p>
              </div>
            `).join('')}
          </div>
        `
      })
    });

    if (!emailResponse.ok) throw new Error("Resend API failed");
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
```

### 2. Frontend Update (`index.html`)
Update your `index.html` to capture the results and call the new API.

**Add this button to your HTML where you display results:**
```html
<div class="mt-8 flex justify-center">
    <button id="emailReportBtn" class="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
        Email This Report
    </button>
</div>
```

**Add this logic to your script block:**
```javascript
// 1. Declare a global variable to store results
let latestAnalytics = null;

// 2. Inside your analyzeConversation function, save the data:
// (Inside your existing fetch success block)
const data = await response.json();
latestAnalytics = data.analytics; // <--- SAVE THIS

// 3. Add the email trigger listener:
document.getElementById('emailReportBtn').addEventListener('click', async () => {
    if (!latestAnalytics) return;
    const email = prompt("Enter your email address to receive this report:");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!email || !emailRegex.test(email)) {
        alert("Please enter a valid email address.");
        return;
    }

    try {
        const btn = document.getElementById('emailReportBtn');
        btn.innerText = 'Sending...';
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipientEmail: email, analytics: latestAnalytics })
        });

        if (!response.ok) throw new Error("Email sending failed");
        alert("Report sent successfully!");
        btn.innerText = 'Email Sent!';
    } catch (err) {
        alert("Error: " + err.message);
        document.getElementById('emailReportBtn').innerText = 'Email This Report';
    }
});
