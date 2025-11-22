import { put } from '@vercel/blob';
import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { patentId, specText } = req.body;

    if (!patentId || !specText) {
      return res.status(400).json({ error: 'Patent ID and spec text required' });
    }

    const sql = neon(process.env.DATABASE_URL);

    // Get patent info
    const patents = await sql`
      SELECT id, patent_number, spec_txt_url
      FROM patents
      WHERE id = ${patentId}
    `;

    if (patents.length === 0) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    const patent = patents[0];

    // Upload new spec to blob (overwrites by using same path pattern)
    const blob = await put(
      `patents/specs/${patent.patent_number}-spec.txt`,
      specText,
      {
        access: 'public',
        contentType: 'text/plain',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }
    );

    // Update database with new URL
    await sql`
      UPDATE patents
      SET 
        spec_txt_url = ${blob.url},
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log(`Spec updated for ${patent.patent_number}: ${specText.length} chars`);

    return res.status(200).json({
      success: true,
      patentNumber: patent.patent_number,
      specUrl: blob.url,
      charCount: specText.length,
    });

  } catch (error) {
    console.error('Error updating spec:', error);
    return res.status(500).json({
      error: 'Failed to update spec',
      details: error.message,
    });
  }
}
