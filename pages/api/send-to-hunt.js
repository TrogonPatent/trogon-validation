import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

async function sendToHuntAPI(specUrl, drawingsUrl) {
  console.log('Fetching spec and drawings files...');
  
  // Fetch spec text
  const specResponse = await fetch(specUrl);
  const specText = await specResponse.text();
  
  // Fetch drawings PDF
  const drawingsResponse = await fetch(drawingsUrl);
  const drawingsBuffer = await drawingsResponse.arrayBuffer();
  
  console.log(`Spec size: ${specText.length} chars`);
  console.log(`Drawings size: ${drawingsBuffer.byteLength} bytes`);
  
  // Create multipart form data with ANONYMOUS filenames
  // No patent number to avoid biasing Hunt's analysis
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  
  const parts = [];
  
  // Add spec.txt file - ANONYMOUS filename
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="spec.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `${specText}\r\n`
  );
  
  // Add drawings.pdf file - ANONYMOUS filename
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="drawings.pdf"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`
  );
  
  const body = Buffer.concat([
    Buffer.from(parts[0], 'utf8'),
    Buffer.from(parts[1], 'utf8'),
    Buffer.from(drawingsBuffer),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  ]);
  
  console.log('Sending to Hunt API with anonymous filenames...');
  
  // Send to Hunt
  const huntResponse = await fetch('https://monitoring.trogonpatent.ai/api/upload-provisional', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });
  
  if (!huntResponse.ok) {
    const errorText = await huntResponse.text();
    throw new Error(`Hunt API error: ${huntResponse.status} - ${errorText}`);
  }
  
  const huntData = await huntResponse.json();
  console.log('Hunt response:', JSON.stringify(huntData, null, 2));
  
  return huntData;
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

    console.log(`Sending patent ID ${patentId} to Hunt...`);

    const sql = neon(process.env.DATABASE_URL);
    
    const patents = await sql`
      SELECT id, patent_number, spec_txt_url, drawing_pdf_url
      FROM patents
      WHERE id = ${patentId}
    `;

    if (patents.length === 0) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    const patent = patents[0];

    if (!patent.spec_txt_url || !patent.drawing_pdf_url) {
      return res.status(400).json({ 
        error: 'Patent must be fully processed first (spec and drawings required)' 
      });
    }

    console.log(`Sending ${patent.patent_number} to Hunt (anonymized)...`);
    console.log(`Spec URL: ${patent.spec_txt_url}`);
    console.log(`Drawings URL: ${patent.drawing_pdf_url}`);

    // Send to Hunt with anonymous filenames
    const huntData = await sendToHuntAPI(
      patent.spec_txt_url,
      patent.drawing_pdf_url
    );

    // Update database with Hunt application ID
    await sql`
      UPDATE patents
      SET 
        hunt_application_id = ${huntData.id || null},
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log(`Hunt application created: ${huntData.id || 'unknown'}`);

    return res.status(200).json({
      success: true,
      patentNumber: patent.patent_number,
      huntApplicationId: huntData.id,
      huntResponse: huntData,
    });

  } catch (error) {
    console.error('Error sending to Hunt:', error);
    return res.status(500).json({
      error: 'Failed to send to Hunt',
      details: error.message,
    });
  }
}
