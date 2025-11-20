import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { patentId } = req.body;
    if (!patentId) {
      return res.status(400).json({ error: 'Patent ID required' });
    }

    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM patents WHERE id = ${patentId}`;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting patent:', error);
    return res.status(500).json({ error: 'Failed to delete patent', details: error.message });
  }
}
