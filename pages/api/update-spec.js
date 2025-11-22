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
