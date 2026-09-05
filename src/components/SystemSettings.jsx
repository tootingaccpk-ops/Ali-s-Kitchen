import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";
import { Settings, Save, FileUp, FileSpreadsheet, FileText, XCircle, Users, UserPlus, Trash2, Key, Database, Download, UploadCloud, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const defaultAccounts = [
  { id: '1', name: 'Memon Services Ltd', category: 'Bank Account / Cash in Hand', balance: 0 },
  { id: '2', name: 'Khanani Management', category: 'Bank Account / Cash in Hand', balance: 0 },
  { id: '3', name: 'LK Associates', category: 'Bank Account / Cash in Hand', balance: 0 },
  { id: '4', name: 'Safe Box (Main Cash)', category: 'Safe Box (Main Cash)', balance: 0 },
  { id: '5', name: 'Physical Till Drawer', category: 'Physical Till Float', balance: 0 },
  { id: '6', name: 'Cash in Hand', category: 'Bank Account / Cash in Hand', balance: 0 },
  { id: '7', name: 'Booker Wholesale', category: 'Accounts Payable (Supplier)', balance: 0 },
  { id: '8', name: 'JJ Food Service', category: 'Accounts Payable (Supplier)', balance: 0 },
  { id: '9', name: 'British Gas', category: 'Accounts Payable (Supplier)', balance: 0 },
  { id: '10', name: 'Food Supplies', category: 'Cost of Goods Sold (COGS)', balance: 0 },
  { id: '11', name: 'Packaging', category: 'Cost of Goods Sold (COGS)', balance: 0 },
  { id: '12', name: 'Utilities', category: 'Operating Expenses', balance: 0 },
  { id: '13', name: 'Staff Payroll', category: 'Operating Expenses', balance: 0 },
  { id: '14', name: 'Rent', category: 'Operating Expenses', balance: 0 },
  { id: '15', name: 'Marketing', category: 'Operating Expenses', balance: 0 },
  { id: '16', name: 'Repairs & Maintenance', category: 'Operating Expenses', balance: 0 },
  { id: '17', name: 'VAT Input (Purchases)', category: 'Tax Liability / Asset', balance: 0 },
  { id: '18', name: 'VAT Output (Sales)', category: 'Tax Liability / Asset', balance: 0 },
  { id: '19', name: 'Owner Drawings', category: 'Equity / Owner Drawings', balance: 0 }
];

const ALL_TABS = ['Dashboard', 'Daily Sales', 'Purchases & Expenses', 'Receipts & Payments', 'Cash & Bank Books', 'Delivery Settlements', 'Reports', 'System Setup'];
const ERP_STORAGE_KEYS = ['erp_sales_db', 'erp_purchases', 'erp_receipts', 'erp_delivery', 'erp_accounts', 'erp_categories', 'erp_users', 'erp_custom_cat_types'];

export default function SystemSetup({ accounts = [], setAccounts, categoriesMap = {}, setCategoriesMap, salesDb = [], setSalesDb, receiptsDb = [], setReceiptsDb }) {
  const [localAccounts, setLocalAccounts] = useState(accounts.length > 0 ? accounts : defaultAccounts);
  const [importStatus, setImportStatus] = useState('');
  
  // Custom Category State
  const [customCategoryTypes, setCustomCategoryTypes] = useState(() => { try { return JSON.parse(localStorage.getItem('erp_custom_cat_types')) || {}; } catch(e) { return {}; } });
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatData, setNewCatData] = useState({ name: '', type: 'Expense' });
  const [pendingAccId, setPendingAccId] = useState(null);

  const [users, setUsers] = useState([]);
  const [visiblePasswords, setVisiblePasswords] = useState({}); // Track which passwords are toggled visible

  // Check Current Logged-in User Role from Session Storage
  const currentUsername = sessionStorage.getItem('erp_current_user') || '';
  const currentUserRole = (sessionStorage.getItem('erp_current_role') || '').toLowerCase();
  const isAuthorizedAdminOrOwner = currentUserRole === 'admin' || currentUserRole === 'owner';

  // Keep localAccounts synced if cloud accounts prop updates
  useEffect(() => {
    if (accounts.length > 0) {
      setLocalAccounts(accounts);
    }
  }, [accounts]);

  // Firebase Cloud Fetch & LocalStorage Migration Hook
  useEffect(() => {
    const fetchAndMigrateUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "erp_users"));
        const cloudUsers = [];
        querySnapshot.forEach((doc) => {
          cloudUsers.push({ id: doc.id, ...doc.data() });
        });
        
        if (cloudUsers.length > 0) {
          setUsers(cloudUsers);
        } else {
          const localData = JSON.parse(localStorage.getItem('erp_users'));
          
          if (Array.isArray(localData) && localData.length > 0) {
            for (const localUser of localData) {
              const { id, ...userDataWithoutOldId } = localUser;
              await addDoc(collection(db, "erp_users"), {
                ...userDataWithoutOldId,
                createdAt: new Date()
              });
            }
            
            const refreshedSnapshot = await getDocs(collection(db, "erp_users"));
            const migratedUsers = [];
            refreshedSnapshot.forEach((doc) => {
              migratedUsers.push({ id: doc.id, ...doc.data() });
            });
            setUsers(migratedUsers);
          } else {
            setUsers([{ id: 'master', username: 'admin', password: 'password123', role: 'Admin', permissions: ALL_TABS }]);
          }
        }
      } catch (error) {
        console.error("Error handling user migration/fetch: ", error);
      }
    };

    fetchAndMigrateUsers();
  }, []);

  const [newUsername, setNewUsername] = useState(''); 
  const [newPassword, setNewPassword] = useState(''); 
  const [newRole, setNewRole] = useState(''); 
  const [newPermissions, setNewPermissions] = useState(['Dashboard', 'Daily Sales']);

  const isAdminOrOwnerRole = newRole.toLowerCase() === 'admin' || newRole.toLowerCase() === 'owner';

  const handlePermissionToggle = (tab) => { 
    if (newPermissions.includes(tab)) { 
      setNewPermissions(newPermissions.filter(t => t !== tab)); 
    } else { 
      setNewPermissions([...newPermissions, tab]); 
    } 
  };

  const togglePasswordVisibility = (id) => {
    setVisiblePasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddUser = async () => {
    if (!newUsername.trim() || !newPassword.trim() || !newRole.trim()) return alert("Please provide a username, password, and role.");
    if (users.some(u => String(u.username).toLowerCase() === newUsername.toLowerCase())) return alert("A user with this username already exists.");
    if (newRole.toLowerCase() === 'admin' && users.some(u => String(u.role).toLowerCase() === 'admin')) return alert("An Admin already exists! You can only have one Admin ID. If you need full access for another user, name their role 'Owner'.");
    
    const finalPermissions = isAdminOrOwnerRole ? ALL_TABS : newPermissions;
    
    const newUserData = { 
      username: newUsername.trim(), 
      password: newPassword.trim(), 
      role: newRole.trim(), 
      permissions: finalPermissions,
      createdAt: new Date()
    };

    try {
      const docRef = await addDoc(collection(db, "erp_users"), newUserData);
      const updatedUsers = [...users, { id: docRef.id, ...newUserData }];
      setUsers(updatedUsers); 
      
      setNewUsername(''); 
      setNewPassword(''); 
      setNewRole(''); 
      setNewPermissions(['Dashboard', 'Daily Sales']); 
      
      alert("✅ User added successfully to the cloud!");
    } catch (error) {
      console.error("Error adding user to Firebase: ", error);
      alert("Database Error: Could not save the user.");
    }
  };

  const handleRemoveUser = async (id) => { 
    if (users.length === 1) return alert("You cannot delete the last user in the system."); 
    if (window.confirm("Are you sure you want to delete this user?")) { 
      try {
        await deleteDoc(doc(db, "erp_users", id));
        const updatedUsers = users.filter(u => u.id !== id); 
        setUsers(updatedUsers); 
        alert("✅ User deleted successfully.");
      } catch (error) {
        console.error("Error deleting user from Firebase: ", error);
        alert("Database Error: Could not delete user.");
      }
    } 
  };

  const handleChangePassword = async (id) => { 
    const newPass = window.prompt("Enter the new password for this user:"); 
    if (newPass && newPass.trim() !== "") { 
      try {
        const userRef = doc(db, "erp_users", id);
        await updateDoc(userRef, { password: newPass.trim() });
        const updatedUsers = users.map(u => u.id === id ? { ...u, password: newPass.trim() } : u); 
        setUsers(updatedUsers); 
        alert("✅ Password updated successfully in the cloud."); 
      } catch (error) {
        console.error("Error updating password in Firebase: ", error);
        alert("Database Error: Could not update password.");
      }
    } 
  };

  const handleAccountChange = (id, field, value) => {
    setLocalAccounts(prev => prev.map(acc => { if (acc.id === id) { let parsedValue = value; if (field === 'balance') parsedValue = value === '' ? 0 : parseFloat(value); return { ...acc, [field]: parsedValue }; } return acc; }));
  };

  const addAccount = () => { setLocalAccounts(prev => [...prev, { id: Date.now().toString(), name: '', category: '', balance: 0 }]); };
  const removeAccount = (id) => { setLocalAccounts(prev => prev.filter(acc => acc.id !== id)); };

  const cancelChanges = () => { if (window.confirm('Are you sure you want to discard all unsaved changes? This will revert the list to your last saved state.')) { setLocalAccounts(accounts.length > 0 ? accounts : defaultAccounts); } };

  const handleSaveCategory = (e) => {
    e.preventDefault();
    if (!newCatData.name.trim()) return;
    const catName = newCatData.name.trim();
    
    setCustomCategoryTypes(prev => {
        const updated = { ...prev, [catName]: newCatData.type };
        localStorage.setItem('erp_custom_cat_types', JSON.stringify(updated));
        return updated;
    });
    
    if (pendingAccId) handleAccountChange(pendingAccId, 'category', catName);
    setShowCatModal(false); setNewCatData({ name: '', type: 'Expense' }); setPendingAccId(null);
  };

  // FULL CLOUD SAVE FOR CHART OF ACCOUNTS (SYNCING TO FIRESTORE GLOBAL)
  const saveSettings = async () => {
    const names = localAccounts.map(a => String(a.name || '').trim().toLowerCase()).filter(Boolean);
    const hasDuplicates = new Set(names).size !== names.length;
    
    if (hasDuplicates) return alert('❌ Duplicate Accounts Detected! Please ensure every account has a unique name before saving to prevent transaction errors.');
    if (localAccounts.some(a => !String(a.name || '').trim())) return alert('❌ Blank Accounts Detected! Please fill in all account names or delete the empty rows before saving.');

    const newMap = {};
    localAccounts.forEach(acc => {
      if (acc.name) {
        const cat = String(acc.category || '');
        const catLow = cat.toLowerCase();
        const accNameLow = String(acc.name).toLowerCase();
        
        if (accNameLow.includes('vat input')) newMap[acc.name] = 'Asset';
        else if (accNameLow.includes('vat output')) newMap[acc.name] = 'Liability';
        else if (customCategoryTypes[cat]) newMap[acc.name] = customCategoryTypes[cat];
        else if (catLow.includes('payable') || catLow.includes('supplier') || catLow.includes('liability') || catLow.includes('loan')) newMap[acc.name] = 'Liability';
        else if (catLow.includes('cogs') || catLow.includes('expense') || catLow.includes('cost') || catLow.includes('purchase')) newMap[acc.name] = 'Expense';
        else if (catLow.includes('bank') || catLow.includes('cash') || catLow.includes('till') || catLow.includes('safe') || catLow.includes('asset') || catLow.includes('receivable')) newMap[acc.name] = 'Asset';
        else if (catLow.includes('tax') || catLow.includes('vat')) newMap[acc.name] = 'Liability';
        else if (catLow.includes('income') || catLow.includes('revenue') || catLow.includes('sales')) newMap[acc.name] = 'Income';
        else newMap[acc.name] = 'Equity';
      }
    });

    // Update local state and category maps instantly
    setCategoriesMap(newMap);
    setAccounts(localAccounts);
    localStorage.setItem('erp_categories', JSON.stringify(newMap));
    localStorage.setItem('erp_custom_cat_types', JSON.stringify(customCategoryTypes));

    try {
      // Sync directly to Firebase Firestore `erp_accounts` collection
      const querySnapshot = await getDocs(collection(db, "erp_accounts"));
      const existingDocs = {};
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.name) existingDocs[data.name.trim().toLowerCase()] = docSnap.id;
      });

      for (const acc of localAccounts) {
        const docData = {
          name: acc.name.trim(),
          category: acc.category || '',
          balance: Number(acc.balance) || 0
        };

        const matchKey = acc.name.trim().toLowerCase();
        if (existingDocs[matchKey]) {
          await updateDoc(doc(db, "erp_accounts", existingDocs[matchKey]), docData);
        } else {
          await addDoc(collection(db, "erp_accounts"), docData);
        }
      }
      alert('✅ Chart of Accounts Saved Successfully to Cloud & Local Storage!');
    } catch (error) {
      console.error("Error syncing accounts to Firebase:", error);
      alert('⚠️ Saved locally, but cloud sync encountered an issue. Check your Firebase connection rules.');
    }
  };

  const handleBackup = () => {
    const backupData = { version: '1.0', exportedAt: new Date().toISOString(), data: {} };
    ERP_STORAGE_KEYS.forEach(key => { try { const item = localStorage.getItem(key); backupData.data[key] = item ? JSON.parse(item) : []; } catch (e) { backupData.data[key] = []; } });
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); const dateStr = new Date().toISOString().split('T')[0];
    a.href = url; a.download = `Naanstaap_ERP_Backup_${dateStr}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleRestore = (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.confirm("⚠️ WARNING: This will completely overwrite all current system data with the backup file. Are you sure you want to proceed?")) { e.target.value = null; return; }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result); if (!parsed.data) throw new Error("Invalid backup file format.");
        Object.keys(parsed.data).forEach(key => { localStorage.setItem(key, JSON.stringify(parsed.data[key])); });
        alert("✅ Database restored successfully! The system will now reload to apply the restored data."); window.location.reload();
      } catch (err) { alert(`❌ Restore failed: ${err.message}`); } e.target.value = null;
    };
    reader.readAsText(file);
  };

  const sortedAccounts = [...localAccounts].sort((a, b) => { const nameA = String(a.name || ''); const nameB = String(b.name || ''); if (!nameA.trim()) return 1; if (!nameB.trim()) return -1; return nameA.localeCompare(nameB); });

  const uniqueCategories = useMemo(() => {
    const baseCats = ["Bank Account / Cash in Hand", "Safe Box (Main Cash)", "Physical Till Float", "Accounts Payable (Supplier)", "Cost of Goods Sold (COGS)", "Operating Expenses", "Tax Liability / Asset", "Income / Revenue", "Equity / Owner Drawings"];
    const customCats = Object.keys(customCategoryTypes);
    const currentCats = localAccounts.map(a => String(a.category || '').trim()).filter(Boolean);
    return Array.from(new Set([...baseCats, ...customCats, ...currentCats])).sort((a, b) => a.localeCompare(b));
  }, [localAccounts, customCategoryTypes]);

  const handleExportAccounts = (format) => {
    if (sortedAccounts.length === 0) return;
    const headers = ['Account / Supplier Name', 'Category Type', 'Opening Balance (£)'];
    const dataRows = sortedAccounts.map(acc => [acc.name || '-', acc.category || '-', `£ ${Number(acc.balance || 0).toFixed(2)}`]);
    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }</style></head><body><table><tr><td colspan="3" style="font-size: 18px; font-weight: bold; border: none;">Naanstaap - Tooting</td></tr><tr><td colspan="3" style="font-size: 14px; font-weight: bold; border: none;">Chart of Accounts</td></tr><tr><td colspan="3" style="border: none;"></td></tr><tr>`;
      headers.forEach(h => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold;">${h}</th>`; }); html += `</tr>`;
      dataRows.forEach(row => { html += `<tr>${row.map(val => `<td>${val}</td>`).join('')}</tr>`; });
      html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `Chart_Of_Accounts.xls`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } else if (format === 'pdf') {
      try { const doc = new jsPDF('p', 'pt', 'a4'); doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text("Naanstaap - Tooting", 40, 40); doc.setFontSize(14); doc.text("Chart of Accounts", 40, 60); autoTable(doc, { startY: 80, head: [headers], body: dataRows, theme: 'grid', headStyles: { fillColor: [15, 23, 42], fontSize: 10, cellPadding: 6 }, styles: { fontSize: 9, cellPadding: 6 }}); doc.save(`Chart_Of_Accounts.pdf`); } catch (err) { alert("PDF Generation Failed."); }
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setImportStatus('Reading file...');
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result); const workbook = XLSX.read(data, { type: 'array' }); const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
        if (json.length === 0) return setImportStatus('Error: The Excel sheet appears to be empty.');
        const cleanKey = (row, partialMatch) => { const key = Object.keys(row).find(k => String(k).toLowerCase().includes(String(partialMatch).toLowerCase())); return key ? row[key] : ""; };
        const val = (row, match) => Number(cleanKey(row, match)) || 0;

        if (Object.keys(json[0]).some(k => String(k).toLowerCase().includes('gross sales') || String(k).toLowerCase().includes('till'))) {
          const sortedData = json.sort((a, b) => cleanKey(a, 'Date') - cleanKey(b, 'Date'));
          const newSalesRecords = []; const newReceiptRecords = [...receiptsDb]; let runningExpectedTill = 0;
          sortedData.forEach((row, index) => {
            let dateStr = cleanKey(row, 'Date');
            if (typeof dateStr === 'number') { const p = XLSX.SSF.parse_date_code(dateStr); dateStr = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; } else if (typeof dateStr === 'string' && dateStr.includes('/')) { const parts = dateStr.split('/'); dateStr = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateStr; }
            if (!dateStr) return;
            let opening = val(row, 'Opening Till'); if (index > 0 && opening === 0 && cleanKey(row, 'Opening Till') === "") opening = runningExpectedTill;
            const recordId = Date.now().toString() + index;
            const saleData = { id: recordId, date: dateStr, openingTill: opening, tillSalesGross: val(row, 'Till Gross Sales'), tillSalesRefund: val(row, 'Till Sales Refund'), tillCardGross: val(row, 'Till Card Gross'), tillCardRefund: val(row, 'Till Card Refund'), physicalTill: val(row, 'Physical Till'), cashGross: val(row, 'Cash Gross'), cashRefund: val(row, 'Cash Refund'), m1Gross: val(row, 'M1 Gross'), m1Refund: val(row, 'M1 Refund'), m2Gross: val(row, 'M2 Gross'), m2Refund: val(row, 'M2 Refund'), m3Gross: val(row, 'M3 Gross'), m3Refund: val(row, 'M3Refund'), uber: val(row, 'Uber Eats'), deliveroo: val(row, 'Deliveroo'), justEat: val(row, 'Just Eat'), app4: val(row, 'App4'), safeBox: val(row, 'Safe Box Drop'), collections: val(row, 'Till Collection'), vatAmount: val(row, 'VAT Collected'), notes: String(cleanKey(row, 'Notes')), tillVarReason: String(cleanKey(row, 'Till Variance Reason')), cardVarReason: String(cleanKey(row, 'Card Variance Reason')), salesVarReason: String(cleanKey(row, 'Sales Variance Reason')), safeBoxColDate: '' };
            runningExpectedTill = saleData.physicalTill;
            let safeColDateRaw = cleanKey(row, 'Safe Box Col');
            if (safeColDateRaw && saleData.safeBox > 0) {
              let colDateStr = safeColDateRaw; if (typeof colDateStr === 'number') { const p = XLSX.SSF.parse_date_code(colDateStr); colDateStr = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; } else if (typeof colDateStr === 'string' && colDateStr.includes('/')) { const parts = colDateStr.split('/'); colDateStr = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateStr; }
              saleData.safeBoxColDate = colDateStr; newReceiptRecords.push({ id: 'TRF-' + recordId, date: colDateStr, type: 'Transfer', mode: 'Cash', fromBank: 'Safe Box (Main Cash)', toBank: 'Cash in Hand', amount: saleData.safeBox, description: `Auto-Collected Safe Drop from ${dateStr}` });
            }
            newSalesRecords.push(saleData);
          });
          if (window.confirm(`Successfully read ${newSalesRecords.length} Daily Sales records. Ready to inject into database?`)) { const mergedSales = [...salesDb, ...newSalesRecords]; setSalesDb(mergedSales); localStorage.setItem('erp_sales_db', JSON.stringify(mergedSales)); if (newReceiptRecords.length > receiptsDb.length) { setReceiptsDb(newReceiptRecords); localStorage.setItem('erp_receipts', JSON.stringify(newReceiptRecords)); } setImportStatus(`✅ Sales Import Complete! ${newSalesRecords.length} records added.`); } else setImportStatus('Import cancelled.');
        } else {
          const newBankRecords = [...receiptsDb];
          json.forEach((row, index) => {
            let dateStr = cleanKey(row, 'Date'); if (typeof dateStr === 'number') { const p = XLSX.SSF.parse_date_code(dateStr); dateStr = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; } else if (typeof dateStr === 'string' && dateStr.includes('/')) { const parts = dateStr.split('/'); dateStr = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateStr; }
            if (!dateStr) return;
            let type = String(cleanKey(row, 'Type') || 'Payment').trim(); let mode = String(cleanKey(row, 'Mode') || 'Bank').trim(); let bankRaw = String(cleanKey(row, 'Bank') || cleanKey(row, 'Safe') || 'Memon Services Ltd').trim(); let accountRaw = String(cleanKey(row, 'Account') || cleanKey(row, 'Supplier') || '').trim(); let amount = Number(cleanKey(row, 'Amount') || 0); let description = String(cleanKey(row, 'Description') || cleanKey(row, 'Notes') || '').trim();
            let bankName = bankRaw; if (bankRaw.toLowerCase().includes('memon') || bankRaw.toLowerCase() === 'm1') bankName = 'Memon Services Ltd'; else if (bankRaw.toLowerCase().includes('khanani') || bankRaw.toLowerCase() === 'm2') bankName = 'Khanani Management'; else if (bankRaw.toLowerCase().includes('lk') || bankRaw.toLowerCase() === 'm3') bankName = 'LK Associates'; else if (bankRaw.toLowerCase().includes('safe') || bankRaw.toLowerCase().includes('cash')) { mode = 'Cash'; bankName = 'Safe Box (Main Cash)'; }
            const recordId = 'IMP-' + Date.now().toString() + index;
            if (type.toLowerCase() === 'transfer') { newBankRecords.push({ id: recordId, date: dateStr, type: 'Transfer', mode: mode, fromBank: bankName, toBank: accountRaw, amount: amount, description: description || 'Bank Transfer' }); } else { newBankRecords.push({ id: recordId, date: dateStr, type: type, mode: mode, bankName: bankName, account: accountRaw, amount: amount, description: description || type }); }
          });
          if (window.confirm(`Successfully read ${json.length} Bank Transactions. Ready to inject into database?`)) { setReceiptsDb(newBankRecords); localStorage.setItem('erp_receipts', JSON.stringify(newBankRecords)); setImportStatus(`✅ Bank Import Complete! ${json.length} transactions added.`); } else setImportStatus('Import cancelled.');
        }
      } catch (err) { setImportStatus(`❌ Error parsing file: ${err.message}.`); }
    };
    reader.readAsArrayBuffer(file);
  };

  const layout = { background: '#f8fafc', minHeight: '100vh', padding: '40px 20px', fontFamily: '"Inter", system-ui, sans-serif', color: '#0f172a' };
  const container = { maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' };
  const cardStyle = { background: '#ffffff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)', border: '1px solid #e2e8f0', overflow: 'hidden' };
  const cardHeader = { padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(248, 250, 252, 0.5)' };
  const inputStyle = { padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px', width: '100%', boxSizing: 'border-box' };

  // STRICT ACCESS DENIED SCREEN FOR NON-ADMIN / NON-OWNER USERS
  if (!isAuthorizedAdminOrOwner) {
    return (
      <div style={{ ...layout, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ background: '#ffffff', padding: '40px', borderRadius: '16px', border: '1px solid #fecaca', boxShadow: '0 10px 25px -5px rgba(239, 68, 68, 0.1)', textAlign: 'center', maxWidth: '450px', width: '100%' }}>
          <div style={{ width: '64px', height: '64px', background: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
            <ShieldAlert size={32} color="#dc2626" />
          </div>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '22px', fontWeight: '800', color: '#991b1b' }}>Access Denied</h2>
          <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b', lineHeight: '1.5' }}>
            You do not have administrative rights to access the <strong>System Setup</strong> tab. This area is restricted strictly to <strong>Admin</strong> and <strong>Owner</strong> roles.
          </p>
          <div style={{ fontSize: '12px', background: '#f8fafc', padding: '10px', borderRadius: '8px', color: '#475569', border: '1px solid #e2e8f0' }}>
            Logged in as: <strong>{currentUsername || 'Standard User'}</strong> ({currentUserRole || 'Staff'})
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={layout}>
      <div style={container}>
        <div>
          <h1 style={{ margin: 0, fontSize: '32px', fontWeight: '800', letterSpacing: '-0.5px' }}>System Setup</h1>
          <p style={{ margin: '8px 0 0 0', color: '#64748b' }}>Manage your Chart of Accounts, Users, and Data Backups</p>
        </div>

        {/* MODAL: ADD CATEGORY */}
        {showCatModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: '#fff', width: '400px', borderRadius: '8px', border: `1px solid #e2e8f0`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid #e2e8f0`, background: '#e0f2fe', color: '#0369a1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New Category</h2>
                <button onClick={() => { setShowCatModal(false); setPendingAccId(null); }} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: '#0369a1' }}>✖</button>
              </div>
              <form onSubmit={handleSaveCategory} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Category Name</label>
                  <input type="text" value={newCatData.name} onChange={e => setNewCatData({...newCatData, name: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid #cbd5e1`, boxSizing: 'border-box', borderRadius: '4px' }} required autoFocus />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Financial Type</label>
                  <select value={newCatData.type} onChange={e => setNewCatData({...newCatData, type: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid #cbd5e1`, boxSizing: 'border-box', borderRadius: '4px' }} required>
                    <option value="Expense">Expense</option>
                    <option value="Income">Income</option>
                    <option value="Asset">Asset</option>
                    <option value="Liability">Liability</option>
                    <option value="Equity">Equity</option>
                  </select>
                </div>
                <button type="submit" style={{ padding: '10px', background: '#0369a1', color: '#fff', fontWeight: '700', border: 'none', cursor: 'pointer', fontSize: '13px', borderRadius: '4px' }}>Save Category</button>
              </form>
            </div>
          </div>
        )}

        <div style={{ ...cardStyle, border: '1px solid #10b981' }}>
          <div style={{ ...cardHeader, background: '#ecfdf5' }}>
            <Database size={20} color="#059669" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#065f46' }}>Database Backup & Restore</h2>
          </div>
          <div style={{ padding: '24px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handleBackup} style={{ padding: '12px 24px', background: '#059669', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Download size={18} /> Download Full System Backup</button>
            <div style={{ position: 'relative' }}>
              <input type="file" accept=".json" onChange={handleRestore} style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} id="restore-upload" />
              <label htmlFor="restore-upload" style={{ padding: '12px 24px', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}><UploadCloud size={18} /> Restore from Backup</label>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, border: '1px solid #8b5cf6' }}>
          <div style={{ ...cardHeader, background: '#faf5ff' }}>
            <Users size={20} color="#7c3aed" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#5b21b6' }}>User Management (Logins & Permissions)</h2>
          </div>
          <div style={{ padding: '24px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginBottom: '24px' }}>
              <thead style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}><tr><th style={{ padding: '0 16px 12px 0' }}>Username (Login ID)</th><th style={{ padding: '0 16px 12px 0' }}>Password</th><th style={{ padding: '0 16px 12px 0' }}>Role</th><th style={{ padding: '0 16px 12px 0' }}>Allowed Tabs</th><th></th></tr></thead>
              <tbody>
                {users.map(user => {
                  const isMaster = user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'owner';
                  const isPasswordVisible = visiblePasswords[user.id];
                  return (
                    <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 16px 12px 0', fontWeight: '700', fontSize: '14px' }}>{user.username}</td>
                      <td style={{ padding: '12px 16px 12px 0', color: '#475569', fontSize: '14px', fontFamily: 'monospace' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{isPasswordVisible ? user.password : '••••••••'}</span>
                          <button onClick={() => togglePasswordVisibility(user.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '2px', display: 'flex', alignItems: 'center' }} title={isPasswordVisible ? "Hide Password" : "View Password"}>
                            {isPasswordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px 12px 0' }}><span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', background: isMaster ? '#fefce8' : '#f1f5f9', color: isMaster ? '#854d0e' : '#475569' }}>{String(user.role || 'Staff').toUpperCase()}</span></td>
                      <td style={{ padding: '12px 16px 12px 0', fontSize: '11px', color: '#64748b', maxWidth: '200px', whiteSpace: 'normal' }}>{isMaster ? "Full Access" : (user.permissions || []).join(', ')}</td>
                      <td style={{ padding: '12px 0', textAlign: 'right' }}><div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}><button onClick={() => handleChangePassword(user.id)} style={{ padding: '8px', background: '#e0e7ff', color: '#7c3aed', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Change Password"><Key size={14} /></button><button onClick={() => handleRemoveUser(user.id)} style={{ padding: '8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Delete User"><Trash2 size={14} /></button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}><input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="New Username" style={{ ...inputStyle, flex: 1, minWidth: '150px' }} /><input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New Password" style={{ ...inputStyle, flex: 1, minWidth: '150px' }} /><input type="text" value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Role (e.g. Cashier, Owner)" style={{ ...inputStyle, flex: 1, minWidth: '150px' }} /></div>
              <div style={{ marginBottom: '16px' }}><div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', color: '#475569' }}>Assign Tab Permissions:</div><div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>{ALL_TABS.map(tab => (<label key={tab} style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', color: isAdminOrOwnerRole ? '#94a3b8' : '#0f172a', cursor: isAdminOrOwnerRole ? 'not-allowed' : 'pointer' }}><input type="checkbox" checked={isAdminOrOwnerRole ? true : newPermissions.includes(tab)} disabled={isAdminOrOwnerRole} onChange={() => handlePermissionToggle(tab)} style={{ cursor: 'pointer' }} />{tab}</label>))}</div>{isAdminOrOwnerRole && <div style={{ fontSize: '11px', color: '#854d0e', marginTop: '8px', fontWeight: '600' }}>*Admin and Owner roles automatically inherit full system access.</div>}</div>
              <button onClick={handleAddUser} style={{ padding: '12px 24px', background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center' }}><UserPlus size={18} /> Add New User</button>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, border: '1px solid #3b82f6' }}>
          <div style={{ ...cardHeader, background: '#eff6ff' }}>
            <FileUp size={20} color="#2563eb" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#1e40af' }}>Historic Data Importer (.xls)</h2>
          </div>
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}><input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} style={{ padding: '12px', border: '2px dashed #cbd5e1', borderRadius: '8px', background: '#f8fafc', width: '100%', cursor: 'pointer' }} /></div>
            {importStatus && <div style={{ marginTop: '16px', fontWeight: '700', color: String(importStatus).includes('✅') ? '#059669' : '#dc2626' }}>{importStatus}</div>}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={cardHeader}>
            <Settings size={20} color="#2563eb" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700', flex: 1 }}>Chart of Accounts / Ledgers</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => handleExportAccounts('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}><FileSpreadsheet size={14} /> Excel</button>
              <button onClick={() => handleExportAccounts('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}><FileText size={14} /> PDF</button>
            </div>
          </div>
          
          <div style={{ padding: '24px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
              <thead style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '0 16px 12px 0' }}>Account / Supplier Name</th>
                  <th style={{ padding: '0 16px 12px 0' }}>Category Type</th>
                  <th style={{ padding: '0 16px 12px 0' }}>Opening Balance (£)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedAccounts.map((acc, index) => (
                  <tr key={acc.id} style={{ borderBottom: '1px solid #e2e8f0', background: !String(acc.name || '').trim() ? '#fefce8' : 'transparent' }}>
                    <td style={{ padding: '12px 16px 12px 0' }}>
                      <input type="text" value={acc.name || ''} onChange={(e) => handleAccountChange(acc.id, 'name', e.target.value)} style={inputStyle} placeholder="E.g. Booker Wholesale" />
                    </td>
                    <td style={{ padding: '12px 16px 12px 0' }}>
                      <select 
                        value={acc.category || ''} 
                        onChange={(e) => {
                          if (e.target.value === 'ADD_NEW_CAT') {
                            setPendingAccId(acc.id);
                            setShowCatModal(true);
                          } else {
                            handleAccountChange(acc.id, 'category', e.target.value);
                          }
                        }} 
                        style={inputStyle}
                      >
                        <option value="">-- Select Category --</option>
                        {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        <option value="ADD_NEW_CAT" style={{ fontWeight: '700', color: '#0369a1' }}>➕ Add New Category...</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 16px 12px 0' }}>
                      <input type="number" step="any" value={acc.balance === 0 ? '' : acc.balance} onChange={(e) => handleAccountChange(acc.id, 'balance', e.target.value)} placeholder="0.00" style={inputStyle} />
                    </td>
                    <td style={{ padding: '12px 0', textAlign: 'right' }}>
                      <button onClick={() => removeAccount(acc.id)} style={{ padding: '8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>X</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={addAccount} style={{ padding: '12px 24px', background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>+ Add Custom Account</button>
                <button onClick={cancelChanges} style={{ padding: '12px 24px', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><XCircle size={16} /> Discard Changes</button>
              </div>
              <button onClick={saveSettings} style={{ padding: '12px 32px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Save size={18} /> Save Entire Chart of Accounts to Cloud</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}