import React, { useState } from 'react';
import { Lock, User, ShieldCheck } from 'lucide-react';

export default function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    
    // Fetch users or create the default master admin if none exist
    const savedUsers = JSON.parse(localStorage.getItem('erp_users')) || [
      { id: 'master', username: 'admin', password: 'password123', role: 'Admin', permissions: ['Dashboard', 'Daily Sales', 'Purchases & Expenses', 'Receipts & Payments', 'Cash & Bank Books', 'Delivery Settlements', 'Reports', 'System Setup'] }
    ];

    const validUser = savedUsers.find(
      u => u.username.toLowerCase() === username.toLowerCase() && u.password === password
    );

    if (validUser) {
      sessionStorage.setItem('erp_session_active', 'true');
      sessionStorage.setItem('erp_current_user', validUser.username);
      sessionStorage.setItem('erp_current_role', validUser.role);
      sessionStorage.setItem('erp_user_permissions', JSON.stringify(validUser.permissions || []));
      onLoginSuccess(validUser);
    } else {
      setError('Invalid Username or Password');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', fontFamily: '"Inter", sans-serif' }}>
      <div style={{ background: '#ffffff', padding: '40px', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)', width: '100%', maxWidth: '400px' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#eff6ff', padding: '16px', borderRadius: '50%', marginBottom: '16px' }}>
            <ShieldCheck size={32} color="#2563eb" />
          </div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>Naanstaap ERP</h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#64748b', fontWeight: '500' }}>Operations & Finance Portal</p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', textAlign: 'center', marginBottom: '20px', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: '8px' }}>Username</label>
            <div style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0 12px' }}>
              <User size={18} color="#94a3b8" />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ border: 'none', background: 'transparent', padding: '12px', width: '100%', outline: 'none', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}
                placeholder="Enter your username"
                required
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', marginBottom: '8px' }}>Password</label>
            <div style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0 12px' }}>
              <Lock size={18} color="#94a3b8" />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ border: 'none', background: 'transparent', padding: '12px', width: '100%', outline: 'none', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button type="submit" style={{ marginTop: '10px', background: '#2563eb', color: '#ffffff', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '15px', fontWeight: '800', cursor: 'pointer', transition: 'background 0.2s', width: '100%' }}>
            Secure Login
          </button>
        </form>
      </div>
    </div>
  );
}