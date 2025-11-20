import { useState, useEffect } from 'react';

export default function ValidationPage() {
  const [patents, setPatents] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [pageRanges, setPageRanges] = useState({}); // { patentId: { start: '', end: '' } }
  const [processing, setProcessing] = useState({}); // { patentId: true/false }

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
    if (!confirm('Process this patent? This will extract the specification text.')) return;

    setProcessing(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch('/api/process-patent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.details);

      alert(`Spec extracted! PDF has ${data.totalPages} pages. Now select drawing pages.`);
      await loadPatents();
    } catch (error) {
      alert('Processing failed: ' + error.message);
    } finally {
      setProcessing(prev => ({ ...prev, [id]: false }));
    }
  }

  async function extractDrawings(id) {
    const range = pageRanges[id];
    if (!range?.start || !range?.end) {
      alert('Please enter start and end page numbers for drawings');
      return;
    }

    const start = parseInt(range.start, 10);
    const end = parseInt(range.end, 10);

    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
      alert('Invalid page range. Start must be >= 1 and end must be >= start.');
      return;
    }

    if (!confirm(`Extract drawing pages ${start}-${end}? Headers will be cropped.`)) return;

    setProcessing(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch('/api/extract-drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id, startPage: start, endPage: end }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.details);

      alert(`Drawings extracted: ${data.drawingPageCount} pages (headers cropped)`);
      await loadPatents();
    } catch (error) {
      alert('Drawing extraction failed: ' + error.message);
    } finally {
      setProcessing(prev => ({ ...prev, [id]: false }));
    }
  }

  async function extractGroundTruth(id) {
    if (!confirm('Extract ground truth? This will get claims and CPC codes.')) return;

    setProcessing(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch('/api/extract-ground-truth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.details);

      alert('Ground truth extracted!');
      await loadPatents();
    } catch (error) {
      alert('Extraction failed: ' + error.message);
    } finally {
      setProcessing(prev => ({ ...prev, [id]: false }));
    }
  }

  async function sendToHunt(id) {
    if (!confirm('Send to Hunt for processing? Files will be sent with anonymous names.')) return;

    setProcessing(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch('/api/send-to-hunt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.details);

      alert('Sent to Hunt! Application ID: ' + data.huntApplicationId);
      await loadPatents();
    } catch (error) {
      alert('Send to Hunt failed: ' + error.message);
    } finally {
      setProcessing(prev => ({ ...prev, [id]: false }));
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

  function updatePageRange(id, field, value) {
    setPageRanges(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  }

  function getStatus(patent) {
    if (patent.hunt_application_id) return '✅ Sent to Hunt';
    if (patent.ground_truth_claims) return '✅ GT Extracted';
    if (patent.drawing_pdf_url) return '✅ Drawings Ready';
    if (patent.spec_txt_url) return '⏳ Need Drawings';
    return '⏳ Pending';
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>Trogon Validation</h1>
      <p>Upload patents → Process → Select Drawing Pages → Extract GT → Send to Hunt → Compare</p>

      {/* Upload Area */}
      <div style={{ border: '2px dashed #ccc', padding: '20px', marginBottom: '20px', borderRadius: '8px' }}>
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
      <table border="1" cellPadding="8" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead style={{ backgroundColor: '#f5f5f5' }}>
          <tr>
            <th>Patent Number</th>
            <th>Status</th>
            <th>Pages</th>
            <th>Spec</th>
            <th>Drawing Pages</th>
            <th>Drawings</th>
            <th>GT</th>
            <th>Hunt ID</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {patents.length === 0 && (
            <tr>
              <td colSpan="9" style={{ textAlign: 'center', padding: '40px' }}>
                No patents uploaded yet
              </td>
            </tr>
          )}
          {patents.map((patent) => (
            <tr key={patent.id}>
              <td style={{ fontFamily: 'monospace' }}>{patent.patent_number}</td>
              <td>{getStatus(patent)}</td>
              <td style={{ textAlign: 'center' }}>
                {patent.total_page_count || '—'}
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
                {/* Page range inputs */}
                {patent.spec_txt_url && !patent.drawing_pdf_url && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="number"
                      min="1"
                      placeholder="Start"
                      value={pageRanges[patent.id]?.start || ''}
                      onChange={(e) => updatePageRange(patent.id, 'start', e.target.value)}
                      style={{ width: '50px', padding: '4px' }}
                    />
                    <span>-</span>
                    <input
                      type="number"
                      min="1"
                      placeholder="End"
                      value={pageRanges[patent.id]?.end || ''}
                      onChange={(e) => updatePageRange(patent.id, 'end', e.target.value)}
                      style={{ width: '50px', padding: '4px' }}
                    />
                    <button
                      onClick={() => extractDrawings(patent.id)}
                      disabled={processing[patent.id]}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      {processing[patent.id] ? '...' : '✂️'}
                    </button>
                  </div>
                )}
                {patent.drawing_pdf_url && (
                  <span style={{ color: '#666', fontSize: '12px' }}>
                    {patent.drawing_start_page || '?'}-{patent.drawing_end_page || '?'}
                  </span>
                )}
                {!patent.spec_txt_url && '—'}
              </td>
              <td>
                {patent.drawing_pdf_url ? (
                  <a href={patent.drawing_pdf_url} target="_blank" rel="noopener noreferrer">
                    View ({patent.drawing_page_count || '?'})
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {patent.ground_truth_claims ? (
                  <button onClick={() => viewGroundTruth(patent)} style={{ fontSize: '12px' }}>
                    View GT
                  </button>
                ) : (
                  '—'
                )}
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: '10px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {patent.hunt_application_id || '—'}
              </td>
              <td>
                {/* Step 1: Process (extract spec) */}
                {!patent.spec_txt_url && (
                  <button 
                    onClick={() => processPatent(patent.id)}
                    disabled={processing[patent.id]}
                    style={{ padding: '4px 8px' }}
                  >
                    {processing[patent.id] ? '⏳' : '⚙️ Process'}
                  </button>
                )}
                
                {/* Step 2: Extract GT (after drawings ready) */}
                {patent.drawing_pdf_url && !patent.ground_truth_claims && (
                  <button 
                    onClick={() => extractGroundTruth(patent.id)}
                    disabled={processing[patent.id]}
                    style={{ padding: '4px 8px' }}
                  >
                    {processing[patent.id] ? '⏳' : '📋 Extract GT'}
                  </button>
                )}
                
                {/* Step 3: Send to Hunt */}
                {patent.ground_truth_claims && !patent.hunt_application_id && (
                  <button 
                    onClick={() => sendToHunt(patent.id)}
                    disabled={processing[patent.id]}
                    style={{ padding: '4px 8px' }}
                  >
                    {processing[patent.id] ? '⏳' : '→ Hunt'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Legend */}
      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', fontSize: '13px' }}>
        <strong>Workflow:</strong>
        <ol style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li><strong>Process</strong> - Extracts spec text (no claims), shows total page count</li>
          <li><strong>Select Drawing Pages</strong> - Enter page range (e.g., 2-5), click ✂️ to extract with headers cropped</li>
          <li><strong>Extract GT</strong> - Parses independent claims and CPC codes from original PDF</li>
          <li><strong>Send to Hunt</strong> - Uploads spec.txt + drawings.pdf with anonymous filenames</li>
        </ol>
        <p style={{ margin: 0, color: '#666' }}>
          <strong>Note:</strong> Headers are cropped (~0.76 inches from top) to remove patent numbers from drawings.
        </p>
      </div>
    </div>
  );
}
