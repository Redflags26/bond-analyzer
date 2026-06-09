// ============================================================
//  analyze.js — HTTP handler.
//  Orchestrates the 2-agent pipeline (Analysis -> Strategist)
//  and fires episode extraction as a non-blocking side effect.
// ============================================================

import {
  CHATS_PER_USER,
  REQUIRED_ANALYSIS_KEYS,
  REQUIRED_STRATEGIST_KEYS,
  PRIMARY_USER_ID,
  buildPacingNote,
  buildAnalysisPrompt,
  buildStrategistPrompt,
} from './analyze-config.js';
import { calculateTimelineMetrics, queryAgent } from './analyze-engine.js';
import { extractAndStoreEpisodes }               from './episode-extractor.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { chatLog, userId } = req.body;
  const apiKey             = process.env.OPENROUTER_API_KEY;
  const supabaseUrl        = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !supabaseServiceKey)
    return res.status(500).json({ error: 'Missing environment keys.' });

  try {
    // ── 1. Parse — deterministic timeline annotation ─────────
    const { enrichedText, metrics, names } = calculateTimelineMetrics(chatLog);

    // ── 2. Usage gate ─────────────────────────────────────────
    if (userId && userId !== PRIMARY_USER_ID) {
      const countRes = await fetch(
        `${supabaseUrl.replace(/\/$/, '')}/rest/v1/conversations?user_id=eq.${userId}&select=id`,
        {
          headers: {
            'apikey':        supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Prefer':        'count=exact',
          },
        }
      );
      const totalUsed = parseInt(
        countRes.headers.get('content-range')?.split('/')[1] ?? '0',
        10,
      );
      if (totalUsed >= CHATS_PER_USER) {
        return res.status(403).json({
          error:   'usage_limit_reached',
          used:    totalUsed,
          limit:   CHATS_PER_USER,
          message: `You've used all ${CHATS_PER_USER} of your analyses. Reach out to your inviter for more access.`,
        });
      }
    }

    // ── 3. Build pacing note ──────────────────────────────────
    const pacingNote = buildPacingNote({ names, metrics });

    // ── 4. Agent 1: Analysis ──────────────────────────────────
    const analysisResults = await queryAgent(
      apiKey,
      buildAnalysisPrompt({ names, pacingNote }),
      enrichedText,
    );

    if (!analysisResults || typeof analysisResults !== 'object')
      throw new Error('Analysis agent returned invalid payload.');

    for (const key of REQUIRED_ANALYSIS_KEYS) {
      if (analysisResults[key] === undefined)
        throw new Error(`Analysis key missing: ${key}`);
    }

    if (!Array.isArray(analysisResults.profiles) || analysisResults.profiles.length < 2)
      throw new Error('Analysis agent did not return two individual profiles.');

    // ── 5. Agent 2: Strategist ────────────────────────────────
    const strategies = await queryAgent(
      apiKey,
      buildStrategistPrompt({ names, analysisData: analysisResults }),
      enrichedText,
    );

    if (!strategies || typeof strategies !== 'object')
      throw new Error('Strategist agent returned invalid payload.');

    for (const key of REQUIRED_STRATEGIST_KEYS) {
      if (strategies[key] === undefined)
        throw new Error(`Strategist key missing: ${key}`);
    }

    // ── 6. Resolve profiles and actionables ───────────────────
    const profile1 =
      analysisResults.profiles.find(
        p => p.name?.toLowerCase() === names.consistentPartner.toLowerCase(),
      ) || analysisResults.profiles[0];

    const profile2 =
      analysisResults.profiles.find(
        p => p.name?.toLowerCase() === names.asyncPartner.toLowerCase(),
      ) || analysisResults.profiles[1];

    const k1 = names.consistentPartner;
    const k2 = names.asyncPartner;

    const actionablesContainer = strategies.actionables || {};
    const p1Actionables =
      actionablesContainer[k1]         ||
      strategies.person1_actionables   ||
      actionablesContainer['person1_actionables'] ||
      [];
    const p2Actionables =
      actionablesContainer[k2]         ||
      strategies.person2_actionables   ||
      actionablesContainer['person2_actionables'] ||
      [];

    // ── 7. Assemble final report ──────────────────────────────
    const analytics = {
      bond_positivity:              analysisResults.bond_positivity,
      bond_positivity_reason:       analysisResults.bond_positivity_reason,
      conflict_resolution:          analysisResults.conflict_resolution,
      conflict_resolution_reason:   analysisResults.conflict_resolution_reason,
      safety_trust:                 analysisResults.safety_trust,
      safety_trust_reason:          analysisResults.safety_trust_reason,
      relationship_dynamics:        analysisResults.relationship_dynamics,
      relationship_dynamics_reason: analysisResults.relationship_dynamics_reason,
      toxicity:                     analysisResults.toxicity,
      toxicity_reason:              analysisResults.toxicity_reason,
      bond_strength:                strategies.bond_strength,
      bond_strength_reason:         strategies.bond_strength_reason,
      summary:                      strategies.summary,
      profiles: [
        { ...profile1, actionables: p1Actionables },
        { ...profile2, actionables: p2Actionables },
      ],
    };

    // ── 8. Write conversation row — capture returned ID ───────
    // We need the conversation_id back so episode-extractor can
    // FK against it. Use "return=representation" to get the row.
    let conversationId = null;

    try {
      const dbResponse = await fetch(
        `${supabaseUrl.replace(/\/$/, '')}/rest/v1/conversations`,
        {
          method:  'POST',
          headers: {
            'apikey':        supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type':  'application/json',
            // Return the inserted row so we can read conversation_id
            'Prefer':        'return=representation',
          },
          body: JSON.stringify({
            bond_strength:    analytics.bond_strength,
            summary:          analytics.summary,
            full_analytics:   analytics,
            // New columns added by schema migration
            speaker_a:        names.consistentPartner,
            speaker_b:        names.asyncPartner,
            ontology_version: '0.3',
            ...(userId ? { user_id: userId } : {}),
          }),
        },
      );

      if (dbResponse.ok) {
        const rows = await dbResponse.json();
        // Supabase returns an array even for single inserts
        conversationId = Array.isArray(rows) ? rows[0]?.conversation_id : rows?.conversation_id;
      } else {
        const errorDetails = await dbResponse.text();
        console.error(`Supabase rejected payload: ${dbResponse.status} - ${errorDetails}`);
      }
    } catch (dbError) {
      console.error('Supabase conversation write failed:', dbError.message);
    }

    // ── 9. Return report to frontend immediately ──────────────
    // Episode extraction runs AFTER the response is sent.
    // A failure in extraction never affects the user-facing result.
    res.status(200).json({ modelUsed: 'deterministic-hybrid-pipeline', analytics });

    // ── 10. Fire-and-forget: extract and store episodes ───────
    // Only runs if we have a conversationId to FK against.
    if (conversationId) {
      extractAndStoreEpisodes({
        apiKey,
        supabaseUrl,
        supabaseKey:    supabaseServiceKey,
        conversationId,
        enrichedText,
        names,
      })
        .then(result => {
          console.log(
            `[episodes] conversation=${conversationId} ` +
            `context=${result.context} episodes=${result.episodes} ` +
            `errors=${result.errors.length}`,
          );
        })
        .catch(err => {
          // Swallow — never propagate to user
          console.error(`[episodes] extraction failed for ${conversationId}:`, err.message);
        });
    } else {
      console.warn('[episodes] skipped — no conversationId from DB write');
    }

  } catch (err) {
    console.error('Pipeline error:', err.message);
    return res.status(500).json({ error: `Analysis error: ${err.message}` });
  }
}
