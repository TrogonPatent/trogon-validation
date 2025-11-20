import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';
import { PDFDocument } from 'pdf-lib';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

// Crop amount from top of page (in points, 72 points = 1 inch)
// 55 points ≈ 0.76 inches - covers standard USPTO header
const HEADER_CROP_POINTS = 55;

async function extractSpecWithClaude(pdfUrl, retries = 3) {
  console.log('Fetching PDF for Claude...');
  
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

      if (response.ok) {
        const data = await response.json();
        console.log('Claude API success!');
        return data.content[0].text;
      }

      const shouldRetry = response.headers.get('x-should-retry') === 'true';
      const status = response.status;
      
      if (shouldRetry && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Claude overloaded (${status}), retrying in ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      const error = await response.text();
      throw new Error(`Claude API error (${status}): ${error}`);
      
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`Error on attempt ${attempt}, retrying in ${waitTime/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

async function getPdfPageCount(pdfUrl) {
  const pdfResponse = await fetch(pdfUrl);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  return pdfDoc.getPageCount();
}

async function extractDrawings(pdfUrl, startPage, endPage) {
  console.log('Fetching PDF for drawing extraction...');
  
  const pdfResponse = await fetch(pdfUrl);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  
  console.log(`PDF has ${totalPages} pages`);
  
  // Validate page range (user provides 1-indexed pages)
  const start = Math.max(0, startPage - 1);
  const end = Math.min(totalPages - 1, endPage - 1);
  
  if (start > end || start >= totalPages) {
    throw new Error(`Invalid page range: ${startPage}-${endPage} (PDF has ${totalPages} pages)`);
  }
  
  console.log(`Extracting pages ${startPage} to ${endPage} (0-indexed: ${start} to ${end})`);
  
  const drawingsPdf = await PDFDocument.create();
  
  for (let i = start; i <= end; i++) {
    const [page] = await drawingsPdf.copyPages(pdfDoc, [i]);
    
    // Crop header from top of page
    const { width, height } = page.getSize();
    
    // CropBox excludes the top header area (USPTO patent number, date, sheet info)
    page.setCropBox(0, 0, width, height - HEADER_CROP_POINTS);
    
    drawingsPdf.addPage(page);
  }
  
  const drawingsPdfBytes = await drawingsPdf.save();
  const drawingPageCount = drawingsPdf.getPageCount();
  
  console.log(`Extracted ${drawingPageCount} drawing pages with headers cropped (${HEADER_CROP_POINTS}pt from top)`);
  
  return {
    pdfBuffer: Buffer.from(drawingsPdfBytes),
    pageCount: drawingPageCount,
    totalPages: totalPages,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { patentId, drawingStartPage, drawingEndPage } = req.body;

    if (!patentId) {
      return res.status(400).json({ error: 'Patent ID required' });
    }

    console.log(`Processing patent ID: ${patentId}`);

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

    // Get total page count first
    const totalPages = await getPdfPageCount(patent.raw_pdf_url);
    console.log(`Total pages in PDF: ${totalPages}`);

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

    // Step 2: Extract drawings only if page range provided
    let drawingsBlob = null;
    let pageCount = 0;
    
    if (drawingStartPage && drawingEndPage) {
      console.log(`Extracting drawings from pages ${drawingStartPage}-${drawingEndPage}...`);
      const drawingsResult = await extractDrawings(
        patent.raw_pdf_url, 
        drawingStartPage, 
        drawingEndPage
      );
      
      drawingsBlob = await put(
        `patents/drawings/${patent.patent_number}-drawings.pdf`,
        drawingsResult.pdfBuffer,
        {
          access: 'public',
          contentType: 'application/pdf',
        }
      );
      pageCount = drawingsResult.pageCount;
      console.log(`Drawings uploaded: ${drawingsBlob.url}`);
    } else {
      console.log('No drawing page range specified - drawings need separate extraction');
    }

    // Update database
    await sql`
      UPDATE patents
      SET 
        spec_txt_url = ${specBlob.url},
        spec_text = ${specText},
        drawing_pdf_url = ${drawingsBlob?.url || null},
        drawing_page_count = ${pageCount},
        total_page_count = ${totalPages},
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log('Database updated successfully');

    return res.status(200).json({
      success: true,
      patentNumber: patent.patent_number,
      specUrl: specBlob.url,
      drawingsUrl: drawingsBlob?.url || null,
      specLength: specText.length,
      drawingPageCount: pageCount,
      totalPages: totalPages,
      needsDrawingSelection: !drawingsBlob,
    });

  } catch (error) {
    console.error('Error processing patent:', error);
    return res.status(500).json({
      error: 'Failed to process patent',
      details: error.message,
    });
  }
}
