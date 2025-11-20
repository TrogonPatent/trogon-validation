import { useState, useEffect } from 'react';

export default function ValidationPage() {
  const [patents, setPatents] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);

  // Load patents on mount
  useEffect(() => {
    loadPatents();
  }, []);

  async function loadPatents() {
    try {
      const res = await fetch('/api/get-patents');
      const data = await res.json();
      setPatents(data.patents || []);
    } catch (error) {
      console.error('Error loading patents:', error);
    }
  }

  async function handleUpload() {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    try {
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);

        await fetch('/api/upload-ground-truth', {
          method: 'POST',
          body: formData,
        });
      }

      alert(`Uploaded ${selectedFiles.length} file(s)`);
      setSelectedFiles([]);
      await loadPatents();
    } catch (error) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  }

  async function processPatent(id) {
    if (!confirm('Process this patent? This will extract spec and drawings.')) return;

    try {
      const res = await fetch('/api/process-patent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      alert('Processing complete!');
      await loadPatents();
    } catch (error) {
      alert('Processing failed: ' + error.message);
    }
  }

  async function extractGroundTruth(id) {
    if (!confirm('Extract ground truth? This will get claims and CPC codes.')) return;

    try {
      const res = await fetch('/api/extract-ground-truth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      alert('Ground truth extracted!');
      await loadPatents();
    } catch (error) {
      alert('Extraction failed: ' + error.message);
    }
  }

  async function sendToHunt(id) {
    if (!confirm('Send to Hunt for processing?')) return;

    try {
      const res = await fetch('/api/send-to-hunt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      alert('Sent to Hunt! Application ID: ' + data.huntApplicationId);
      await loadPatents();
    } catch (error) {
      alert('Send to Hunt failed: ' + error.message);
    }
  }

  function viewGroundTruth(patent) {
    const gt = patent.ground_truth_claims || {};
    const cpc = patent.ground_truth_cpc || {};
    
    const text = `
PATENT: ${patent.patent_number}

INDEPENDENT CLAIMS:
${gt.independent?.join('\n\n') || 'Not extracted yet'}

CPC CODES:
Primary: ${cpc.primary || 'Not extracted yet'}
All: ${cpc.all?.join(', ') || 'Not extracted yet'}
    `.trim();

    alert(text);
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Trogon Validation</h1>
      <p>Upload patents → Process → Extract GT → Send to Hunt → Compare</p>

      {/* Upload Area */}
      <div style={{ border: '2px dashed #ccc', padding: '20px', marginBottom: '20px' }}>
        <input
          type="file"
          multiple
          accept=".pdf"
          onChange={(e) => setSelectedFiles(Array.from(e.target.files))}
        />
        <button 
          onClick={handleUpload} 
          disabled={uploading || selectedFiles.length === 0}
          style={{ marginLeft: '10px', padding: '8px 16px' }}
        >
          {uploading ? 'Uploading...' : `Upload ${selectedFiles.length} file(s)`}
        </button>
      </div>

      {/* Patents Table */}
      <table border="1" cellPadding="10" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Patent Number</th>
            <th>Status</th>
            <th>Spec</th>
            <th>Drawings</th>
            <th>GT</th>
            <th>Hunt ID</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {patents.length === 0 && (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                No patents uploaded yet
              </td>
            </tr>
          )}
          {patents.map((patent) => (
            <tr key={patent.id}>
              <td>{patent.patent_number}</td>
              <td>
                {patent.spec_txt_url && patent.drawing_pdf_url ? '✅ Processed' : '⏳ Pending'}
              </td>
              <td>
                {patent.spec_txt_url ? (
                  <a href={patent.spec_txt_url} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {patent.drawing_pdf_url ? (
                  <a href={patent.drawing_pdf_url} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {patent.ground_truth_claims ? (
                  <button onClick={() => viewGroundTruth(patent)}>View GT</button>
                ) : (
                  '—'
                )}
              </td>
              <td>{patent.hunt_application_id || '—'}</td>
              <td>
                {!patent.spec_txt_url && (
                  <button onClick={() => processPatent(patent.id)}>⚙️ Process</button>
                )}
                {patent.spec_txt_url && !patent.ground_truth_claims && (
                  <button onClick={() => extractGroundTruth(patent.id)}>📋 Extract GT</button>
                )}
                {patent.ground_truth_claims && !patent.hunt_application_id && (
                  <button onClick={() => sendToHunt(patent.id)}>→ Hunt</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
