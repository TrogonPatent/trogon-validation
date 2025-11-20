import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    
    const patents = await sql`
      SELECT 
        id,
        patent_number,
        raw_pdf_url,
        spec_txt_url,
        drawing_pdf_url,
        ground_truth_claims,
        ground_truth_cpc,
        hunt_application_id,
        hunt_predicted_cpc,
        hunt_extracted_pods,
        created_at,
        processed_at
      FROM patents
      ORDER BY created_at DESC
    `;

    return res.status(200).json({ 
      success: true, 
      patents 
    });
    
  } catch (error) {
    console.error('Error fetching patents:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch patents',
      details: error.message 
    });
  }
}
