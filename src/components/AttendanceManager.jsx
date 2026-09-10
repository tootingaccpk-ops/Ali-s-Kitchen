import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, getDocs, updateDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db as firebaseDb } from '../firebase'; // Adjust path if necessary
import { Camera, CheckCircle, Clock, Edit2, User, Image as ImageIcon } from 'lucide-react';

// Default dummy employees if none exist in your database yet
const DEFAULT_EMPLOYEES = [
  { id: '1', name: 'Hasnain', pin: '1234' },
  { id: '2', name: 'Ali', pin: '5678' },
  { id: '3', name: 'Chef A', pin: '0000' }
];

const theme = {
  bg: '#f8fafc', cardBg: '#ffffff', primary: '#0369a1', success: '#166534', danger: '#dc2626',
  border: '#cbd5e1', textMain: '#0f172a', textMuted: '#64748b'
};

const getTodayDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function AttendanceManager({ isKioskMode = false, employeesDb = DEFAULT_EMPLOYEES }) {
  const [activeTab, setActiveTab] = useState(isKioskMode ? 'kiosk' : 'admin');

  // --- KIOSK STATE ---
  const [selectedEmp, setSelectedEmp] = useState('');
  const [pin, setPin] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [kioskMessage, setKioskMessage] = useState({ text: '', type: '' });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // --- ADMIN STATE ---
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [filterDate, setFilterDate] = useState(getTodayDateStr());
  const [editingLog, setEditingLog] = useState(null);
  const [viewPhoto, setViewPhoto] = useState(null);

  // Initialize Camera for Kiosk
  useEffect(() => {
    if (activeTab === 'kiosk') {
      startCamera();
    } else {
      stopCamera();
      if (activeTab === 'admin') fetchLogs();
    }
    return () => stopCamera();
  }, [activeTab, filterDate]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "user", width: 320, height: 240 } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.error("Camera access denied or unavailable.", err);
      setKioskMessage({ text: 'Camera access is required for verification.', type: 'error' });
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      setCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const context = canvasRef.current.getContext('2d');
    context.drawImage(videoRef.current, 0, 0, 320, 240);
    // Compress heavily to save Firebase storage space
    return canvasRef.current.toDataURL('image/jpeg', 0.5); 
  };

  const handlePunch = async (punchType) => {
    if (!selectedEmp || !pin) {
      setKioskMessage({ text: 'Select your name and enter PIN.', type: 'error' });
      return;
    }

    const employee = employeesDb.find(e => e.id === selectedEmp);
    if (employee.pin !== pin) {
      setKioskMessage({ text: 'Incorrect PIN. Try again.', type: 'error' });
      setPin('');
      return;
    }

    const photoBase64 = capturePhoto();
    if (!photoBase64) {
      setKioskMessage({ text: 'Failed to capture photo. Ensure camera is active.', type: 'error' });
      return;
    }

    const now = new Date();
    const logData = {
      employeeId: employee.id,
      employeeName: employee.name,
      punchType: punchType, // 'IN' or 'OUT'
      timestamp: now.toISOString(),
      dateStr: getTodayDateStr(),
      photo: photoBase64,
      editedByAdmin: false
    };

    try {
      await addDoc(collection(firebaseDb, "erp_attendance"), logData);
      setKioskMessage({ text: `✅ Successfully checked ${punchType} at ${now.toLocaleTimeString()}`, type: 'success' });
      setSelectedEmp('');
      setPin('');
      setTimeout(() => setKioskMessage({ text: '', type: '' }), 4000);
    } catch (error) {
      console.error("Firebase Error: ", error);
      setKioskMessage({ text: 'Database connection error.', type: 'error' });
    }
  };

  const fetchLogs = async () => {
    try {
      const q = query(collection(firebaseDb, "erp_attendance"), where("dateStr", "==", filterDate));
      const querySnapshot = await getDocs(q);
      const logs = [];
      querySnapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() }));
      
      // Sort chronologically
      logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setAttendanceLogs(logs);
    } catch (error) {
      console.error("Error fetching logs: ", error);
    }
  };

  const handleAdminEdit = async (e) => {
    e.preventDefault();
    try {
      const logRef = doc(firebaseDb, "erp_attendance", editingLog.id);
      await updateDoc(logRef, {
        timestamp: editingLog.newTimestamp,
        editedByAdmin: true
      });
      setEditingLog(null);
      fetchLogs();
    } catch (error) {
      console.error("Edit failed:", error);
    }
  };

  // --- UI COMPONENTS ---

  const KioskView = () => (
    <div style={{ maxWidth: '400px', margin: '0 auto', background: theme.cardBg, borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 20px 0', fontSize: '22px', fontWeight: '900', color: theme.primary }}>Ali's Kitchen Time Clock</h2>
      
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} width="320" height="240" style={{ display: 'none' }}></canvas>
      
      <div style={{ width: '100%', height: '240px', background: '#e2e8f0', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px', position: 'relative' }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }}></video>
        {!cameraActive && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: theme.textMuted }}><Camera size={48} /></div>}
      </div>

      {kioskMessage.text && (
        <div style={{ padding: '12px', marginBottom: '20px', borderRadius: '6px', background: kioskMessage.type === 'error' ? '#fef2f2' : '#f0fdf4', color: kioskMessage.type === 'error' ? theme.danger : theme.success, fontWeight: '700', fontSize: '14px' }}>
          {kioskMessage.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <select value={selectedEmp} onChange={(e) => setSelectedEmp(e.target.value)} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, outline: 'none', background: '#fff' }}>
          <option value="">Select Employee...</option>
          {employeesDb.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>

        <input 
          type="password" 
          placeholder="Enter 4-Digit PIN" 
          value={pin} 
          readOnly // Use on-screen keypad to prevent keyboard popup on mobile
          style={{ width: '100%', padding: '12px', fontSize: '24px', textAlign: 'center', letterSpacing: '8px', borderRadius: '8px', border: `1px solid ${theme.border}`, outline: 'none', background: '#fff', boxSizing: 'border-box' }} 
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {[1,2,3,4,5,6,7,8,9].map(num => (
            <button key={num} onClick={() => setPin(prev => prev.length < 4 ? prev + num : prev)} style={{ padding: '16px', fontSize: '20px', fontWeight: 'bold', background: '#f1f5f9', border: `1px solid ${theme.border}`, borderRadius: '8px', cursor: 'pointer' }}>{num}</button>
          ))}
          <button onClick={() => setPin('')} style={{ padding: '16px', fontSize: '16px', fontWeight: 'bold', background: '#fee2e2', color: theme.danger, border: `1px solid ${theme.border}`, borderRadius: '8px', cursor: 'pointer' }}>DEL</button>
          <button onClick={() => setPin(prev => prev.length < 4 ? prev + '0' : prev)} style={{ padding: '16px', fontSize: '20px', fontWeight: 'bold', background: '#f1f5f9', border: `1px solid ${theme.border}`, borderRadius: '8px', cursor: 'pointer' }}>0</button>
          <div style={{ background: 'transparent' }}></div>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <button onClick={() => handlePunch('IN')} style={{ flex: 1, padding: '16px', background: theme.success, color: '#fff', fontSize: '16px', fontWeight: '900', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>CHECK IN</button>
          <button onClick={() => handlePunch('OUT')} style={{ flex: 1, padding: '16px', background: theme.danger, color: '#fff', fontSize: '16px', fontWeight: '900', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>CHECK OUT</button>
        </div>
      </div>
    </div>
  );

  const AdminView = () => (
    <div style={{ background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.border}`, padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: theme.textMain }}>Timesheet Manager</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: '700', color: theme.textMuted }}>Filter Date:</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: `1px solid ${theme.border}`, outline: 'none' }} />
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: '#f8fafc', borderBottom: `2px solid ${theme.border}`, fontSize: '12px', color: theme.textMuted, textTransform: 'uppercase' }}>
            <tr>
              <th style={{ padding: '12px', fontWeight: '900' }}>Employee</th>
              <th style={{ padding: '12px', fontWeight: '900' }}>Type</th>
              <th style={{ padding: '12px', fontWeight: '900' }}>Time Logged</th>
              <th style={{ padding: '12px', fontWeight: '900', textAlign: 'center' }}>Photo</th>
              <th style={{ padding: '12px', fontWeight: '900', textAlign: 'center' }}>Status</th>
              <th style={{ padding: '12px', fontWeight: '900', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {attendanceLogs.length === 0 ? (
              <tr><td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: theme.textMuted }}>No attendance records found for this date.</td></tr>
            ) : (
              attendanceLogs.map((log) => {
                const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <tr key={log.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
                    <td style={{ padding: '12px', fontWeight: '700', fontSize: '14px', color: theme.textMain }}>{log.employeeName}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '800', background: log.punchType === 'IN' ? '#dcfce7' : '#fee2e2', color: log.punchType === 'IN' ? theme.success : theme.danger }}>{log.punchType}</span>
                    </td>
                    <td style={{ padding: '12px', fontWeight: '700', fontSize: '14px' }}>{timeStr}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <button onClick={() => setViewPhoto({ name: log.employeeName, img: log.photo, type: log.punchType, time: timeStr })} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.primary }}>
                        <ImageIcon size={20} />
                      </button>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {log.editedByAdmin ? <span style={{ fontSize: '11px', color: '#b45309', fontWeight: '700', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px' }}>Edited</span> : <span style={{ color: theme.textMuted }}>-</span>}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <button onClick={() => setEditingLog({ ...log, newTimestamp: log.timestamp.slice(0, 16) })} style={{ background: '#f1f5f9', border: `1px solid ${theme.border}`, padding: '6px', borderRadius: '4px', cursor: 'pointer', color: theme.textMain }}>
                        <Edit2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: '"Inter", sans-serif' }}>
      {/* Top Navigation - Hides automatically if forced into Kiosk mode via props */}
      {!isKioskMode && (
        <div style={{ background: theme.cardBg, padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', gap: '16px' }}>
          <button onClick={() => setActiveTab('admin')} style={{ padding: '8px 16px', background: activeTab === 'admin' ? theme.textMain : 'transparent', color: activeTab === 'admin' ? '#fff' : theme.textMuted, border: `1px solid ${activeTab === 'admin' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', cursor: 'pointer' }}>Admin View</button>
          <button onClick={() => setActiveTab('kiosk')} style={{ padding: '8px 16px', background: activeTab === 'kiosk' ? theme.textMain : 'transparent', color: activeTab === 'kiosk' ? '#fff' : theme.textMuted, border: `1px solid ${activeTab === 'kiosk' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', cursor: 'pointer' }}>Launch Kiosk</button>
        </div>
      )}

      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        {activeTab === 'kiosk' ? <KioskView /> : <AdminView />}
      </div>

      {/* PHOTO MODAL */}
      {viewPhoto && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setViewPhoto(null)}>
          <div style={{ background: '#fff', padding: '20px', borderRadius: '12px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '800' }}>{viewPhoto.name} - Check {viewPhoto.type} ({viewPhoto.time})</h3>
            <img src={viewPhoto.img} alt="Verification" style={{ width: '320px', height: '240px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${theme.border}` }} />
            <br />
            <button onClick={() => setViewPhoto(null)} style={{ marginTop: '16px', padding: '8px 24px', background: theme.textMain, color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editingLog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', width: '320px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '800' }}>Edit Punch: {editingLog.employeeName}</h3>
            <form onSubmit={handleAdminEdit}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '8px', color: theme.textMuted }}>Adjust Timestamp</label>
                <input 
                  type="datetime-local" 
                  value={editingLog.newTimestamp} 
                  onChange={e => setEditingLog({...editingLog, newTimestamp: e.target.value})} 
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: `1px solid ${theme.border}`, outline: 'none', boxSizing: 'border-box' }}
                  required 
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => setEditingLog(null)} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ flex: 1, padding: '10px', background: theme.primary, color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer' }}>Save Edit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}