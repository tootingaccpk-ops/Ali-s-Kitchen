import React, { useState, useMemo, useEffect } from 'react';
import { doc, setDoc, deleteDoc, writeBatch, addDoc, collection, getDocs } from "firebase/firestore";
import { db as firebaseDb } from "../firebase"; 
import { ArrowDownCircle, ArrowUpCircle, ArrowRightLeft, Wallet, Landmark, Trash2, Edit2, FileText, Search, XCircle, Filter, FileSpreadsheet, BookOpen, Plus, AlertTriangle, Link as LinkIcon, Unlink } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const getToday = () => {
  const ukTime = new Date().toLocaleString("en-US", { timeZone: "Europe/London" });
  const d = new Date(ukTime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getStartOfMonth = () => {
  const ukTime = new Date().toLocaleString("en-US", { timeZone: "Europe/London" });
  const d = new Date(ukTime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const normalizeDate = (d) => {
  if (!d) return '';
  let nd = String(d).replace(/\//g, '-');
  const p = nd.split('-');
  if (p.length === 3) {
    if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }
  return nd;
};

const formatDateToDDMMYYYY = (dateStr) => {
  if (!dateStr) return '';
  const nd = normalizeDate(dateStr);
  const parts = nd.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

const fmtMoney = (n) => {
  const num = Number(n) || 0;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const initialForm = {
  id: '', type: 'Payment', date: getToday(), mode: 'Cash', bankName: '', category: '', account: '', payee: '', description: '', amount: '', fromBank: '', toBank: '', debitAccount: '', creditAccount: '',
  noInvoiceRequired: false,
  lines: [{ id: Date.now(), account: '', debit: '', credit: '', description: '' }, { id: Date.now() + 1, account: '', debit: '', credit: '', description: '' }]
};

const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerRedBg: '#fee2e2', headerRedText: '#991b1b', headerPurpleBg: '#f3e8ff', headerPurpleText: '#7e22ce',
};

const labelTd = { border: `1px solid ${sheetTheme.border}`, padding: '8px 12px', fontSize: '13px', color: '#333', background: sheetTheme.labelBg, whiteSpace: 'nowrap', width: '30%', fontWeight: '600' };
const inputTd = { border: `1px solid ${sheetTheme.border}`, padding: '0', background: '#fff', width: '70%' };

const CellInput = ({ name, value, onChange, onKeyDown, type="text", placeholder="", align="left", required=false, step, autoFocus=false, disabled=false, readOnly=false, bg='transparent' }) => (
  <input type={type} name={name} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} required={required} step={step} autoFocus={autoFocus} disabled={disabled} readOnly={readOnly} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: align, outline: 'none', background: disabled || readOnly ? bg : 'transparent', color: disabled || readOnly ? '#4b5563' : '#000' }} />
);

const CellSelect = ({ name, value, onChange, onKeyDown, children, required=false, disabled=false, textColor='#000' }) => (
  <select name={name} value={value} onChange={onChange} onKeyDown={onKeyDown} required={required} disabled={disabled} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: disabled ? '#f3f4f6' : 'transparent', color: textColor, appearance: 'auto', cursor: disabled ? 'not-allowed' : 'pointer' }}>
    {children}
  </select>
);

export default function ReceiptsPayments({ db = [], setDb, categoriesMap = {}, setCategoriesMap, accountsDb = [], setAccountsDb, onGoBack }) {
  const [formData, setFormData] = useState(initialForm);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState(getStartOfMonth());
  const [filterDateTo, setFilterDateTo] = useState(getToday());
  const [filterCategory, setFilterCategory] = useState('All'); 
  const [filterType, setFilterType] = useState('All'); 
  const [auditMode, setAuditMode] = useState(false);

  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatData, setNewCatData] = useState({ name: '', type: 'Expense' });
  const [showAccModal, setShowAccModal] = useState(false);
  const [newAccData, setNewAccData] = useState({ name: '', category: '' });
  
  const [pendingJvLineIndex, setPendingJvLineIndex] = useState(null);
  const [isSavingAcc, setIsSavingAcc] = useState(false);
  
  const [linkModal, setLinkModal] = useState(null);

  const currentUserRole = (sessionStorage.getItem('erp_current_role') || '').toLowerCase();
  const isAuthorizedAdminOrOwner = currentUserRole === 'admin' || currentUserRole === 'owner';

  useEffect(() => {
    const runStartupSync = async () => {
      try {
        const localData = JSON.parse(localStorage.getItem('erp_receipts'));
        const isMigrated = localStorage.getItem('erp_receipts_migrated');
        
        if (localData && Array.isArray(localData) && localData.length > 0 && !isMigrated) {
          const batch = writeBatch(firebaseDb);
          localData.forEach(record => {
            const recordId = record.id || Date.now().toString() + Math.random().toString(36).substring(7);
            const docRef = doc(firebaseDb, "erp_receipts", recordId);
            batch.set(docRef, { ...record, id: recordId });
          });
          await batch.commit();
          localStorage.setItem('erp_receipts_migrated', 'true');
        }

        const invSnapshot = await getDocs(collection(firebaseDb, "erp_purchases"));
        const existingInvoiceIds = new Set();
        invSnapshot.forEach(docSnap => existingInvoiceIds.add(docSnap.id));

        let orphanCleaned = false;
        const batchClean = writeBatch(firebaseDb);
        const updatedDb = db.map(row => {
          if (row.linkedInvoiceId && !existingInvoiceIds.has(row.linkedInvoiceId)) {
            orphanCleaned = true;
            const cleanedRow = { ...row };
            delete cleanedRow.linkedInvoiceId;
            cleanedRow.description = (cleanedRow.description || '').replace(/\| Linked to Inv\/Ref:.*?(?=\||$)/g, '').trim();
            batchClean.set(doc(firebaseDb, "erp_receipts", cleanedRow.id), cleanedRow);
            return cleanedRow;
          }
          return row;
        });

        if (orphanCleaned) {
          await batchClean.commit();
          if (setDb) setDb(updatedDb);
        }
      } catch (error) {
        console.error("Startup sync/cleanup failed: ", error);
      }
    };
    
    if (db.length > 0) {
      runStartupSync();
    }
  }, [db]);

  const bankAccounts = accountsDb.filter(acc => { const cat = String(acc.category || '').toLowerCase(); return cat.includes('bank') || cat.includes('cash') || cat.includes('safe') || cat.includes('till'); }).sort((a, b) => a.name.localeCompare(b.name));
  const allCategories = useMemo(() => {
    const baseCats = ["Accounts Payable (Supplier)", "Cost of Goods Sold (COGS)", "Operating Expenses", "Tax Liability / Asset", "Income / Revenue", "Equity / Owner Drawings", "Bank Account / Cash in Hand", "Safe Box (Main Cash)", "Physical Till Float"];
    const currentCats = accountsDb.map(a => (a.category || '').trim()).filter(Boolean);
    return Array.from(new Set([...baseCats, ...currentCats])).sort((a, b) => a.localeCompare(b));
  }, [accountsDb]);
  const allAccountsSorted = [...accountsDb].sort((a, b) => a.name.localeCompare(b.name));

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => {
      const updates = { [name]: type === 'checkbox' ? checked : value };
      if (name === 'mode' && value === 'Cash') updates.bankName = '';
      return { ...prev, ...updates };
    });
  };

  const handleAccountSelect = (e) => {
    const val = e.target.value;
    if (val === 'ADD_NEW_ACC') { 
        setPendingJvLineIndex(null);
        setNewAccData({ name: '', category: '' }); 
        setShowAccModal(true); 
        return; 
    }
    const acc = accountsDb.find(a => a.name === val);
    setFormData(prev => ({ ...prev, account: val, category: acc ? acc.category : '' }));
  };

  const handleJvLine = (index, field, value) => {
    setFormData(prev => {
      const newLines = [...(prev.lines || [])];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addJvLine = () => setFormData(prev => ({ ...prev, lines: [...(prev.lines || []), { id: Date.now(), account: '', debit: '', credit: '', description: '' }] }));
  const removeJvLine = (index) => setFormData(prev => {
    const newLines = [...(prev.lines || [])];
    newLines.splice(index, 1);
    if (newLines.length === 0) newLines.push({ id: Date.now(), account: '', debit: '', credit: '', description: '' });
    return { ...prev, lines: newLines };
  });

  const handleSaveCategory = (e) => {
    e.preventDefault();
    if (!newCatData.name.trim()) return;
    const catName = newCatData.name.trim();
    if (setCategoriesMap) setCategoriesMap(prev => ({ ...prev, [catName]: newCatData.type }));
    if (showAccModal) setNewAccData(prev => ({ ...prev, category: catName })); else setFormData(prev => ({ ...prev, category: catName }));
    setShowCatModal(false); setNewCatData({ name: '', type: 'Expense' });
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    if (isSavingAcc) return;
    if (!newAccData.name.trim() || !newAccData.category) return alert("Please provide both an Account Name and a Category.");
    
    setIsSavingAcc(true);
    const accName = newAccData.name.trim();
    
    const existingMatch = accountsDb.find(a => String(a.name).toLowerCase() === accName.toLowerCase());
    if (existingMatch) {
      if (pendingJvLineIndex !== null) {
          handleJvLine(pendingJvLineIndex, 'account', existingMatch.name);
      } else {
          setFormData(prev => ({ ...prev, account: existingMatch.name, category: existingMatch.category }));
      }
      setShowAccModal(false);
      setNewAccData({ name: '', category: '' });
      setPendingJvLineIndex(null);
      setIsSavingAcc(false);
      return;
    }
    
    const newAccount = { date: getToday(), category: newAccData.category, name: accName, type: categoriesMap[newAccData.category] || 'Expense', balance: 0 };
    
    try {
      const docRef = await addDoc(collection(firebaseDb, "erp_accounts"), newAccount);
      const finalAccount = { id: docRef.id, ...newAccount };
      if (setAccountsDb) setAccountsDb(prev => [finalAccount, ...prev]);
      
      if (pendingJvLineIndex !== null) {
          handleJvLine(pendingJvLineIndex, 'account', accName);
      } else {
          setFormData(prev => ({ ...prev, account: accName, category: newAccData.category }));
      }
      
      setShowAccModal(false); 
      setNewAccData({ name: '', category: '' });
      setPendingJvLineIndex(null);
    } catch (err) {
      alert("Database Error: Could not create account.");
    } finally {
      setIsSavingAcc(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); const form = e.target.form;
      if (form) {
        const focusable = Array.from(form.elements).filter(el => !el.disabled && !el.readOnly && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || (el.tagName === 'BUTTON' && el.type === 'submit')));
        const index = focusable.indexOf(e.target);
        if (index > -1 && index < focusable.length - 1) focusable[index + 1].focus();
      }
    }
  };

  const handleEdit = (row) => {
    const accInDb = accountsDb.find(a => a.name === row.account);
    const editedRow = { ...row, type: row.type === 'JV' ? 'Journal' : row.type, category: row.category || (accInDb ? accInDb.category : '') };
    
    if (editedRow.type === 'Journal' && (!editedRow.lines || editedRow.lines.length === 0)) {
      editedRow.lines = [
        { id: 1, account: row.debitAccount || '', debit: row.amount, credit: '', description: row.description || '' },
        { id: 2, account: row.creditAccount || '', debit: '', credit: row.amount, description: row.description || '' }
      ];
    } else if (editedRow.type === 'Journal' && editedRow.lines) {
      editedRow.lines = editedRow.lines.map(l => ({...l})); 
    }
    
    setFormData(editedRow);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payeeName = (formData.payee || '').trim().toLowerCase();
    const conflictingAccount = accountsDb.find(a => 
      a.name.toLowerCase() === payeeName && 
      !String(a.category).toLowerCase().includes('payable') && 
      !String(a.category).toLowerCase().includes('supplier')
    );
    
    if (conflictingAccount) {
        return alert(`⚠️ Validation Error:\n\nYou have entered an Accounting Ledger name ("${formData.payee}") into the Payee/Supplier field.\n\nThe Payee field should be the brand/company name (e.g., 'Amazon'), and the Account field should be the category (e.g., '${formData.payee}').\n\nPlease swap them!`);
    }

    const transaction = { ...formData, payee: formData.payee || '' };

    if (formData.type === 'Transfer') {
      if (!formData.fromBank || !formData.toBank) return alert("Please select both a 'From Bank' and a 'To Bank'.");
      if (formData.fromBank === formData.toBank) return alert("The 'From Bank' and 'To Bank' cannot be the same!");
      transaction.amount = Number(formData.amount);
    } else if (formData.type === 'Journal') {
      const dTot = (formData.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const cTot = (formData.lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0);
      if (dTot === 0 || cTot === 0) return alert("Please enter amounts for Debits and Credits.");
      if (Math.abs(dTot - cTot) > 0.01) return alert(`Unbalanced Entry! Debits (£${dTot}) must equal Credits (£${cTot}).`);
      
      const cleanLines = (formData.lines || []).filter(l => (Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0);
      if (cleanLines.some(l => !l.account)) return alert("Please select an account for all lines that have amounts.");
      
      transaction.lines = cleanLines;
      transaction.amount = dTot; 
    } else {
      if (formData.mode === 'Bank' && !formData.bankName) return alert("Please select a Bank Account.");
      if (!formData.account) return alert("Please select a specific Account Ledger.");
      transaction.amount = Number(formData.amount);
    }

    const isNew = !formData.id;
    const recordId = formData.id || Date.now().toString();
    transaction.id = recordId;

    if (isNew) {
      if (setDb) setDb(prev => [transaction, ...prev].sort((a, b) => new Date(normalizeDate(b.date)) - new Date(normalizeDate(a.date))));
    } else {
      if (setDb) setDb(prev => prev.map(t => t.id === formData.id ? transaction : t).sort((a, b) => new Date(normalizeDate(b.date)) - new Date(normalizeDate(a.date))));
    }
    
    try {
      await setDoc(doc(firebaseDb, "erp_receipts", recordId), transaction);
      alert(`✅ ${formData.type === 'Journal' ? 'Compound JV' : formData.type} ${isNew ? 'saved' : 'updated'} successfully!`);
      setFormData({ ...initialForm, lines: [{ id: Date.now(), account: '', debit: '', credit: '', description: '' }, { id: Date.now() + 1, account: '', debit: '', credit: '', description: '' }] });
    } catch (error) {
      alert("Database Error: Could not save the transaction.");
    }
  };

  const handleDelete = async (id) => {
    const targetRow = db.find(t => t.id === id);
    if (window.confirm("Are you sure you want to delete this transaction?")) { 
      if (setDb) setDb(prev => prev.filter(t => t.id !== id)); 
      try {
        const batch = writeBatch(firebaseDb);
        batch.delete(doc(firebaseDb, "erp_receipts", id));

        if (targetRow && targetRow.linkedInvoiceId) {
            const invSnap = await getDocs(collection(firebaseDb, "erp_purchases"));
            invSnap.forEach(invDoc => {
                if (invDoc.id === targetRow.linkedInvoiceId) {
                    batch.update(doc(firebaseDb, "erp_purchases", invDoc.id), { paymentStatus: 'Unpaid' });
                }
            });
        }

        await batch.commit();
      } catch (error) {
        alert("Database Error: Could not delete the transaction.");
      }
    }
  };

  const handleUnlink = async (receipt) => {
    if (!isAuthorizedAdminOrOwner) {
      return alert("⛔ Access Denied: Unlinking transactions is restricted strictly to Admin and Owner roles.");
    }

    if (!window.confirm(`Are you sure you want to unlink this payment from its invoice? This will set the linked invoice back to Unpaid.`)) return;

    try {
      const batch = writeBatch(firebaseDb);
      
      const updatedReceipt = { ...receipt };
      delete updatedReceipt.linkedInvoiceId;
      updatedReceipt.description = (updatedReceipt.description || '').replace(/\| Linked to Inv\/Ref:.*?(?=\||$)/g, '').trim();
      batch.set(doc(firebaseDb, "erp_receipts", updatedReceipt.id), updatedReceipt);

      if (receipt.linkedInvoiceId) {
        const invSnap = await getDocs(collection(firebaseDb, "erp_purchases"));
        invSnap.forEach(invDoc => {
          if (invDoc.id === receipt.linkedInvoiceId) {
            batch.update(doc(firebaseDb, "erp_purchases", invDoc.id), { paymentStatus: 'Unpaid' });
          }
        });
      }

      await batch.commit();

      if (setDb) setDb(prev => prev.map(r => r.id === updatedReceipt.id ? updatedReceipt : r));
      alert("✅ Successfully unlinked! The payment is now unassigned and the invoice has been reset to Unpaid.");
    } catch (err) {
      alert("Database Error: Could not unlink the payment.");
    }
  };

  const openLinkModal = async (receipt) => {
    setLinkModal({ isLoading: true, receipt });
    try {
        const querySnapshot = await getDocs(collection(firebaseDb, "erp_purchases"));
        const purchases = [];
        querySnapshot.forEach(doc => purchases.push({ id: doc.id, ...doc.data() }));

        const unpaid = purchases.filter(p => p.paymentStatus !== 'Paid');
        unpaid.sort((a, b) => new Date(normalizeDate(b.date)) - new Date(normalizeDate(a.date)));

        setLinkModal({
            receipt,
            unpaidInvoices: unpaid,
            searchStr: '',
            showAll: false,
            isLoading: false,
            tab: 'match',
            newInvoice: { refNo: `INV-${receipt.id.slice(-4)}`, expenseAccount: '', vatAmount: '' }
        });
    } catch(e) {
        alert("Failed to load invoices. Please check your connection.");
        setLinkModal(null);
    }
  };

  const handleLinkToInvoice = async (invoice) => {
      if (!window.confirm(`Are you sure you want to link this £${fmtMoney(linkModal.receipt.amount)} payment to Invoice ${invoice.refNo} from ${invoice.supplier}?`)) return;

      try {
          const batch = writeBatch(firebaseDb);
          const updatedReceipt = {
              ...linkModal.receipt,
              linkedInvoiceId: invoice.id,
              account: invoice.supplier || 'Unassigned Supplier',
              category: 'Accounts Payable (Supplier)',
              payee: invoice.supplier || linkModal.receipt.payee,
              description: `Linked to Inv/Ref: ${invoice.refNo} | ${linkModal.receipt.description}`
          };
          batch.set(doc(firebaseDb, "erp_receipts", updatedReceipt.id), updatedReceipt);

          const updatedInvoice = { ...invoice, paymentStatus: 'Paid' };
          batch.set(doc(firebaseDb, "erp_purchases", updatedInvoice.id), updatedInvoice);

          await batch.commit();

          if (setDb) setDb(prev => prev.map(r => r.id === updatedReceipt.id ? updatedReceipt : r));
          
          alert("✅ Successfully linked! The payment is now matched to the invoice and will correctly appear in your Supplier Balances.");
          setLinkModal(null);
      } catch(e) {
          alert("Database Error: Could not link the payment.");
      }
  };

  const handleCreateAndLinkInvoice = async (e) => {
      e.preventDefault();
      const { receipt, newInvoice } = linkModal;
      if (!newInvoice.expenseAccount) return alert("Please select an expense account.");
      if (!newInvoice.refNo) return alert("Please provide an Invoice Reference number.");

      const gross = Number(receipt.amount) || 0;
      const vat = Number(newInvoice.vatAmount) || 0;
      const net = gross - vat;
      
      if (vat > gross) return alert("VAT cannot be greater than the total gross amount.");

      if (!window.confirm(`Create invoice for £${fmtMoney(gross)} (VAT: £${fmtMoney(vat)}) and link to this payment?`)) return;

      try {
          const batch = writeBatch(firebaseDb);
          
          const invoiceId = Date.now().toString() + Math.random().toString(36).substring(7);
          const invoiceRecord = {
              id: invoiceId,
              date: receipt.date,
              supplier: receipt.account || receipt.payee || 'Unassigned Supplier',
              refNo: newInvoice.refNo,
              status: 'Finalized',
              paymentStatus: 'Paid',
              description: `Auto-generated from payment ${receipt.id}`,
              lines: [{ id: Date.now(), account: newInvoice.expenseAccount, gross: gross, vat: vat }],
              totalGross: gross,
              totalVat: vat,
              totalNet: net
          };
          batch.set(doc(firebaseDb, "erp_purchases", invoiceId), invoiceRecord);

          const updatedReceipt = {
              ...receipt,
              linkedInvoiceId: invoiceId,
              category: 'Accounts Payable (Supplier)',
              description: `Linked to Inv/Ref: ${newInvoice.refNo} | ${receipt.description || ''}`
          };
          batch.set(doc(firebaseDb, "erp_receipts", updatedReceipt.id), updatedReceipt);

          await batch.commit();

          if (setDb) setDb(prev => prev.map(r => r.id === updatedReceipt.id ? updatedReceipt : r));
          alert("✅ Invoice successfully created and linked! The VAT and Expense will now correctly appear in your P&L and VAT reports.");
          setLinkModal(null);
      } catch(err) {
          alert("Database Error: Could not create and link the invoice.");
      }
  };

  const filteredDb = useMemo(() => {
    let result = db.filter(row => !(row.type === 'Transfer' && String(row.description).includes('Auto-Collected')));
    
    if (auditMode) {
      result = result.filter(row => row.type === 'Payment' && !row.linkedInvoiceId && !row.noInvoiceRequired && !(row.description || '').includes('Automated Payment'));
    }

    if (filterDateFrom && filterDateTo) {
       result = result.filter(row => {
         const rDate = new Date(normalizeDate(row.date));
         return rDate >= new Date(normalizeDate(filterDateFrom)) && rDate <= new Date(normalizeDate(filterDateTo));
       });
    }
    if (filterCategory !== 'All') {
      result = result.filter(row => {
         const accInDb = accountsDb.find(a => a.name === row.account);
         return (row.category || (accInDb ? accInDb.category : '')) === filterCategory;
      });
    }
    if (filterType !== 'All') result = result.filter(row => filterType === 'Journal' ? (row.type === 'Journal' || row.type === 'JV') : row.type === filterType);
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(row => (
        String(row.account || '').toLowerCase().includes(term) || String(row.description || '').toLowerCase().includes(term) ||
        String(row.amount || '').includes(term) || String(formatDateToDDMMYYYY(row.date) || '').includes(term) ||
        String(row.type || '').toLowerCase().includes(term) || String(row.fromBank || '').toLowerCase().includes(term) ||
        String(row.toBank || '').toLowerCase().includes(term) || String(row.payee || '').toLowerCase().includes(term)
      ));
    }
    // Enforce strict date descending sort
    return result.sort((a, b) => new Date(normalizeDate(b.date)) - new Date(normalizeDate(a.date)));
  }, [db, searchTerm, filterDateFrom, filterDateTo, filterCategory, filterType, accountsDb, auditMode]);

  const handleExport = (format) => {
    if (filteredDb.length === 0) return alert("No transactions available to export.");
    const headers = ['Date', 'Type & Mode', 'Account Details', 'Particulars', 'Debit (In) £', 'Credit (Out) £'];
    
    const dataRows = filteredDb.map(row => {
      const isJvRow = row.type === 'Journal' || row.type === 'JV';
      const isCompound = isJvRow && row.lines && row.lines.length > 0;
      const accInDb = accountsDb.find(a => a.name === row.account);
      const displayCategory = row.category || (accInDb ? accInDb.category : '');
      
      let accountDetails = '';
      if (row.type === 'Transfer') accountDetails = `${row.fromBank} -> ${row.toBank}`;
      else if (isCompound) accountDetails = `Compound Entry (${row.lines.length} accounts)`;
      else if (isJvRow) accountDetails = `${row.debitAccount} (Dr) -> ${row.creditAccount} (Cr)`;
      else accountDetails = `${row.account} ${row.payee ? `(${row.payee})` : ''} - ${displayCategory}`;
                             
      const typeMode = row.type === 'Transfer' ? 'TRANSFER' : isJvRow ? 'JV' : `${row.type.toUpperCase()} (${row.mode}${row.bankName ? ` - ${row.bankName}` : ''})`;
      
      const amt = Number(row.amount);
      const debitVal = (row.type === 'Receipt' || row.type === 'Transfer' || isJvRow) ? fmtMoney(amt) : '-';
      const creditVal = (row.type === 'Payment' || row.type === 'Transfer' || isJvRow) ? fmtMoney(amt) : '-';

      return [formatDateToDDMMYYYY(row.date), typeMode, accountDetails, row.description || 'Compound Journal', debitVal, creditVal];
    });

    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 8px; }</style></head><body><table><tr><td colspan="6" style="font-size: 18px; font-weight: bold; border: none;">Ali's Kitchen</td></tr><tr><td colspan="6" style="font-size: 14px; font-weight: bold; border: none;">${auditMode ? 'AUDIT: Unlinked Manual Payments' : 'Receipts & Payments Log'}</td></tr><tr><td colspan="6" style="font-size: 12px; color: #555; border: none;">Period: ${formatDateToDDMMYYYY(filterDateFrom)} to ${formatDateToDDMMYYYY(filterDateTo)} | Filter: ${filterCategory} | Type: ${filterType === 'Journal' ? 'JV' : filterType}</td></tr><tr><td colspan="6" style="border: none;"></td></tr><tr>`;
      headers.forEach((h, i) => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold; ${i >= 4 ? 'text-align: right;' : 'text-align: left;'}">${h}</th>`; }); html += `</tr>`;
      dataRows.forEach(row => { html += `<tr>`; row.forEach((val, idx) => { html += `<td style="border: 1px solid #cbd5e1; padding: 8px; ${idx >= 4 ? 'text-align: right;' : 'text-align: left;'}">${val}</td>`; }); html += `</tr>`; }); html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `Receipts_Payments_${formatDateToDDMMYYYY(filterDateFrom).replace(/\//g,'-')}.xls`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } else if (format === 'pdf') {
      const doc = new jsPDF('l', 'pt', 'a4'); doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text("Ali's Kitchen", 40, 40); doc.setFontSize(14); doc.text(auditMode ? "AUDIT: Unlinked Manual Payments" : "Receipts & Payments Log", 40, 60); doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(`Period: ${formatDateToDDMMYYYY(filterDateFrom)} to ${formatDateToDDMMYYYY(filterDateTo)} | Filter: ${filterCategory} | Type: ${filterType === 'Journal' ? 'JV' : filterType}`, 40, 75);
      autoTable(doc, { startY: 90, head: [headers], body: dataRows, theme: 'grid', headStyles: { fillColor: [15, 23, 42], fontSize: 10, cellPadding: 6 }, styles: { fontSize: 9, cellPadding: 6 }, columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } }});
      doc.save(`Receipts_Payments_${formatDateToDDMMYYYY(filterDateFrom).replace(/\//g,'-')}.pdf`);
    }
  };

  const isReceipt = formData.type === 'Receipt'; const isPayment = formData.type === 'Payment'; const isTransfer = formData.type === 'Transfer'; const isJournal = formData.type === 'Journal';
  const activeHeaderBg = isReceipt ? sheetTheme.headerGreenBg : isPayment ? sheetTheme.headerRedBg : isTransfer ? sheetTheme.headerBlueBg : sheetTheme.headerPurpleBg;
  const activeHeaderText = isReceipt ? sheetTheme.headerGreenText : isPayment ? sheetTheme.headerRedText : isTransfer ? sheetTheme.headerBlueText : sheetTheme.headerPurpleText;
  const activeSubmitColor = isReceipt ? '#059669' : isPayment ? '#dc2626' : isTransfer ? '#2563eb' : '#7e22ce';

  const currentDebitTot = (formData.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const currentCreditTot = (formData.lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0);

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#ffffff', minHeight: '100vh', color: '#000' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Receipts & Payments Financial Log</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Record manual cash, bank transactions, inter-bank transfers, and journal vouchers.</p>
          </div>
          <button 
             onClick={() => setAuditMode(!auditMode)} 
             style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: auditMode ? '#dc2626' : '#fff', color: auditMode ? '#fff' : '#dc2626', border: `2px solid #dc2626`, borderRadius: '6px', fontSize: '13px', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}>
             <AlertTriangle size={16} />
             {auditMode ? 'Exit Audit Mode' : 'Audit: Missing Invoices'}
          </button>
        </div>

        {/* MODALS */}
        {showCatModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: '#fff', width: '400px', borderRadius: '0', border: `1px solid ${sheetTheme.border}`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}`, background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New Category</h2><button onClick={() => {setShowCatModal(false); setPendingJvLineIndex(null);}} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: sheetTheme.headerBlueText }}>✖</button></div>
              <form onSubmit={handleSaveCategory} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: sheetTheme.font }}>
                <div><label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Category Name</label><input type="text" value={newCatData.name} onChange={e => setNewCatData({...newCatData, name: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, boxSizing: 'border-box' }} required autoFocus /></div>
                <div><label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Financial Type</label><select value={newCatData.type} onChange={e => setNewCatData({...newCatData, type: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, boxSizing: 'border-box' }} required><option value="Expense">Expense</option><option value="Income">Income</option><option value="Asset">Asset</option><option value="Liability">Liability</option><option value="Equity">Equity</option></select></div>
                <button type="submit" style={{ padding: '10px', background: '#0369a1', color: '#fff', fontWeight: '700', border: 'none', cursor: 'pointer', fontSize: '13px' }}>Save Category</button>
              </form>
            </div>
          </div>
        )}
        {showAccModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: '#fff', width: '400px', borderRadius: '0', border: `1px solid ${sheetTheme.border}`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}`, background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New Ledger Account</h2><button onClick={() => {setShowAccModal(false); setPendingJvLineIndex(null);}} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: sheetTheme.headerBlueText }}>✖</button></div>
              <form onSubmit={handleSaveAccount} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: sheetTheme.font }}>
                <div><label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Account / Ledger Name</label><input type="text" value={newAccData.name} onChange={e => setNewAccData({...newAccData, name: e.target.value})} placeholder="e.g. British Gas" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, boxSizing: 'border-box' }} required autoFocus /></div>
                <div><label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Account Category</label><select value={newAccData.category} onChange={(e) => { if (e.target.value === 'ADD_NEW_CAT') setShowCatModal(true); else setNewAccData({ ...newAccData, category: e.target.value }); }} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, boxSizing: 'border-box' }} required><option value="">-- Select Category --</option>{allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}<option value="ADD_NEW_CAT" style={{ fontWeight: '700', color: '#0369a1' }}>➕ Add New Category...</option></select></div>
                <button type="submit" disabled={isSavingAcc} style={{ padding: '10px', background: isSavingAcc ? '#94a3b8' : '#0369a1', color: '#fff', fontWeight: '700', border: 'none', cursor: isSavingAcc ? 'not-allowed' : 'pointer', fontSize: '13px' }}>{isSavingAcc ? 'Saving...' : 'Save & Sync to Cloud'}</button>
              </form>
            </div>
          </div>
        )}
        
        {/* LINK INVOICE MODAL */}
        {linkModal && !linkModal.isLoading && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.8)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: '#fff', width: '600px', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', fontFamily: sheetTheme.font, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
              <div style={{ padding: '16px 20px', background: '#059669', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><LinkIcon size={18} /><h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Link Payment to Invoice</h2></div>
                <button onClick={() => setLinkModal(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#fff' }}>✖</button>
              </div>
              
              <div style={{ display: 'flex', background: '#f8fafc', borderBottom: `1px solid ${sheetTheme.border}` }}>
                  <button onClick={() => setLinkModal({...linkModal, tab: 'match'})} style={{ flex: 1, padding: '12px', fontWeight: '700', fontSize: '13px', background: linkModal.tab === 'match' ? '#fff' : 'transparent', color: linkModal.tab === 'match' ? '#059669' : '#64748b', border: 'none', borderBottom: linkModal.tab === 'match' ? `2px solid #059669` : 'none', cursor: 'pointer' }}><Search size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }}/> Match Pending Invoice</button>
                  <button onClick={() => setLinkModal({...linkModal, tab: 'create'})} style={{ flex: 1, padding: '12px', fontWeight: '700', fontSize: '13px', background: linkModal.tab === 'create' ? '#fff' : 'transparent', color: linkModal.tab === 'create' ? '#059669' : '#64748b', border: 'none', borderBottom: linkModal.tab === 'create' ? `2px solid #059669` : 'none', cursor: 'pointer' }}><Plus size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }}/> Create New Invoice</button>
              </div>
              
              <div style={{ padding: '20px', overflowY: 'auto' }}>
                  <div style={{ background: '#f1f5f9', padding: '12px', borderRadius: '6px', border: `1px solid ${sheetTheme.border}`, marginBottom: '16px' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Unlinked Payment Details:</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>Payment of <strong style={{ color: '#dc2626' }}>£{fmtMoney(linkModal.receipt.amount)}</strong> on {formatDateToDDMMYYYY(linkModal.receipt.date)}</div>
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>Current Account: {linkModal.receipt.account} {linkModal.receipt.payee ? `(${linkModal.receipt.payee})` : ''}</div>
                  </div>

                  {linkModal.tab === 'match' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <input type="text" placeholder="Search pending invoices..." value={linkModal.searchStr} onChange={e => setLinkModal({...linkModal, searchStr: e.target.value})} style={{ width: '50%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', fontSize: '13px' }} />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600', color: '#475569' }}>
                              <input type="checkbox" checked={linkModal.showAll} onChange={(e) => setLinkModal({...linkModal, showAll: e.target.checked})} /> Show all pending invoices
                          </label>
                      </div>
                      <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', maxHeight: '300px', overflowY: 'auto' }}>
                          {linkModal.unpaidInvoices.filter(inv => {
                              const matchSearch = (String(inv.totalGross).includes(linkModal.searchStr) || String(inv.date).includes(linkModal.searchStr) || String(inv.supplier).toLowerCase().includes(linkModal.searchStr.toLowerCase()) || String(inv.refNo).toLowerCase().includes(linkModal.searchStr.toLowerCase()));
                              const possibleMatch = linkModal.showAll || (inv.supplier === linkModal.receipt.account || inv.supplier === linkModal.receipt.payee || Number(inv.totalGross) === Number(linkModal.receipt.amount));
                              return matchSearch && possibleMatch;
                          }).length === 0 ? (
                              <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                                  {linkModal.showAll ? "No unpaid invoices found in the system." : "No matching unpaid invoices found for this amount or supplier. Check 'Show all pending invoices'."}
                              </div>
                          ) : (
                              linkModal.unpaidInvoices.filter(inv => {
                                  const matchSearch = (String(inv.totalGross).includes(linkModal.searchStr) || String(inv.date).includes(linkModal.searchStr) || String(inv.supplier).toLowerCase().includes(linkModal.searchStr.toLowerCase()) || String(inv.refNo).toLowerCase().includes(linkModal.searchStr.toLowerCase()));
                                  const possibleMatch = linkModal.showAll || (inv.supplier === linkModal.receipt.account || inv.supplier === linkModal.receipt.payee || Number(inv.totalGross) === Number(linkModal.receipt.amount));
                                  return matchSearch && possibleMatch;
                              }).map(inv => (
                                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                                      <div>
                                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>£{fmtMoney(inv.totalGross)} <span style={{ color: '#64748b', fontWeight: '400', fontSize: '12px' }}>on {formatDateToDDMMYYYY(inv.date)}</span></div>
                                          <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{inv.supplier} | Ref: {inv.refNo}</div>
                                      </div>
                                      <button type="button" onClick={() => handleLinkToInvoice(inv)} style={{ padding: '6px 12px', background: '#e2e8f0', color: '#0f172a', fontWeight: '700', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Link</button>
                                  </div>
                              ))
                          )}
                      </div>
                    </>
                  )}

                  {linkModal.tab === 'create' && (
                      <form onSubmit={handleCreateAndLinkInvoice} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div>
                              <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Supplier / Vendor</label>
                              <input type="text" value={linkModal.receipt.account || linkModal.receipt.payee} disabled style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', background: '#f1f5f9', color: '#64748b', fontWeight: '600' }} />
                          </div>
                          <div>
                              <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Expense Account</label>
                              <select value={linkModal.newInvoice.expenseAccount} onChange={e => setLinkModal({...linkModal, newInvoice: {...linkModal.newInvoice, expenseAccount: e.target.value}})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', background: '#fff' }} required>
                                  <option value="">-- Choose Expense Account --</option>
                                  {allCategories.filter(c => c.toLowerCase().includes('expense') || c.toLowerCase().includes('cogs') || c.toLowerCase().includes('cost')).map(cat => {
                                      const accsInCat = allAccountsSorted.filter(a => a.category === cat);
                                      if (accsInCat.length === 0) return null;
                                      return (<optgroup key={cat} label={`📂 ${cat}`}>{accsInCat.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</optgroup>);
                                  })}
                              </select>
                          </div>
                          <div style={{ display: 'flex', gap: '16px' }}>
                              <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Invoice Ref #</label>
                                  <input type="text" value={linkModal.newInvoice.refNo} onChange={e => setLinkModal({...linkModal, newInvoice: {...linkModal.newInvoice, refNo: e.target.value}})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box' }} required />
                              </div>
                              <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>VAT Amount (£)</label>
                                  <input type="number" step="any" value={linkModal.newInvoice.vatAmount} onChange={e => setLinkModal({...linkModal, newInvoice: {...linkModal.newInvoice, vatAmount: e.target.value}})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', fontWeight: '700', color: '#dc2626' }} placeholder="0.00" />
                              </div>
                              <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Total Gross (£)</label>
                                  <input type="text" value={fmtMoney(linkModal.receipt.amount)} disabled style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', background: '#f1f5f9', color: '#059669', fontWeight: '800' }} />
                              </div>
                          </div>
                          <div style={{ marginTop: '8px', display: 'flex', gap: '12px' }}>
                              <button type="button" onClick={() => setLinkModal(null)} style={{ flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', fontWeight: '700', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                              <button type="submit" style={{ flex: 2, padding: '12px', background: '#059669', color: '#fff', fontWeight: '700', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Generate & Link Invoice</button>
                          </div>
                      </form>
                  )}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', border: `1px solid ${sheetTheme.border}`, marginBottom: '20px' }}>
          <button type="button" onClick={() => setFormData(prev => ({ ...prev, type: 'Payment' }))} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: isPayment ? sheetTheme.headerRedBg : '#fff', color: isPayment ? sheetTheme.headerRedText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><ArrowUpCircle size={16} /> PAYMENT</button>
          <button type="button" onClick={() => setFormData(prev => ({ ...prev, type: 'Receipt' }))} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: isReceipt ? sheetTheme.headerGreenBg : '#fff', color: isReceipt ? sheetTheme.headerGreenText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><ArrowDownCircle size={16} /> RECEIPT</button>
          <button type="button" onClick={() => setFormData(prev => ({ ...prev, type: 'Transfer' }))} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: isTransfer ? sheetTheme.headerBlueBg : '#fff', color: isTransfer ? sheetTheme.headerBlueText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><ArrowRightLeft size={16} /> TRANSFER</button>
          <button type="button" onClick={() => setFormData(prev => ({ ...prev, type: 'Journal' }))} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: isJournal ? sheetTheme.headerPurpleBg : '#fff', color: isJournal ? sheetTheme.headerPurpleText : '#6b7280', border: 'none', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><BookOpen size={16} /> JV</button>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '40px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: isJournal ? '16px' : '0' }}>
            <thead><tr><th colSpan="2" style={{ background: activeHeaderBg, color: activeHeaderText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>{formData.type === 'Journal' ? 'COMPOUND JV' : formData.type.toUpperCase()} DETAILS</th></tr></thead>
            <tbody>
              <tr><td style={labelTd}>Date</td><td style={inputTd}><CellInput type="date" name="date" value={formData.date} onChange={handleChange} onKeyDown={handleKeyDown} required /></td></tr>
              
              {(!isTransfer && !isJournal) && (
                <>
                  <tr><td style={labelTd}>Mode of Transaction</td><td style={{...inputTd, padding: '8px 12px', background: '#fff'}}><div style={{ display: 'flex', gap: '16px' }}><label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}><input type="radio" name="mode" value="Cash" checked={formData.mode === 'Cash'} onChange={handleChange} /> Cash</label><label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}><input type="radio" name="mode" value="Bank" checked={formData.mode === 'Bank'} onChange={handleChange} /> Bank</label></div></td></tr>
                  {formData.mode === 'Bank' && (<tr><td style={labelTd}>Bank Account</td><td style={inputTd}><CellSelect name="bankName" value={formData.bankName} onChange={handleChange} onKeyDown={handleKeyDown} required><option value="">-- Choose Bank --</option>{bankAccounts.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}</CellSelect></td></tr>)}
                  <tr><td style={labelTd}>1. Specific Ledger Account</td><td style={inputTd}><CellSelect name="account" value={formData.account} onChange={handleAccountSelect} onKeyDown={handleKeyDown} required><option value="">-- Choose Account --</option>{allCategories.map(cat => { const accsInCat = allAccountsSorted.filter(a => a.category === cat); if (accsInCat.length === 0) return null; return (<optgroup key={cat} label={`📂 ${cat}`}>{accsInCat.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</optgroup>); })}<option value="ADD_NEW_ACC" style={{ fontWeight: '700', color: '#0369a1' }}>➕ Add New Account...</option></CellSelect></td></tr>
                  <tr>
                    <td style={labelTd}>2. Account Category</td>
                    <td style={inputTd}>
                      <CellSelect name="category" value={formData.category} onChange={handleChange} onKeyDown={handleKeyDown} required>
                        <option value="">-- Choose Category --</option>
                        {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </CellSelect>
                    </td>
                  </tr>
                  <tr>
                    <td style={labelTd}>Payee / Supplier (Optional)</td>
                    <td style={inputTd}>
                      <input 
                        list="payee-list"
                        name="payee" 
                        value={formData.payee || ''} 
                        onChange={handleChange} 
                        onKeyDown={handleKeyDown} 
                        placeholder="Type name if you want this to show in P&L sub-groups..."
                        style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent' }} 
                      />
                      <datalist id="payee-list">
                        {allAccountsSorted.map(s => <option key={s.id} value={s.name}>{s.name} ({s.category})</option>)}
                      </datalist>
                    </td>
                  </tr>
                </>
              )}

              {isTransfer && (
                <>
                  <tr><td style={labelTd}>From Bank (Money Out)</td><td style={inputTd}><CellSelect name="fromBank" value={formData.fromBank} onChange={handleChange} onKeyDown={handleKeyDown} textColor="#dc2626" required><option value="">-- Select Source Bank --</option>{bankAccounts.map(b => <option key={`from-${b.id}`} value={b.name}>{b.name}</option>)}</CellSelect></td></tr>
                  <tr><td style={labelTd}>To Bank (Money In)</td><td style={inputTd}><CellSelect name="toBank" value={formData.toBank} onChange={handleChange} onKeyDown={handleKeyDown} textColor="#059669" required><option value="">-- Select Destination Bank --</option>{bankAccounts.map(b => <option key={`to-${b.id}`} value={b.name}>{b.name}</option>)}</CellSelect></td></tr>
                </>
              )}

              {/* ONLY RENDER AMOUNT & DESC IF NOT A JOURNAL */}
              {!isJournal && (
                <>
                  <tr><td style={labelTd}>{isTransfer ? 'Transfer Amount (£)' : 'Gross Amount (£)'}</td><td style={{...inputTd, background: activeHeaderBg}}><CellInput type="number" step="any" name="amount" value={formData.amount} onChange={handleChange} onKeyDown={handleKeyDown} placeholder="0.00" align="left" required /></td></tr>
                  <tr><td style={labelTd}>Particulars / Description</td><td style={inputTd}><CellInput type="text" name="description" value={formData.description} onChange={handleChange} onKeyDown={handleKeyDown} placeholder="e.g. Reference number or detail" required /></td></tr>
                  
                  {isPayment && (
                    <tr>
                      <td style={labelTd}>Audit Exemption</td>
                      <td style={{...inputTd, padding: '8px 12px', background: '#f0fdf4'}}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: '700', color: '#166534' }}>
                          <input type="checkbox" name="noInvoiceRequired" checked={formData.noInvoiceRequired || false} onChange={handleChange} style={{ cursor: 'pointer' }} />
                          ☑️ No Formal Invoice Required (e.g. Bank Charge / Direct Debit)
                        </label>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>

          {/* MULTI-LINE COMPOUND JV GRID */}
          {isJournal && (
            <div style={{ border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                <CellInput type="text" name="description" value={formData.description} onChange={handleChange} onKeyDown={handleKeyDown} placeholder="General JV Description / Memo (Required)" required />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#374151', textTransform: 'uppercase' }}>
                  <tr>
                    <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '35%', textAlign: 'left' }}>Ledger Account</th>
                    <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '25%', textAlign: 'left' }}>Line Memo</th>
                    <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '15%', textAlign: 'right' }}>Debit (£)</th>
                    <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '15%', textAlign: 'right' }}>Credit (£)</th>
                    <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '10%', textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(formData.lines || []).map((line, idx) => (
                    <tr key={line.id || idx}>
                      <td style={{ padding: 0, border: `1px solid ${sheetTheme.border}` }}>
                        <CellSelect 
                            value={line.account} 
                            onChange={e => {
                                if (e.target.value === 'ADD_NEW_ACC') {
                                    setPendingJvLineIndex(idx);
                                    setNewAccData({ name: '', category: '' });
                                    setShowAccModal(true);
                                } else {
                                    handleJvLine(idx, 'account', e.target.value);
                                }
                            }} 
                            onKeyDown={handleKeyDown}
                        >
                          <option value="">-- Choose Account --</option>
                          {allCategories.map(cat => {
                             const accsInCat = allAccountsSorted.filter(a => a.category === cat);
                             if (accsInCat.length === 0) return null;
                             return (<optgroup key={cat} label={`📂 ${cat}`}>{accsInCat.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</optgroup>);
                          })}
                          <option value="ADD_NEW_ACC" style={{ fontWeight: '700', color: '#0369a1' }}>➕ Add New Account...</option>
                        </CellSelect>
                      </td>
                      <td style={{ padding: 0, border: `1px solid ${sheetTheme.border}` }}><CellInput type="text" value={line.description || ''} onChange={e => handleJvLine(idx, 'description', e.target.value)} onKeyDown={handleKeyDown} placeholder="Optional line memo" /></td>
                      <td style={{ padding: 0, border: `1px solid ${sheetTheme.border}` }}><CellInput type="number" step="any" value={line.debit || ''} onChange={e => handleJvLine(idx, 'debit', e.target.value)} onKeyDown={handleKeyDown} placeholder="0.00" align="right" textColor="#059669" /></td>
                      <td style={{ padding: 0, border: `1px solid ${sheetTheme.border}` }}><CellInput type="number" step="any" value={line.credit || ''} onChange={e => handleJvLine(idx, 'credit', e.target.value)} onKeyDown={handleKeyDown} placeholder="0.00" align="right" textColor="#dc2626" /></td>
                      <td style={{ padding: '0', border: `1px solid ${sheetTheme.border}`, textAlign: 'center' }}>
                        <button type="button" onClick={() => removeJvLine(idx)} style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan="5" style={{ padding: '6px 0', borderLeft: `1px solid ${sheetTheme.border}`, borderRight: `1px solid ${sheetTheme.border}` }}>
                      <button type="button" onClick={addJvLine} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '98%', margin: '0 auto', padding: '8px', background: 'transparent', color: '#7e22ce', border: `1px dashed ${sheetTheme.border}`, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><Plus size={14} /> Add JV Line</button>
                    </td>
                  </tr>
                  <tr style={{ background: '#f1f5f9' }}>
                    <td colSpan="2" style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#333' }}>JV TOTALS:</td>
                    <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#059669' }}>£ {fmtMoney(currentDebitTot)}</td>
                    <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#dc2626' }}>£ {fmtMoney(currentCreditTot)}</td>
                    <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'center', fontSize: '12px', fontWeight: '800', color: Math.abs(currentDebitTot - currentCreditTot) > 0.01 ? '#dc2626' : '#059669' }}>
                      {Math.abs(currentDebitTot - currentCreditTot) > 0.01 ? 'Unbalanced' : '✓ Balanced'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button type="button" onClick={() => setFormData({ ...initialForm, lines: [{ id: Date.now(), account: '', debit: '', credit: '', description: '' }, { id: Date.now() + 1, account: '', debit: '', credit: '', description: '' }] })} style={{ padding: '8px 24px', background: '#f3f4f6', color: '#374151', fontSize: '13px', fontWeight: '700', border: `1px solid ${sheetTheme.border}`, cursor: 'pointer' }}>{formData.id ? 'Cancel Edit' : 'Cancel'}</button>
            <button type="submit" style={{ padding: '8px 32px', background: formData.id ? '#166534' : activeSubmitColor, color: '#fff', fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer' }}>{formData.id ? 'Update Record' : 'Save Record'}</button>
          </div>
        </form>

        {/* LOG TABLE */}
        <div>
          <div style={{ background: sheetTheme.headerBlueBg, padding: '12px', border: `1px solid ${sheetTheme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: sheetTheme.headerBlueText }}>{auditMode ? 'AUDIT: Unlinked Manual Payments' : 'Master Transaction Log'}</h2>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', padding: '4px 8px', border: `1px solid ${sheetTheme.border}` }}><span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>FROM:</span><input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font }} /><span style={{ color: sheetTheme.border }}>|</span><span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>TO:</span><input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font }} /></div>
              {!auditMode && (
                <>
                  <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: `1px solid ${sheetTheme.border}`, padding: '4px 8px', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font, background: '#fff' }}><option value="All">All Types</option><option value="Receipt">Receipts</option><option value="Payment">Payments</option><option value="Transfer">Transfers</option><option value="Journal">JV</option></select>
                  <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ border: `1px solid ${sheetTheme.border}`, padding: '4px 8px', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font, background: '#fff', maxWidth: '150px' }}><option value="All">All Categories</option>{allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}</select>
                </>
              )}
              <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ border: `1px solid ${sheetTheme.border}`, padding: '4px 8px', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font, width: '120px' }} />
              <button onClick={() => handleExport('excel')} style={{ padding: '4px 10px', background: '#10b981', color: '#fff', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Excel</button><button onClick={() => handleExport('pdf')} style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>PDF</button>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto', maxHeight: '500px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px', backgroundColor: '#fff' }}>
              <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#374151', textTransform: 'uppercase', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Date</th><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Type & Mode</th><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Account Details</th><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Particulars</th><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'right' }}>Debit (In) £</th><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'right' }}>Credit (Out) £</th><th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'center' }}>Action</th></tr>
              </thead>
              <tbody>
                {filteredDb.length === 0 ? (<tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>No transactions match your search or filters.</td></tr>) : (
                  filteredDb.map((row) => {
                    const isJvRow = row.type === 'Journal' || row.type === 'JV'; 
                    const isCompound = isJvRow && row.lines && row.lines.length > 0;
                    const accInDb = accountsDb.find(a => a.name === row.account);
                    const displayCategory = row.category || (accInDb ? accInDb.category : '');
                    
                    const isMissingInvoice = row.type === 'Payment' && !row.linkedInvoiceId && !row.noInvoiceRequired && !(row.description || '').includes('Automated Payment');
                    const isLinked = row.linkedInvoiceId;

                    return (
                      <tr key={row.id} style={{ background: auditMode ? '#fef2f2' : '#fff' }}>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '600' }}>{formatDateToDDMMYYYY(row.date)}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px' }}>
                          <div style={{ fontWeight: '700', color: row.type === 'Receipt' ? '#059669' : row.type === 'Payment' ? '#dc2626' : isJvRow ? '#7e22ce' : '#2563eb' }}>
                              {isJvRow ? 'JV' : row.type.toUpperCase()}
                              {isMissingInvoice && <span title="Missing linked purchase invoice" style={{marginLeft: '6px', fontSize: '14px'}}>⚠️</span>}
                              {isLinked && <span title="Linked to Purchase Invoice" style={{marginLeft: '6px', fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '4px', fontWeight: '800'}}>🔗 Linked</span>}
                          </div>
                          {(row.type !== 'Transfer' && !isJvRow) && (
                              <div style={{ color: '#6b7280' }}>
                                  {row.mode} {row.bankName ? `(${row.bankName})` : ''} 
                                  {row.noInvoiceRequired && <span style={{ color: '#0369a1', fontSize: '10px', marginLeft: '4px', fontWeight: '800' }}>(Exempt)</span>}
                              </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px' }}>
                          <div style={{ fontWeight: '700', color: '#1f2937' }}>
                            {row.type === 'Transfer' ? `${row.fromBank} ➔ ${row.toBank}` : isCompound ? `Compound Entry (${row.lines.length} lines)` : isJvRow ? `${row.debitAccount} (Dr) ➔ ${row.creditAccount} (Cr)` : `${row.account} ${row.payee ? `(${row.payee})` : ''}`}
                          </div>
                          {(row.type !== 'Transfer' && !isJvRow) && <div style={{ fontSize: '11px', color: '#6b7280' }}>{displayCategory}</div>}
                        </td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', color: '#374151' }}>{row.description || (isCompound ? 'Compound Journal' : '')}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#059669' }}>{row.type === 'Receipt' || row.type === 'Transfer' || isJvRow ? `${fmtMoney(row.amount)}` : '-'}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{row.type === 'Payment' || row.type === 'Transfer' || isJvRow ? `${fmtMoney(row.amount)}` : '-'}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'center' }}>
                          {isMissingInvoice && (
                              <button onClick={() => openLinkModal(row)} style={{ background: 'transparent', color: '#10b981', border: 'none', cursor: 'pointer', marginRight: '6px' }} title="Link to Pending Invoice">
                                <LinkIcon size={14} />
                              </button>
                          )}
                          {isLinked && (
                              <button onClick={() => handleUnlink(row)} style={{ background: 'transparent', color: '#d97706', border: 'none', cursor: 'pointer', marginRight: '6px' }} title="Unlink from Invoice (Admin/Owner Only)">
                                <Unlink size={14} />
                              </button>
                          )}
                          <button onClick={() => handleEdit(row)} style={{ background: 'transparent', color: '#0369a1', border: 'none', cursor: 'pointer', marginRight: '6px' }} title="Edit"><Edit2 size={14} /></button>
                          <button onClick={() => handleDelete(row.id)} style={{ background: 'transparent', color: '#dc2626', border: 'none', cursor: 'pointer' }} title="Delete"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}