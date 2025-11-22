import { useState, useEffect } from 'react';

export default function ValidationPage() {
  const [patents, setPatents] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [pageRanges, setPageRanges] = useState({});
  const [processing, setProcessing] = useState({});
  const [editingSpec, setEditingSpec] = useState(null); // patent object being edited
  const [editSpecText, setEditSpecText] = useState('');
  const [savingSpec, setSavingSpec] = useState(false);

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

  async function deletePatent(id, patentNumber) {
    if (!confirm(`Delete ${patentNumber}? This cannot be undone.`)) return;
    try {
      const res = await fetch('/api/delete-patent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patentId: id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      await loadPatents();
    } catch (error) {
      alert('Delete failed: ' + error.message);
    }
  }

  function updatePageRange(id, field, value) {
    setPageRanges(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  }

  async function openSpecEditor(patent) {
    try {
      const res = await fetch(patent.spec_txt_url);
      const text = await res.text();
      setEditSpecText(text);
      setEditingSpec(patent);
    } catch (error) {
      alert('Failed to load spec: ' + error.message);
    }
  }

  async function saveSpec() {
    if (!editingSpec) return;
    setSavingSpec(true);
    try {
      const res = await fetch('/api/update-spec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patentId: editingSpec.id,
          specText: editSpecText,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.details);
      alert('Spec saved!');
      setEditingSpec(null);
      setEditSpecText('');
      await loadPatents();
    } catch (error) {
      alert('Save failed: ' + error.message);
    } finally {
      setSavingSpec(false);
    }
  }
  
  function getStatus(patent) {
    if (patent.hunt_application_id) return '✅ Sent to Hunt';
    if (patent.ground_truth_claims) return '✅ GT Extracted';
    if (patent.drawing_pdf_url) return '✅ Drawings Ready';
    if (patent.spec_txt_url) return '⏳ Need Drawings';
    return '⏳ Pending';
  }

  function generateGTText(patent) {
    const claims = patent.ground_truth_claims?.independent?.join('\n\n') || 'None';
    const primary = patent.ground_truth_cpc?.primary || 'None';
    const all = patent.ground_truth_cpc?.all?.join(', ') || 'None';
    return `PATENT: ${patent.patent_number}\n\nINDEPENDENT CLAIMS:\n${claims}\n\nCPC CODES:\nPrimary: ${primary}\nAll: ${all}`;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>Trogon Validation</h1>
      <p>Upload patents → Process → Select Drawing Pages → Extract GT → Send to Hunt → Compare</p>

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
              <td style={{ fontFamily: 'monospace' }}>
                {patent.raw_pdf_url ? (
                  <a href={patent.raw_pdf_url} target="_blank" rel="noopener noreferrer">
                    {patent.patent_number}
                  </a>
                ) : patent.patent_number}
              </td>
              <td>{getStatus(patent)}</td>
              <td style={{ textAlign: 'center' }}>{patent.total_page_count || '—'}</td>
              <td>
                {patent.spec_txt_url ? (
                  <span style={{ display: 'flex', gap: '8px' }}>
                    <a href={patent.spec_txt_url} target="_blank" rel="noopener noreferrer">View</a>
                    <button
                      onClick={() => openSpecEditor(patent)}
                      style={{ padding: '2px 6px', fontSize: '11px', cursor: 'pointer' }}
                    >
                      ✏️ Edit
                    </button>
                  </span>
                ) : '—'}
              </td>
              <td>
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
                ) : '—'}
              </td>
              <td>
                {patent.ground_truth_claims ? (
                  <a
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(generateGTText(patent))}`}
                    download={`${patent.patent_number}-GT.txt`}
                    style={{ fontSize: '12px' }}
                  >
                    View GT
                  </a>
                ) : '—'}
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: '10px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {patent.hunt_application_id || '—'}
              </td>
              <td>
                {!patent.spec_txt_url && (
                  <button 
                    onClick={() => processPatent(patent.id)}
                    disabled={processing[patent.id]}
                    style={{ padding: '4px 8px' }}
                  >
                    {processing[patent.id] ? '⏳' : '⚙️ Process'}
                  </button>
                )}
                {patent.drawing_pdf_url && !patent.ground_truth_claims && (
                  <button 
                    onClick={() => extractGroundTruth(patent.id)}
                    disabled={processing[patent.id]}
                    style={{ padding: '4px 8px' }}
                  >
                    {processing[patent.id] ? '⏳' : '📋 Extract GT'}
                  </button>
                )}
                {patent.ground_truth_claims && !patent.hunt_application_id && (
                  <button 
                    onClick={() => sendToHunt(patent.id)}
                    disabled={processing[patent.id]}
                    style={{ padding: '4px 8px' }}
                  >
                    {processing[patent.id] ? '⏳' : '→ Hunt'}
                  </button>
                )}
                <button 
                  onClick={() => deletePatent(patent.id, patent.patent_number)}
                  style={{ padding: '4px 8px', marginLeft: '4px', color: '#c00' }}
                  title="Delete"
                >
                  🗑️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', fontSize: '13px' }}>
        <strong>Workflow:</strong>
        <ol style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li><strong>Process</strong> - Extracts spec text (no claims), shows total page count</li>
          <li><strong>Select Drawing Pages</strong> - Enter page range, click ✂️ to extract with headers cropped</li>
          <li><strong>Extract GT</strong> - Parses independent claims and CPC codes from original PDF</li>
          <li><strong>Send to Hunt</strong> - Uploads spec.txt + drawings.pdf with anonymous filenames</li>
        </ol>
        <p style={{ margin: 0, color: '#666' }}>
          <strong>Note:</strong> Headers are cropped (~0.76 inches from top) to remove patent numbers from drawings.
        </p>
      </div>
         {editingSpec && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '900px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Edit Spec: {editingSpec.patent_number}</h2>
              <button
                onClick={() => { setEditingSpec(null); setEditSpecText(''); }}
                style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            <textarea
              value={editSpecText}
              onChange={(e) => setEditSpecText(e.target.value)}
              style={{
                flex: 1,
                margin: '16px',
                padding: '12px',
                fontFamily: 'monospace',
                fontSize: '13px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                resize: 'none',
                minHeight: '400px'
              }}
            />
            <div style={{ padding: '16px', borderTop: '1px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: '13px' }}>{editSpecText.length.toLocaleString()} characters</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { setEditingSpec(null); setEditSpecText(''); }}
                  style={{ padding: '8px 16px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveSpec}
                  disabled={savingSpec}
                  style={{ padding: '8px 16px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {savingSpec ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}   
    </div>
  );
}
