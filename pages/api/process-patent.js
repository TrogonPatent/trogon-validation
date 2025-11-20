import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';
import { PDFDocument } from 'pdf-lib';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

async function extractSpecWithClaude(pdfUrl) {
  console.log('Fetching PDF for Claude...');
  
  // Fetch PDF
  const pdfResponse = await fetch(pdfUrl);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const base64Pdf = Buffer.from(pdfBuffer).toString('base64');
  
  console.log(`PDF fetched: ${pdfBuffer.byteLength} bytes`);

  const prompt = `Extract the specification text from this patent PDF for prior art analysis.

CRITICAL REQUIREMENTS:
1. Remove ALL headers and footers from every page (patent numbers, dates, page numbers, "United States Patent", etc.)
2. Extract these sections ONLY: Abstract, Background, Summary, Detailed Description
3. STOP IMMEDIATELY before "What is claimed" or "Claims" section
4. Output clean plain text with no formatting, no metadata
5. Do not include: Claims, patent metadata, examiner names, filing dates, or any header/footer content

Extract the specification text now:`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function extractDrawings(pdfUrl) {
  console.log('Fetching PDF for drawing extraction...');
  
  // Fetch PDF
  const pdfResponse = await fetch(pdfUrl);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  
  // Load PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  
  console.log(`PDF has ${totalPages} pages`);
  
  // Create new PDF for drawings
  const drawingsPdf = await PDFDocument.create();
  
  // Heuristic: Drawings typically start after first few pages
  const startPage = Math.floor(totalPages * 0.4);
  
  console.log(`Extracting drawing pages from page ${startPage + 1} to ${totalPages}`);
  
  for (let i = startPage; i < totalPages; i++) {
    const [page] = await drawingsPdf.copyPages(pdfDoc, [i]);
    drawingsPdf.addPage(page);
  }
  
  const drawingsPdfBytes = await drawingsPdf.save();
  const drawingPageCount = drawingsPdf.getPageCount();
  
  console.log(`Extracted ${drawingPageCount} drawing pages`);
  
  return {
    pdfBuffer: Buffer.from(drawingsPdfBytes),
    pageCount: drawingPageCount,
  };
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

    console.log(`Processing patent ID: ${patentId}`);

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

    console.log(`Processing patent: ${patent.patent_number}`);
    console.log(`PDF URL: ${patent.raw_pdf_url}`);

    // Step 1: Extract spec text with Claude
    console.log('Extracting specification text with Claude...');
    const specText = await extractSpecWithClaude(patent.raw_pdf_url);
    console.log(`Extracted ${specText.length} characters of spec text`);

    // Upload spec text to blob
    const specBlob = await put(
      `patents/specs/${patent.patent_number}-spec.txt`,
      specText,
      {
        access: 'public',
        contentType: 'text/plain',
      }
    );
    console.log(`Spec uploaded: ${specBlob.url}`);

    // Step 2: Extract drawings
    console.log('Extracting drawings...');
    const { pdfBuffer, pageCount } = await extractDrawings(patent.raw_pdf_url);

    // Upload drawings PDF to blob
    const drawingsBlob = await put(
      `patents/drawings/${patent.patent_number}-drawings.pdf`,
      pdfBuffer,
      {
        access: 'public',
        contentType: 'application/pdf',
      }
    );
    console.log(`Drawings uploaded: ${drawingsBlob.url}`);

    // Update database
    await sql`
      UPDATE patents
      SET 
        spec_txt_url = ${specBlob.url},
        spec_text = ${specText},
        drawing_pdf_url = ${drawingsBlob.url},
        drawing_page_count = ${pageCount},
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log('Database updated successfully');

    return res.status(200).json({
      success: true,
      patentNumber: patent.patent_number,
      specUrl: specBlob.url,
      drawingsUrl: drawingsBlob.url,
      specLength: specText.length,
      drawingPageCount: pageCount,
    });

  } catch (error) {
    console.error('Error processing patent:', error);
    return res.status(500).json({
      error: 'Failed to process patent',
      details: error.message,
    });
  }
}
