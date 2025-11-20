import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

async function extractGroundTruthWithClaude(pdfUrl, retries = 3) {
  console.log('Fetching PDF for ground truth extraction...');
  
  const pdfResponse = await fetch(pdfUrl);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const base64Pdf = Buffer.from(pdfBuffer).toString('base64');
  
  console.log(`PDF fetched: ${pdfBuffer.byteLength} bytes`);

  const prompt = `Extract ground truth data from this patent PDF for validation testing.

Extract:
1. ALL INDEPENDENT CLAIMS (claims that do not reference another claim)
   - Include full text of each independent claim
   
2. CPC CLASSIFICATION CODES
   - Primary CPC code
   - All CPC codes

Return ONLY valid JSON (no markdown, no backticks):

{
  "independentClaims": [
    "1. A method comprising: ...",
    "10. A system comprising: ..."
  ],
  "cpc": {
    "primary": "G06F 40/169",
    "all": ["G06F 40/169", "G06N 3/08"]
  }
}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Claude API attempt ${attempt}/${retries}...`);
      
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
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64Pdf,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const responseText = data.content[0].text;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('Could not find JSON in Claude response');
        }
        console.log('Claude API success!');
        return JSON.parse(jsonMatch[0]);
      }

      const shouldRetry = response.headers.get('x-should-retry') === 'true';
      const status = response.status;
      
      if (shouldRetry && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Claude overloaded, retrying in ${waitTime / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      const error = await response.text();
      throw new Error(`Claude API error: ${error}`);
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`Error on attempt ${attempt}, retrying in ${waitTime / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
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

    const groundTruth = await extractGroundTruthWithClaude(patent.raw_pdf_url);

    console.log(`Extracted ${groundTruth.independentClaims.length} independent claims`);
    console.log(`Primary CPC: ${groundTruth.cpc.primary}`);

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
