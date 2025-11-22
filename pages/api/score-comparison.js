import { neon } from '@neondatabase/serverless';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

try {
    const { patentId, gtClaims, gtCpc, huntPods, huntCpc } = req.body;
    
    const sql = neon(process.env.DATABASE_URL);

    // CPC Scoring (programmatic)
    const cpcScore = {
      primaryMatch: gtCpc?.primary === huntCpc?.primary,
      primaryInTop3: huntCpc?.all?.slice(0, 3).includes(gtCpc?.primary) || false,
      overlapCount: gtCpc?.all?.filter(code => huntCpc?.all?.includes(code)).length || 0,
      gtCount: gtCpc?.all?.length || 0,
      huntCount: huntCpc?.all?.length || 0,
    };
    
    // Calculate CPC percentage
    cpcScore.percentage = cpcScore.primaryMatch ? 100 : (cpcScore.primaryInTop3 ? 75 : (cpcScore.overlapCount > 0 ? 50 : 0));

    // POD Scoring (Claude)
    const podScore = await scorePODsWithClaude(gtClaims, huntPods);

const scores = { cpcScore, podScore, scoredAt: new Date().toISOString() };
    
    // Save to DB
    if (patentId) {
      await sql`
        UPDATE patents
        SET comparison_scores = ${JSON.stringify(scores)},
            updated_at = NOW()
        WHERE id = ${patentId}
      `;
    }

    return res.status(200).json({
      success: true,
      ...scores,
    });

  } catch (error) {
    console.error('Error scoring comparison:', error);
    return res.status(500).json({
      error: 'Scoring failed',
      details: error.message,
    });
  }
}

async function scorePODsWithClaude(gtClaims, huntPods) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    return { score: 0, rationale: 'API key not configured' };
  }

  const claimsText = gtClaims?.independent?.map((c, i) => `Claim ${i + 1}: ${c}`).join('\n\n') || 'No claims';
  const podsText = huntPods?.map((p, i) => `POD ${i + 1}${p.isPrimary ? ' (Primary)' : ''}: ${p.text}`).join('\n\n') || 'No PODs';

  const prompt = `You are evaluating how well AI-extracted Points of Distinction (PODs) capture the essence of a patent's independent claims.

GROUND TRUTH INDEPENDENT CLAIMS:
${claimsText}

AI-EXTRACTED PODs:
${podsText}

Score 0-100 how well the PODs capture the key inventive concepts from the claims:
- 90-100: PODs capture all major claim elements
- 70-89: PODs capture most key elements, minor gaps
- 50-69: PODs capture some elements but miss important features
- 25-49: PODs only partially relevant
- 0-24: PODs miss the invention entirely

Respond ONLY with JSON (no markdown):
{"score": <number>, "rationale": "<one sentence explanation>"}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', errorText);
    return { score: 0, rationale: 'Scoring API error' };
  }

  const data = await response.json();
  const text = data.content[0].text.trim();
  
  try {
    // Strip markdown if present
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse Claude response:', text);
    return { score: 0, rationale: 'Failed to parse score' };
  }
}
