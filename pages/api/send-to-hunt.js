import { neon } from '@neondatabase/serverless';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 300,
};

async function sendToHuntAPI(specUrl, drawingsUrl) {
  console.log('Fetching spec and drawings files...');
  
  const specResponse = await fetch(specUrl);
  const specText = await specResponse.text();
  
  const drawingsResponse = await fetch(drawingsUrl);
  const drawingsBuffer = await drawingsResponse.arrayBuffer();
  
  console.log(`Spec size: ${specText.length} chars`);
  console.log(`Drawings size: ${drawingsBuffer.byteLength} bytes`);
  
  // Create multipart form data with ANONYMOUS filenames
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
  
  // STEP 1: Upload to Hunt
  console.log('Step 1: Uploading to Hunt...');
  const uploadResponse = await fetch('https://monitoring.trogonpatent.ai/api/upload-provisional', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Hunt upload error: ${uploadResponse.status} - ${errorText}`);
  }
  
  const uploadData = await uploadResponse.json();
  console.log('Upload response:', JSON.stringify(uploadData, null, 2));
  
  const applicationId = uploadData.id;
  if (!applicationId) {
    throw new Error('No application ID returned from Hunt');
  }
  
// STEP 2: Classify (extract PODs and predict CPC)
  console.log('Step 2: Classifying...');
  const classifyResponse = await fetch('https://monitoring.trogonpatent.ai/api/classify-provisional', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      applicationId,
      specText: uploadData.extractedText || specText,
      title: uploadData.title || 'Untitled Application'
    }),
  });
  
  if (!classifyResponse.ok) {
    const errorText = await classifyResponse.text();
    console.error(`Classify error: ${classifyResponse.status} - ${errorText}`);
    // Don't throw - upload succeeded, classification failed
}
  
  let classifyData = null;
  if (classifyResponse.ok) {
    classifyData = await classifyResponse.json();
    console.log('Classify response:', JSON.stringify(classifyData, null, 2));
  }
  
// STEP 3: Save to Hunt database
  console.log('Step 3: Saving...');
  
  // Transform PODs from classify response to save format
  const approvedPods = classifyData?.pods?.map(pod => ({
    text: pod.pod_text,
    rationale: pod.rationale,
    isPrimary: pod.is_primary,
    suggested: true
  })) || [];
  
  const saveResponse = await fetch('https://monitoring.trogonpatent.ai/api/save-provisional', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      applicationId,
      title: uploadData.title,
      cpcPredictions: classifyData?.cpcPredictions || [],
      primaryCpc: classifyData?.primaryCpc,
      technologyArea: classifyData?.technologyArea,
      approvedPods
    }),
  });
  
  if (!saveResponse.ok) {
    const errorText = await saveResponse.text();
    console.error(`Save error: ${saveResponse.status} - ${errorText}`);
  } else {
    const saveData = await saveResponse.json();
    console.log('Save response:', JSON.stringify(saveData, null, 2));
  }
  
  return { id: applicationId, classifyData, ...uploadData };
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

    const huntData = await sendToHuntAPI(
      patent.spec_txt_url,
      patent.drawing_pdf_url
    );

// Extract PODs and CPC from classify response
    const huntPods = huntData.classifyData?.pods?.map(pod => ({
      text: pod.pod_text,
      rationale: pod.rationale,
      isPrimary: pod.is_primary
    })) || [];
    
    const huntCpc = {
      primary: huntData.classifyData?.primaryCpc || null,
      all: huntData.classifyData?.cpcPredictions?.map(p => p.code) || []
    };

    await sql`
      UPDATE patents
      SET 
        hunt_application_id = ${huntData.id || null},
        hunt_predicted_cpc = ${JSON.stringify(huntCpc)},
        hunt_extracted_pods = ${JSON.stringify(huntPods)},
        updated_at = NOW()
      WHERE id = ${patentId}
    `;

    console.log(`Hunt application created: ${huntData.id}`);

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
