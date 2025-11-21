import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';
import { PDFDocument } from 'pdf-lib';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 60,
};

const HEADER_CROP_POINTS = 72;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { patentId, startPage, endPage } = req.body;

    if (!patentId || !startPage || !endPage) {
      return res.status(400).json({ error: 'Patent ID and page range required' });
    }

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
    console.log(`Extracting drawings for ${patent.patent_number}, pages ${startPage}-${endPage}`);

    // Fetch PDF
    const pdfResponse = await fetch(patent.raw_pdf_url);
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();

    // Validate range
    const start = Math.max(0, startPage - 1);
    const end = Math.min(totalPages - 1, endPage - 1);

    if (start > end || start >= totalPages) {
      return res.status(400).json({ 
        error: `Invalid page range: ${startPage}-${endPage} (PDF has ${totalPages} pages)` 
      });
    }

    // Extract pages with header cropping
    const drawingsPdf = await PDFDocument.create();

    for (let i = start; i <= end; i++) {
      const [page] = await drawingsPdf.copyPages(pdfDoc, [i]);
      const { width, height } = page.getSize();
      page.setCropBox(0, 0, width, height - HEADER_CROP_POINTS);
      drawingsPdf.addPage(page);
    }

    const drawingsPdfBytes = await drawingsPdf.save();
    const drawingPageCount = drawingsPdf.getPageCount();

    // Upload to blob
    const drawingsBlob = await put(
      `patents/drawings/${patent.patent_number}-drawings.pdf`,
      Buffer.from(drawingsPdfBytes),
      {
        access: 'public',
        contentType: 'application/pdf',
      }
    );

    // Update database
    await sql`
      UPDATE patents
      SET 
        drawing_pdf_url = ${drawingsBlob.url},
        drawing_page_count = ${drawingPageCount},
        drawing_start_page = ${startPage},
        drawing_end_page = ${endPage},
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log(`Drawings extracted: ${drawingPageCount} pages, headers cropped`);

    return res.status(200).json({
      success: true,
      patentNumber: patent.patent_number,
      drawingsUrl: drawingsBlob.url,
      drawingPageCount: drawingPageCount,
    });

  } catch (error) {
    console.error('Error extracting drawings:', error);
    return res.status(500).json({
      error: 'Failed to extract drawings',
      details: error.message,
    });
  }
}
