import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc, query, where } from 'firebase/firestore';
import { db as firebaseDb } from '../firebase'; 
import { Calculator, Users, Clock, FileSpreadsheet, FileText, UserPlus, Trash2, Edit2, AlertCircle, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const theme = {
  bg: '#f8fafc', cardBg: '#ffffff', primary: '#0f172a', success: '#166534', danger: '#dc2626',
  border: '#cbd5e1', textMain: '#0f172a', textMuted: '#64748b', highlight: '#3b82f6'
};

const getTodayDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getFirstDayOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const formatDuration = (ms) => {
  if (!ms || ms < 0) return '0h 0m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

export default function AttendanceManager({ isKioskMode = false }) {
  const currentUserRole = (sessionStorage.getItem('erp_current_role') || '').toLowerCase();
  const hasAdminRights = currentUserRole === 'admin' || currentUserRole === 'owner';
  const effectiveKioskMode = isKioskMode || !hasAdminRights;

  const [activeTab, setActiveTab] = useState(effectiveKioskMode ? 'kiosk' : 'admin');
  const [employees, setEmployees] = useState([]);
  
  const topRef = useRef(null); // Reference for auto-scrolling

  // --- KIOSK STATE ---
  const [selectedEmp, setSelectedEmp] = useState('');
  const [pin, setPin] = useState('');
  const [kioskMessage, setKioskMessage] = useState({ text: '', type: '' });

  // --- ADMIN STATE ---
  const [adminSubTab, setAdminSubTab] = useState('payroll'); 
  const [startDate, setStartDate] = useState(getFirstDayOfMonth());
  const [endDate, setEndDate] = useState(getTodayDateStr());
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [selectedAuditEmp, setSelectedAuditEmp] = useState(null); 
  const [editingPunch, setEditingPunch] = useState(null); 
  
  // --- ADD STAFF STATE ---
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffDesig, setNewStaffDesig] = useState('');
  const [newStaffPin, setNewStaffPin] = useState('');

  const fetchEmployees = async () => {
    try {
      const querySnapshot = await getDocs(collection(firebaseDb, "erp_employees"));
      const emps = [];
      querySnapshot.forEach((doc) => emps.push({ id: doc.id, ...doc.data() }));
      setEmployees(emps);
    } catch (error) {
      console.error("Error fetching employees: ", error);
    }
  };

  useEffect(() => { fetchEmployees(); }, []);

  const fetchLogs = async () => {
    try {
      const q = query(collection(firebaseDb, "erp_attendance"), 
        where("dateStr", ">=", startDate),
        where("dateStr", "<=", endDate)
      );
      const querySnapshot = await getDocs(q);
      const logs = [];
      querySnapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() }));
      logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setAttendanceLogs(logs);
    } catch (error) {
      console.error("Error fetching logs: ", error);
    }
  };

  useEffect(() => {
    if (activeTab === 'admin' && adminSubTab === 'payroll') fetchLogs();
  }, [activeTab, adminSubTab, startDate, endDate]);

  const payrollData = React.useMemo(() => {
    const report = {};
    employees.forEach(emp => {
      report[emp.id] = { id: emp.id, name: emp.name, designation: emp.designation || 'Staff', totalMs: 0, shifts: 0, missingOuts: 0, rawPairs: [] };
    });

    const grouped = {};
    attendanceLogs.forEach(log => {
      if (!grouped[log.employeeId]) grouped[log.employeeId] = {};
      if (!grouped[log.employeeId][log.dateStr]) grouped[log.employeeId][log.dateStr] = [];
      grouped[log.employeeId][log.dateStr].push(log);
    });

    Object.keys(grouped).forEach(empId => {
      if (!report[empId]) return;
      
      Object.keys(grouped[empId]).forEach(date => {
        const dayLogs = grouped[empId][date];
        let i = 0;
        
        while (i < dayLogs.length) {
          if (dayLogs[i].punchType === 'IN') {
            const punchIn = dayLogs[i];
            let punchOut = null;
            let durationMs = 0;
            
            if (i + 1 < dayLogs.length && dayLogs[i+1].punchType === 'OUT') {
              punchOut = dayLogs[i+1];
              
              const inTime = new Date(punchIn.timestamp);
              inTime.setSeconds(0, 0);
              const outTime = new Date(punchOut.timestamp);
              outTime.setSeconds(0, 0);
              
              durationMs = outTime.getTime() - inTime.getTime();
              report[empId].totalMs += durationMs;
              i += 2;
            } else {
              report[empId].missingOuts += 1;
              i += 1;
            }
            report[empId].shifts += 1;
            report[empId].rawPairs.push({ date, in: punchIn, out: punchOut, durationMs });
          } else {
            report[empId].rawPairs.push({ date, in: null, out: dayLogs[i], durationMs: 0 });
            i += 1;
          }
        }
      });
    });

    return Object.values(report).filter(r => r.shifts > 0 || r.rawPairs.length > 0);
  }, [attendanceLogs, employees]);

  useEffect(() => {
    if (selectedAuditEmp) {
      const updated = payrollData.find(r => r.id === selectedAuditEmp.id);
      setSelectedAuditEmp(updated || null);
    }
  }, [payrollData]);

  // --- KIOSK ACTIONS ---
  const handlePunch = async (punchType) => {
    if (!selectedEmp || !pin) return setKioskMessage({ text: 'Select your name and enter PIN.', type: 'error' });

    const employee = employees.find(e => e.id === selectedEmp);
    if (employee.pin !== pin) {
      setPin('');
      return setKioskMessage({ text: 'Incorrect PIN. Try again.', type: 'error' });
    }

    try {
      const q = query(collection(firebaseDb, "erp_attendance"), where("employeeId", "==", employee.id));
      const snap = await getDocs(q);
      const empLogs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const lastPunch = empLogs[0];

      if (punchType === 'IN' && lastPunch && lastPunch.punchType === 'IN') {
        setPin('');
        return setKioskMessage({ text: 'ERROR: Missing previous Check-Out. Please ask an Admin to fix your timesheet before you can Check In.', type: 'error' });
      }
      if (punchType === 'OUT' && (!lastPunch || lastPunch.punchType === 'OUT')) {
        setPin('');
        return setKioskMessage({ text: 'ERROR: You cannot Check Out because you are not currently Checked In.', type: 'error' });
      }

      const now = new Date();
      const logData = {
        employeeId: employee.id,
        employeeName: employee.name,
        punchType: punchType,
        timestamp: now.toISOString(),
        dateStr: getTodayDateStr(),
        editedByAdmin: false
      };

      await addDoc(collection(firebaseDb, "erp_attendance"), logData);
      
      const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setKioskMessage({ text: `✅ Successfully checked ${punchType} at ${formattedTime}`, type: 'success' });
      setSelectedEmp('');
      setPin('');
      
      // Auto-scroll forcefully using React refs
      setTimeout(() => {
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      setTimeout(() => setKioskMessage({ text: '', type: '' }), 5000);
    } catch (error) {
      setKioskMessage({ text: 'Database connection error.', type: 'error' });
    }
  };

  // --- ADMIN ACTIONS ---
  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!newStaffName.trim() || !newStaffPin.trim() || !newStaffDesig.trim()) return alert("Name, Designation, and PIN are required.");
    try {
      await addDoc(collection(firebaseDb, "erp_employees"), {
        name: newStaffName.trim(), designation: newStaffDesig.trim(), pin: newStaffPin.trim(), createdAt: new Date().toISOString()
      });
      setNewStaffName(''); setNewStaffDesig(''); setNewStaffPin(''); fetchEmployees();
      alert("✅ Staff member added successfully!");
    } catch (error) { alert("Error saving staff member."); }
  };

  const handleDeleteStaff = async (id) => {
    if (window.confirm("Are you sure you want to delete this staff member?")) {
      try {
        await deleteDoc(doc(firebaseDb, "erp_employees", id));
        fetchEmployees();
      } catch (error) { alert("Error deleting staff member."); }
    }
  };

  const handleFixPunch = async (e) => {
    e.preventDefault();
    if (!editingPunch.timestamp) return;
    try {
      if (editingPunch.isNew) {
        await addDoc(collection(firebaseDb, "erp_attendance"), {
          employeeId: editingPunch.employeeId, employeeName: editingPunch.employeeName, punchType: editingPunch.type,
          timestamp: new Date(editingPunch.timestamp).toISOString(), dateStr: editingPunch.timestamp.split('T')[0], editedByAdmin: true
        });
      } else {
        await updateDoc(doc(firebaseDb, "erp_attendance", editingPunch.id), { 
          timestamp: new Date(editingPunch.timestamp).toISOString(), editedByAdmin: true 
        });
      }
      setEditingPunch(null);
      fetchLogs(); 
    } catch (error) { alert("Error updating timesheet log."); }
  };

  const handleDeletePunch = async (punchId) => {
    if (window.confirm("Are you sure you want to completely delete this time log?")) {
      try {
        await deleteDoc(doc(firebaseDb, "erp_attendance", punchId));
        fetchLogs();
      } catch (error) { alert("Error deleting log."); }
    }
  };

  // --- EXPORT FUNCTIONS ---
  const exportPayroll = (format) => {
    if (payrollData.length === 0) return alert("No payroll data to export.");
    const headers = ['Employee Name', 'Designation', 'Total Shifts', 'Total Hours Worked', 'Missing Check-Outs'];
    const dataRows = payrollData.map(row => [row.name, row.designation, row.shifts, formatDuration(row.totalMs), row.missingOuts]);

    if (format === 'excel') {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Payroll");
      XLSX.writeFile(wb, `Ali_Kitchen_Payroll_${startDate}_to_${endDate}.xlsx`);
    } else {
      const doc = new jsPDF(); doc.setFontSize(16); doc.text(`Payroll Summary (${startDate} to ${endDate})`, 14, 20);
      autoTable(doc, { startY: 30, head: [headers], body: dataRows, theme: 'grid' });
      doc.save(`Ali_Kitchen_Payroll_${startDate}_to_${endDate}.pdf`);
    }
  };

  const exportAudit = (format) => {
    if (!selectedAuditEmp || selectedAuditEmp.rawPairs.length === 0) return alert("No details to export.");
    const headers = ['Date', 'Check-In', 'Check-Out', 'Shift Duration'];
    const dataRows = selectedAuditEmp.rawPairs.map(pair => [
      pair.date,
      pair.in ? new Date(pair.in.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Missing',
      pair.out ? new Date(pair.out.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Missing',
      pair.out ? formatDuration(pair.durationMs) : 'Incomplete'
    ]);
    const fileName = `${selectedAuditEmp.name.replace(/\s+/g, '_')}_Timesheet_${startDate}_to_${endDate}`;

    if (format === 'excel') {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Details");
      XLSX.writeFile(wb, `${fileName}.xlsx`);
    } else {
      const doc = new jsPDF(); doc.setFontSize(16); doc.text(`Timesheet Audit: ${selectedAuditEmp.name}`, 14, 20);
      doc.setFontSize(12); doc.text(`Period: ${startDate} to ${endDate}`, 14, 28);
      autoTable(doc, { startY: 35, head: [headers], body: dataRows, theme: 'grid' });
      doc.save(`${fileName}.pdf`);
    }
  };

  // --- VIEWS ---

  const renderKioskView = () => (
    <div style={{ maxWidth: '400px', margin: '0 auto', background: theme.cardBg, borderRadius: '12px', padding: '32px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: '900', color: theme.primary }}>Ali's Kitchen</h2>
      <p style={{ margin: '0 0 32px 0', color: theme.textMuted, fontWeight: '600' }}>Staff Attendance Terminal</p>
      
      {kioskMessage.text && (
        <div style={{ padding: '12px', marginBottom: '24px', borderRadius: '8px', background: kioskMessage.type === 'error' ? '#fef2f2' : '#f0fdf4', color: kioskMessage.type === 'error' ? theme.danger : theme.success, fontWeight: '700', fontSize: '14px', border: `1px solid ${kioskMessage.type === 'error' ? '#fca5a5' : '#86efac'}` }}>
          {kioskMessage.text}
        </div>
      )}

      {employees.length === 0 ? (
        <div style={{ padding: '20px', background: '#fefce8', color: '#854d0e', borderRadius: '8px', fontWeight: '700' }}>No staff configured yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <select value={selectedEmp} onChange={(e) => setSelectedEmp(e.target.value)} style={{ width: '100%', padding: '16px', fontSize: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, outline: 'none', background: '#f8fafc', fontWeight: '700', cursor: 'pointer' }}>
            <option value="">-- Select Your Name --</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.designation})</option>)}
          </select>

          <input 
            type="password" placeholder="Enter 4-Digit PIN" value={pin} 
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            style={{ width: '100%', padding: '16px', fontSize: '28px', textAlign: 'center', letterSpacing: '12px', borderRadius: '8px', border: `2px solid ${theme.border}`, outline: 'none', background: '#fff', boxSizing: 'border-box', fontWeight: '900' }} 
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '8px' }}>
            {[1,2,3,4,5,6,7,8,9].map(num => (
              <button key={num} onClick={() => setPin(prev => prev.length < 4 ? prev + num : prev)} style={{ padding: '20px', fontSize: '24px', fontWeight: '900', background: '#f1f5f9', border: 'none', borderRadius: '12px', cursor: 'pointer', color: theme.primary }}>{num}</button>
            ))}
            <button onClick={() => setPin('')} style={{ padding: '20px', fontSize: '16px', fontWeight: '900', background: '#fee2e2', color: theme.danger, border: 'none', borderRadius: '12px', cursor: 'pointer' }}>DEL</button>
            <button onClick={() => setPin(prev => prev.length < 4 ? prev + '0' : prev)} style={{ padding: '20px', fontSize: '24px', fontWeight: '900', background: '#f1f5f9', border: 'none', borderRadius: '12px', cursor: 'pointer', color: theme.primary }}>0</button>
            <div style={{ background: 'transparent' }}></div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
            <button onClick={() => handlePunch('IN')} style={{ flex: 1, padding: '20px', background: theme.success, color: '#fff', fontSize: '18px', fontWeight: '900', border: 'none', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(22, 101, 52, 0.2)' }}>CHECK IN</button>
            <button onClick={() => handlePunch('OUT')} style={{ flex: 1, padding: '20px', background: theme.danger, color: '#fff', fontSize: '18px', fontWeight: '900', border: 'none', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)' }}>CHECK OUT</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderAdminView = () => (
    <div style={{ background: theme.cardBg, borderRadius: '12px', border: `1px solid ${theme.border}`, boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, background: '#f8fafc', borderRadius: '12px 12px 0 0' }}>
        <button onClick={() => setAdminSubTab('payroll')} style={{ flex: 1, padding: '16px', background: adminSubTab === 'payroll' ? '#fff' : 'transparent', border: 'none', borderBottom: adminSubTab === 'payroll' ? `3px solid ${theme.highlight}` : '3px solid transparent', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: adminSubTab === 'payroll' ? theme.highlight : theme.textMuted }}>
          <Calculator size={18} /> Payroll Summary
        </button>
        <button onClick={() => setAdminSubTab('staff')} style={{ flex: 1, padding: '16px', background: adminSubTab === 'staff' ? '#fff' : 'transparent', border: 'none', borderBottom: adminSubTab === 'staff' ? `3px solid ${theme.highlight}` : '3px solid transparent', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: adminSubTab === 'staff' ? theme.highlight : theme.textMuted }}>
          <Users size={18} /> Manage Staff
        </button>
      </div>

      <div style={{ padding: '24px' }}>
        {adminSubTab === 'payroll' && !selectedAuditEmp && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '900', color: theme.textMain }}>Payroll & Timesheets</h2>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase' }}>Start Date</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, outline: 'none', fontWeight: '600' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase' }}>End Date</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, outline: 'none', fontWeight: '600' }} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => exportPayroll('excel')} style={{ padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FileSpreadsheet size={16}/> Excel</button>
                <button onClick={() => exportPayroll('pdf')} style={{ padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FileText size={16}/> PDF</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${theme.border}`, borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: '#f8fafc', borderBottom: `2px solid ${theme.border}`, fontSize: '12px', color: theme.textMuted, textTransform: 'uppercase' }}>
                  <tr>
                    <th style={{ padding: '16px', fontWeight: '900' }}>Employee Details</th>
                    <th style={{ padding: '16px', fontWeight: '900', textAlign: 'center' }}>Total Shifts</th>
                    <th style={{ padding: '16px', fontWeight: '900', textAlign: 'center' }}>Errors / Missing</th>
                    <th style={{ padding: '16px', fontWeight: '900', textAlign: 'right' }}>Total Hours</th>
                    <th style={{ padding: '16px', fontWeight: '900', textAlign: 'center' }}>Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollData.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: theme.textMuted, fontWeight: '600' }}>No attendance data found for this period.</td></tr>
                  ) : (
                    payrollData.map((row) => (
                      <tr key={row.id} style={{ borderBottom: `1px solid ${theme.border}`, background: row.missingOuts > 0 ? '#fef2f2' : '#fff' }}>
                        <td style={{ padding: '16px' }}>
                          <div style={{ fontWeight: '800', fontSize: '14px', color: theme.primary }}>{row.name}</div>
                          <div style={{ fontSize: '12px', color: theme.textMuted, fontWeight: '600' }}>{row.designation}</div>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center', fontWeight: '700', fontSize: '14px' }}>{row.shifts}</td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          {row.missingOuts > 0 ? (
                            <span style={{ background: '#fee2e2', color: theme.danger, padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <AlertCircle size={12}/> {row.missingOuts} Missing Out
                            </span>
                          ) : <span style={{ color: theme.success, fontWeight: '800' }}>Perfect</span>}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '900', fontSize: '16px', color: theme.highlight }}>{formatDuration(row.totalMs)}</td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <button onClick={() => setSelectedAuditEmp(row)} style={{ padding: '6px 12px', background: '#f1f5f9', border: `1px solid ${theme.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '700', color: theme.textMain, fontSize: '12px' }}>
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {adminSubTab === 'payroll' && selectedAuditEmp && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button onClick={() => setSelectedAuditEmp(null)} style={{ padding: '8px', background: '#f1f5f9', border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={20}/></button>
                <div>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900' }}>{selectedAuditEmp.name}'s Timesheet</h2>
                  <p style={{ margin: 0, fontSize: '13px', color: theme.textMuted, fontWeight: '600' }}>Period: {startDate} to {endDate} | Total: {formatDuration(selectedAuditEmp.totalMs)}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => exportAudit('excel')} style={{ padding: '8px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}><FileSpreadsheet size={14}/> Export Details</button>
                <button onClick={() => exportAudit('pdf')} style={{ padding: '8px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}><FileText size={14}/> PDF</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${theme.border}`, borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: '#f8fafc', borderBottom: `2px solid ${theme.border}`, fontSize: '12px', color: theme.textMuted, textTransform: 'uppercase' }}>
                  <tr>
                    <th style={{ padding: '16px', fontWeight: '900' }}>Date</th>
                    <th style={{ padding: '16px', fontWeight: '900' }}>Check-In</th>
                    <th style={{ padding: '16px', fontWeight: '900' }}>Check-Out</th>
                    <th style={{ padding: '16px', fontWeight: '900', textAlign: 'right' }}>Shift Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedAuditEmp.rawPairs.map((pair, idx) => (
                    <tr key={idx} style={{ borderBottom: `1px solid ${theme.border}`, background: !pair.out ? '#fef2f2' : '#fff' }}>
                      <td style={{ padding: '16px', fontWeight: '700', fontSize: '14px' }}>{pair.date}</td>
                      <td style={{ padding: '16px', fontSize: '14px' }}>
                        {pair.in ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontWeight: '700', color: theme.success }}>{new Date(pair.in.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button onClick={() => setEditingPunch(pair.in)} style={{ border: 'none', background: '#f1f5f9', padding: '6px', borderRadius: '4px', cursor: 'pointer', color: theme.textMain }}><Edit2 size={12}/></button>
                              <button onClick={() => handleDeletePunch(pair.in.id)} style={{ border: 'none', background: '#fee2e2', padding: '6px', borderRadius: '4px', cursor: 'pointer', color: theme.danger }}><Trash2 size={12}/></button>
                            </div>
                          </div>
                        ) : <span style={{ color: theme.textMuted }}>Missing</span>}
                      </td>
                      <td style={{ padding: '16px', fontSize: '14px' }}>
                        {pair.out ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontWeight: '700', color: theme.danger }}>{new Date(pair.out.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button onClick={() => setEditingPunch(pair.out)} style={{ border: 'none', background: '#f1f5f9', padding: '6px', borderRadius: '4px', cursor: 'pointer', color: theme.textMain }}><Edit2 size={12}/></button>
                              <button onClick={() => handleDeletePunch(pair.out.id)} style={{ border: 'none', background: '#fee2e2', padding: '6px', borderRadius: '4px', cursor: 'pointer', color: theme.danger }}><Trash2 size={12}/></button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setEditingPunch({ isNew: true, employeeId: selectedAuditEmp.id, employeeName: selectedAuditEmp.name, type: 'OUT', timestamp: `${pair.date}T17:00` })} style={{ background: theme.danger, color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}>+ Add Out Time</button>
                        )}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: !pair.out ? theme.danger : theme.textMain }}>
                        {pair.out ? formatDuration(pair.durationMs) : 'Incomplete'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {adminSubTab === 'staff' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '32px' }}>
            <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: `1px solid ${theme.border}`, alignSelf: 'start' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}><UserPlus size={18}/> Register Employee</h3>
              <form onSubmit={handleAddStaff}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '6px', color: theme.textMuted }}>Full Name</label>
                  <input type="text" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} placeholder="e.g. Zaid Ali" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxSizing: 'border-box', fontWeight: '600' }} required />
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '6px', color: theme.textMuted }}>Designation / Role</label>
                  <input type="text" value={newStaffDesig} onChange={e => setNewStaffDesig(e.target.value)} placeholder="e.g. Head Chef, Cashier" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxSizing: 'border-box', fontWeight: '600' }} required />
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '6px', color: theme.textMuted }}>Kiosk PIN Code (4 Digits)</label>
                  <input type="text" value={newStaffPin} onChange={e => setNewStaffPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="e.g. 1234" maxLength={4} pattern="\d{4}" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxSizing: 'border-box', letterSpacing: '4px', textAlign: 'center', fontWeight: '800', fontSize: '18px' }} required />
                </div>
                <button type="submit" style={{ width: '100%', padding: '14px', background: theme.primary, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>Add to System</button>
              </form>
            </div>
            <div>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '800' }}>Active Employees</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                {employees.length === 0 ? <p style={{ color: theme.textMuted, fontSize: '14px', fontWeight: '600' }}>No staff configured.</p> : null}
                {employees.map(emp => (
                  <div key={emp.id} style={{ padding: '16px', border: `1px solid ${theme.border}`, borderRadius: '12px', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '15px', color: theme.textMain }}>{emp.name}</div>
                      <div style={{ fontSize: '12px', color: theme.textMuted, fontWeight: '700', marginBottom: '4px' }}>{emp.designation}</div>
                      <div style={{ fontSize: '11px', color: theme.highlight, fontWeight: '800', background: '#eff6ff', display: 'inline-block', padding: '2px 8px', borderRadius: '4px' }}>PIN: {emp.pin}</div>
                    </div>
                    <button onClick={() => handleDeleteStaff(emp.id)} style={{ background: '#fee2e2', color: theme.danger, border: 'none', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={topRef} style={{ minHeight: '100vh', background: theme.bg, fontFamily: '"Inter", sans-serif' }}>
      {!effectiveKioskMode && (
        <div style={{ background: theme.cardBg, padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', gap: '16px' }}>
          <button onClick={() => setActiveTab('admin')} style={{ padding: '10px 20px', background: activeTab === 'admin' ? theme.primary : 'transparent', color: activeTab === 'admin' ? '#fff' : theme.textMuted, border: `1px solid ${activeTab === 'admin' ? theme.primary : theme.border}`, borderRadius: '24px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>Dashboard / Admin</button>
          <button onClick={() => setActiveTab('kiosk')} style={{ padding: '10px 20px', background: activeTab === 'kiosk' ? theme.primary : 'transparent', color: activeTab === 'kiosk' ? '#fff' : theme.textMuted, border: `1px solid ${activeTab === 'kiosk' ? theme.primary : theme.border}`, borderRadius: '24px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>Launch Floor Kiosk</button>
        </div>
      )}
      <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>
        {activeTab === 'kiosk' ? renderKioskView() : renderAdminView()}
      </div>

      {editingPunch && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '32px', borderRadius: '16px', width: '360px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '900' }}>{editingPunch.isNew ? 'Add Missing Punch' : 'Edit Time Log'}</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: theme.textMuted, fontWeight: '600' }}>Employee: {editingPunch.employeeName} ({editingPunch.type})</p>
            <form onSubmit={handleFixPunch}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '8px', color: theme.textMain }}>Corrected Timestamp</label>
                <input type="datetime-local" value={editingPunch.timestamp.slice(0,16)} onChange={e => setEditingPunch({...editingPunch, timestamp: e.target.value})} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: `2px solid ${theme.border}`, outline: 'none', boxSizing: 'border-box', fontWeight: '700' }} required />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" onClick={() => setEditingPunch(null)} style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', color: theme.textMain }}>Cancel</button>
                <button type="submit" style={{ flex: 1, padding: '12px', background: theme.primary, color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>Confirm Fix</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}