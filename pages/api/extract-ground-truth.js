import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

async function extractGroundTruthWithClaude(pdfUrl) {
  const prompt = `You are extracting ground truth data from a patent PDF for validation testing.

Extract the following from the patent at ${pdfUrl}:

1. ALL INDEPENDENT CLAIMS (claims that do not reference another claim)
   - Typically claim 1, and any other claims that start fresh (e.g., claim 10, claim 20)
   - Include the full text of each independent claim
   
2. CPC CLASSIFICATION CODES
   - Primary CPC code (the main classification)
   - All CPC codes listed in the patent

CRITICAL: Return ONLY valid JSON in this exact format with no additional text:

{
  "independentClaims": [
    "1. A method comprising: ...",
    "10. A system comprising: ..."
  ],
  "cpc": {
    "primary": "G06F 40/169",
    "all": ["G06F 40/169", "G06N 3/08", "G06F 16/33"]
  }
}

Do not include any markdown formatting, backticks, or explanatory text. Output only the JSON object.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  const responseText = data.content[0].text;
  
  // Parse JSON response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in Claude response');
  }
  
  return JSON.parse(jsonMatch[0]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { patentId } = req.body;

    if (!patentId) {
      return res.status(400).json({ error: 'Patent ID required' });
    }

    console.log(`Extracting ground truth for patent ID: ${patentId}`);

    // Get patent from database
    const sql = neon(process.env.DATABASE_URL);
    
    const patents = await sql`
      SELECT id, patent_number, raw_pdf_url
      FROM patents
      WHERE id = ${patentId}
    `;

    if (patents.length === 0) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    const patent = patents[0];

    console.log(`Extracting ground truth for: ${patent.patent_number}`);
    console.log(`PDF URL: ${patent.raw_pdf_url}`);

    // Extract ground truth with Claude
    const groundTruth = await extractGroundTruthWithClaude(patent.raw_pdf_url);

    console.log(`Extracted ${groundTruth.independentClaims.length} independent claims`);
    console.log(`Primary CPC: ${groundTruth.cpc.primary}`);
    console.log(`Total CPC codes: ${groundTruth.cpc.all.length}`);

    // Update database
    await sql`
      UPDATE patents
      SET 
        ground_truth_claims = ${JSON.stringify({ independent: groundTruth.independentClaims })},
        ground_truth_cpc = ${JSON.stringify(groundTruth.cpc)},
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log('Ground truth saved to database');

    return res.status(200).json({
      success: true,
      patentNumber: patent.patent_number,
      independentClaims: groundTruth.independentClaims,
      cpc: groundTruth.cpc,
    });

  } catch (error) {
    console.error('Error extracting ground truth:', error);
    return res.status(500).json({
      error: 'Failed to extract ground truth',
      details: error.message,
    });
  }
}
