import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

async function extractGroundTruthWithClaude(pdfUrl, retries = 3) {
  console.log('Fetching PDF for ground truth extraction...');
  
  // Fetch PDF
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
        
        // Parse JSON response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('Could not find JSON in Claude response');
        }
        
        console.log('Claude API success!');
        return JSON.parse(jsonMatch[0]);
      }

      // Check if we should retry
      const shouldRetry = response.headers.get('x-should-retry') === 'true';
      const status = response.status;
      
      if (shouldRetry && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Claude overloaded (${s
