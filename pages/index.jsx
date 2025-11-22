import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const ValidationPage = dynamic(() => import('../components/ValidationPage'), {
  ssr: false,
});

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('validation_auth');
    if (stored === 'true') setAuthenticated(true);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (passcode === 'TrogonHunt2024!') {
      sessionStorage.setItem('validation_auth', 'true');
      setAuthenticated(true);
      setError('');
    } else {
      setError('Invalid passcode');
    }
  }

  if (authenticated) {
    return <ValidationPage />;
  }

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      fontFamily: 'system-ui',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        width: '320px'
      }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Trogon Validation</h1>
        <p style={{ margin: '0 0 24px 0', color: '#666', fontSize: '14px' }}>Enter passcode to continue</p>
        <form onSubmit={handleSubmit}>
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              style={{
                width: '100%',
                padding: '12px',
                paddingRight: '44px',
                fontSize: '16px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxSizing: 'border-box'
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '4px'
              }}
              title={showPassword ? 'Hide' : 'Show'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
          {error && <p style={{ color: '#c00', margin: '0 0 12px 0', fontSize: '14px' }}>{error}</p>}
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
