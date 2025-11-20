import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'Invalid Content-Type' });
    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const parts = rawBody.toString('binary').split(`--${boundary}`);

    let fileBuffer = null;
    let filename = '';
    let mimetype = 'application/pdf';

    // Find the file part
    for (const part of parts) {
      if (!part || part === '--\r\n' || part === '--') continue;

      const headerEndIndex = part.indexOf('\r\n\r\n');
      if (headerEndIndex === -1) continue;

      const headers = part.substring(0, headerEndIndex);
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      
      if (filenameMatch) {
        filename = filenameMatch[1];
        const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/);
        if (mimeMatch) mimetype = mimeMatch[1].trim();

        const content = part.substring(headerEndIndex + 4);
        const fileContent = content.substring(0, content.lastIndexOf('\r\n'));
        fileBuffer = Buffer.from(fileContent, 'binary');
        break;
      }
    }

    if (!fileBuffer || !filename) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Extract patent number from filename (e.g., US11900100.pdf -> US11900100)
    const patentNumber = filename.replace(/\.(pdf|PDF)$/, '');

    console.log(`Uploading ${filename} (${fileBuffer.length} bytes) as ground truth...`);

    // Upload to Vercel Blob
    const blob = await put(`patents/raw/${filename}`, fileBuffer, {
      access: 'public',
      contentType: mimetype,
    });

    console.log(`Uploaded to blob: ${blob.url}`);

    // Create database record
    const sql = neon(process.env.DATABASE_URL);
    
    const result = await sql`
      INSERT INTO patents (
        patent_number,
        raw_pdf_url,
        created_at
      ) VALUES (
        ${patentNumber},
        ${blob.url},
        NOW()
      )
      RETURNING id, patent_number, raw_pdf_url
    `;

    const patent = result[0];

    console.log(`Created patent record: ${patent.id}`);

    return res.status(200).json({
      success: true,
      patent: {
        id: patent.id,
        patentNumber: patent.patent_number,
        rawPdfUrl: patent.raw_pdf_url,
      },
    });

  } catch (error) {
    console.error('Error uploading ground truth:', error);
    return res.status(500).json({
      error: 'Failed to upload ground truth',
      details: error.message,
    });
  }
}
