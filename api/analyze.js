export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'Missing API Key configuration.' });

  const systemPrompt = `You are a high-level behavioral psychologist. Analyze the provided chat log between two partners.
  Map observations to macro relationship tones and create individual trait profiles.
  
  Return ONLY a valid JSON object with this exact structure:
  {
    "bond_strength": "XX%",
    "bond_strength_reason": "...",
    "bond_positivity": "XX%",
    "bond_positivity_reason": "...",
    "conflict_resolution": "XX%",
    "conflict_resolution_reason": "...",
    "safety_trust": "XX%",
    "safety_trust_reason": "...",
    "relationship_dynamics": "XX%",
    "relationship_dynamics_reason": "...",
    "toxicity": "XX%",
    "toxicity_reason": "...",
    "summary": "...",
    "profiles": [
      {
        "name": "Partner 1 Name",
        "attachment_style": "...",
        "emotional_regulation": "...",
        "communication_style": "...",
        "actionables": ["Action 1", "Action 2"]
      },
      {
        "name": "Partner 2 Name",
        "attachment_style": "...",
        "emotional_regulation": "...",
        "communication_style": "...",
        "actionables": ["Action 1", "Action 2"]
      }
    ]
  }`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: chatLog }],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return res.status(200).json({ modelUsed: data.model, analytics: result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

### 🎨 Step 2: Update the Frontend Code (`index.html`)
I have redesigned this to include the **Profile Container** and the **JS Mapping Logic** that was missing.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ClarityLab | Interaction Insights</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <style>
        .progress-bar { transition: width 1.5s ease-in-out; }
        .glass-card { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(10px); }
    </style>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen font-sans">

    <header class="p-6 max-w-5xl mx-auto flex justify-between items-center">
        <h1 class="text-2xl font-bold tracking-tight">Clarity<span class="text-indigo-600">Lab</span></h1>
        <div id="modelBadge" class="hidden text-[10px] uppercase tracking-widest font-bold text-slate-400">
            Engine: <span id="modelNameText" class="text-indigo-600">--</span>
        </div>
    </header>

    <main class="max-w-4xl mx-auto p-6 space-y-12">
        <section class="text-center space-y-4">
            <h2 class="text-4xl font-extrabold tracking-tight text-slate-900">Understand the silence.</h2>
            <p class="text-slate-500 max-w-lg mx-auto italic">Objective, clinical analysis of your conversational dynamics and individual traits.</p>
        </section>

        <section class="bg-white rounded-3xl shadow-xl shadow-indigo-100/50 p-8 border border-slate-100">
            <textarea id="chatInput" rows="8" placeholder="Alex: Why do we always fight?&#10;Sam: I don't know, it feels like I can't say anything right." class="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500/20 text-sm font-mono mb-4"></textarea>
            <button id="analyzeBtn" onclick="analyzeChat()" class="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-indigo-600 transition-all transform active:scale-[0.98]">Analyze Interaction Dynamics</button>
        </section>

        <section id="resultSection" class="hidden space-y-10">
            <div class="flex justify-between items-end border-b pb-6">
                <div>
                    <h3 class="text-xl font-bold">Bond Analysis</h3>
                    <p id="bondStrengthReason" class="text-sm text-slate-500 italic mt-1"></p>
                </div>
                <div class="text-right">
                    <span class="text-sm text-slate-400 block uppercase font-bold tracking-wider">Strength</span>
                    <span id="bondStrengthMeter" class="text-5xl font-black text-indigo-600">0%</span>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-6 rounded-3xl border border-slate-100 space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-400 uppercase">Bond Positivity</span>
                        <span id="positivityVal" class="font-bold text-emerald-600">--</span>
                    </div>
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="positivityBar" class="progress-bar h-full bg-emerald-500 w-0"></div></div>
                    <p id="positivityReason" class="text-xs text-slate-500 leading-relaxed"></p>
                </div>

                <div class="bg-white p-6 rounded-3xl border border-slate-100 space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-400 uppercase">Conflict Resolution</span>
                        <span id="conflictVal" class="font-bold text-blue-600">--</span>
                    </div>
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="conflictBar" class="progress-bar h-full bg-blue-500 w-0"></div></div>
                    <p id="conflictReason" class="text-xs text-slate-500 leading-relaxed"></p>
                </div>

                <div class="bg-white p-6 rounded-3xl border border-slate-100 space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-400 uppercase">Safety & Trust</span>
                        <span id="safetyVal" class="font-bold text-indigo-600">--</span>
                    </div>
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="safetyBar" class="progress-bar h-full bg-indigo-500 w-0"></div></div>
                    <p id="safetyReason" class="text-xs text-slate-500 leading-relaxed"></p>
                </div>

                <div class="bg-white p-6 rounded-3xl border border-slate-100 space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-slate-400 uppercase">Toxicity Risk</span>
                        <span id="toxicityVal" class="font-bold text-rose-600">--</span>
                    </div>
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="toxicityBar" class="progress-bar h-full bg-rose-500 w-0"></div></div>
                    <p id="toxicityReason" class="text-xs text-slate-500 leading-relaxed"></p>
                </div>
            </div>

            <div class="space-y-6">
                <h4 class="text-sm font-bold uppercase tracking-widest text-slate-400 text-center">Individual Trait Roadmap</h4>
                <div id="profileContainer" class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    </div>
            </div>

            <div class="bg-slate-900 text-white p-8 rounded-3xl">
                <span class="text-[10px] text-indigo-400 uppercase font-bold tracking-widest">Synthesis Summary</span>
                <p id="summaryText" class="mt-2 text-lg font-medium italic"></p>
            </div>
        </section>
    </main>

    <script>
        async function analyzeChat() {
            const chatLog = document.getElementById('chatInput').value.trim();
            const analyzeBtn = document.getElementById('analyzeBtn');
            const resultSection = document.getElementById('resultSection');
            const profileContainer = document.getElementById('profileContainer');
            
            if (!chatLog) return alert("Please enter transcripts.");

            analyzeBtn.disabled = true;
            analyzeBtn.innerText = "Analyzing Dynamics...";
            resultSection.classList.add('hidden');
            profileContainer.innerHTML = "";

            try {
                const response = await fetch("/api/analyze", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatLog })
                });

                const data = await response.json();
                const scores = data.analytics;

                // Update UI
                document.getElementById('bondStrengthMeter').innerText = scores.bond_strength;
                document.getElementById('bondStrengthReason').innerText = scores.bond_strength_reason;
                document.getElementById('positivityVal').innerText = scores.bond_positivity;
                document.getElementById('positivityReason').innerText = scores.bond_positivity_reason;
                document.getElementById('conflictVal').innerText = scores.conflict_resolution;
                document.getElementById('conflictReason').innerText = scores.conflict_resolution_reason;
                document.getElementById('safetyVal').innerText = scores.safety_trust;
                document.getElementById('safetyReason').innerText = scores.safety_trust_reason;
                document.getElementById('toxicityVal').innerText = scores.toxicity;
                document.getElementById('toxicityReason').innerText = scores.toxicity_reason;
                document.getElementById('summaryText').innerText = `"${scores.summary}"`;

                // Update Bars
                document.getElementById('positivityBar').style.width = scores.bond_positivity;
                document.getElementById('conflictBar').style.width = scores.conflict_resolution;
                document.getElementById('safetyBar').style.width = scores.safety_trust;
                document.getElementById('toxicityBar').style.width = scores.toxicity;

                // INJECT PROFILES
                scores.profiles.forEach(p => {
                    const card = document.createElement('div');
                    card.className = "bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4";
                    card.innerHTML = `
                        <div class="border-b pb-2">
                            <span class="text-[10px] text-indigo-500 font-bold uppercase">Persona</span>
                            <h5 class="text-xl font-bold">${p.name}</h5>
                        </div>
                        <div class="grid grid-cols-1 gap-2 text-xs">
                            <p><strong>Attachment:</strong> ${p.attachment_style}</p>
                            <p><strong>Regulation:</strong> ${p.emotional_regulation}</p>
                            <p><strong>Style:</strong> ${p.communication_style}</p>
                        </div>
                        <div class="space-y-2 pt-2 border-t">
                            <span class="text-[10px] text-slate-400 font-bold uppercase">Growth Steps</span>
                            ${p.actionables.map(a => `<p class="text-xs bg-slate-50 p-2 rounded-lg border-l-4 border-indigo-500 italic">"${a}"</p>`).join('')}
                        </div>
                    `;
                    profileContainer.appendChild(card);
                });

                resultSection.classList.remove('hidden');
            } catch (e) { alert("Error: " + e.message); }
            finally { analyzeBtn.disabled = false; analyzeBtn.innerText = "Analyze Interaction Dynamics"; }
        }
    </script>
</body>
</html>

Your slide deck and corrected code for **ClarityLab** are ready! Feel free to deploy these updates to see the individual roadmaps live.
