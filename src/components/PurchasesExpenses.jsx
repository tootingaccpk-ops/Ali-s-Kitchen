import React, { useState, useMemo, useRef, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, addDoc } from "firebase/firestore";
import { db as firebaseDb } from "../firebase"; 
import { ShoppingCart, Plus, Trash2, Edit2, FileText, X, Search, FileSpreadsheet, Wallet, Link as LinkIcon, PlusCircle, Unlink } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const isAdmin = true; 

const getToday = () => {
  const ukTime = new Date().toLocaleString("en-US", { timeZone: "Europe/London" });
  const d = new Date(ukTime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const toDateNum = (dStr) => {
  if(!dStr) return 0;
  let str = String(dStr).replace(/\//g, '-');
  let p = str.split('-');
  if(p.length === 3) {
    let y = p[0].length === 4 ? p[0] : (p[2].length === 2 ? '20'+p[2] : p[2]);
    let m = p[0].length === 4 ? p[1] : p[1];
    let d = p[0].length === 4 ? p[2] : p[0];
    return parseInt(`${y}${m.padStart(2,'0')}${d.padStart(2,'0')}`);
  }
  return 0;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  let str = String(dateStr).replace(/\//g, '-');
  let p = str.split('-');
  if(p.length === 3) {
    let y = p[0].length === 4 ? p[0] : (p[2].length === 2 ? '20'+p[2] : p[2]);
    let m = p[0].length === 4 ? p[1] : p[1];
    let d = p[0].length === 4 ? p[2] : p[0];
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  return dateStr;
};

const fmtMoney = (n) => {
  if (n === '' || n === null || n === undefined) return '';
  const num = Number(n);
  if (isNaN(num)) return n;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getEmptyLine = () => ({ id: Date.now() + Math.random(), account: '', gross: '', vat: '' });

const getInitialForm = () => ({
  id: '', date: getToday(), supplier: '', refNo: '', status: 'Finalized', paymentStatus: 'Unpaid', description: '', lines: [getEmptyLine()]
});

const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerOrangeBg: '#ffedd5', headerOrangeText: '#c2410c',
};

const labelTd = { border: `1px solid ${sheetTheme.border}`, padding: '8px 12px', fontSize: '13px', color: '#333', background: sheetTheme.labelBg, whiteSpace: 'nowrap', width: '30%', fontWeight: '600' };
const inputTd = { border: `1px solid ${sheetTheme.border}`, padding: '0', background: '#fff', width: '70%' };

const CellInput = ({ name, value, onChange, onKeyDown, type="number", placeholder="", align="right", inputRef=null, textColor="#000" }) => {
  const [isFocused, setIsFocused] = useState(false);
  
  const isNumeric = type === "number";
  const displayValue = (isNumeric && !isFocused && value !== '') ? fmtMoney(value) : value;
  const inputType = (isNumeric && !isFocused) ? "text" : type;

  return (
    <input
      ref={inputRef} 
      type={inputType} 
      name={name} 
      value={displayValue} 
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={onChange} 
      onKeyDown={onKeyDown} 
      placeholder={placeholder}
      step={isNumeric ? "any" : undefined}
      style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: align, outline: 'none', background: 'transparent', color: textColor }}
    />
  );
};

export default function PurchasesExpenses({ db = [], setDb, accountsDb = [], setAccountsDb }) {
  const displayDb = db.length > 0 ? db : (JSON.parse(localStorage.getItem('erp_purchases')) || []);
  const [formData, setFormData] = useState(getInitialForm());
  const [activeModal, setActiveModal] = useState(null); 
  const [paymentModal, setPaymentModal] = useState(null);
  
  const [newLedgerName, setNewLedgerName] = useState('');
  const [newLedgerCategory, setNewLedgerCategory] = useState('');
  const dateInputRef = useRef(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  const bankAccounts = accountsDb.filter(acc => { const cat = String(acc.category || '').toLowerCase(); return cat.includes('bank') || cat.includes('cash') || cat.includes('safe') || cat.includes('till'); }).sort((a, b) => a.name.localeCompare(b.name));
  
  const allCategories = useMemo(() => {
    const baseCats = ["Accounts Payable (Supplier)", "Cost of Goods Sold (COGS)", "Operating Expenses", "Fixed Assets", "Tax Liability / Asset"];
    const currentCats = accountsDb.map(a => (a.category || '').trim()).filter(Boolean);
    return Array.from(new Set([...baseCats, ...currentCats])).sort((a, b) => a.localeCompare(b));
  }, [accountsDb]);

  const allAccountsSorted = useMemo(() => {
    return [...accountsDb].sort((a, b) => a.name.localeCompare(b.name));
  }, [accountsDb]);

  useEffect(() => {
    const migratePurchasesToFirebase = async () => {
      const localData = JSON.parse(localStorage.getItem('erp_purchases'));
      const isMigrated = localStorage.getItem('erp_purchases_migrated');
      
      if (localData && Array.isArray(localData) && localData.length > 0 && !isMigrated) {
        try {
          const batch = writeBatch(firebaseDb);
          localData.forEach(record => {
            const recordId = record.id || Date.now().toString() + Math.random().toString(36).substring(7);
            const docRef = doc(firebaseDb, "erp_purchases", recordId);
            batch.set(docRef, { ...record, id: recordId });
          });
          await batch.commit();
          localStorage.setItem('erp_purchases_migrated', 'true');
        } catch (error) {
          console.error("Migration failed: ", error);
        }
      }
    };
    migratePurchasesToFirebase();
  }, []);

  const purchasesAccounts = accountsDb.filter(acc => String(acc.category).toLowerCase().includes('cost of goods sold') || String(acc.category).toLowerCase().includes('cogs') || String(acc.category).toLowerCase().includes('purchase')).sort((a, b) => a.name.localeCompare(b.name));
  const expenseAccounts = accountsDb.filter(acc => String(acc.category).toLowerCase().includes('operating expense') || String(acc.category).toLowerCase().includes('expense') && !String(acc.category).toLowerCase().includes('cogs')).sort((a, b) => a.name.localeCompare(b.name));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const form = e.target.form;
      if (form) {
        const focusable = Array.from(form.elements).filter(el => el.tagName === 'INPUT' || el.tagName === 'SELECT' || (el.tagName === 'BUTTON' && el.type === 'submit'));
        const index = focusable.indexOf(e.target);
        if (index > -1 && focusable[index + 1]) focusable[index + 1].focus();
      }
    }
  };

  const handleHeaderChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleLineChange = (index, field, value) => {
    setFormData(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addLine = () => {
    setFormData(prev => ({ ...prev, lines: [...prev.lines, getEmptyLine()] }));
  };

  const removeLine = (index) => {
    setFormData(prev => {
      const newLines = [...prev.lines];
      newLines.splice(index, 1);
      if (newLines.length === 0) newLines.push(getEmptyLine());
      return { ...prev, lines: newLines };
    });
  };

  const totals = formData.lines.reduce((acc, line) => {
    const g = Number(line.gross) || 0;
    const v = Number(line.vat) || 0;
    acc.gross += g;
    acc.vat += v;
    acc.net += (g - v);
    return acc;
  }, { gross: 0, vat: 0, net: 0 });

  const handleCancel = () => {
    setFormData(getInitialForm());
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { if(dateInputRef.current) dateInputRef.current.focus(); }, 50);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const supplierName = (formData.supplier || '').trim().toLowerCase();
    const conflictingAccount = accountsDb.find(a => 
      a.name.toLowerCase() === supplierName && 
      !String(a.category).toLowerCase().includes('payable') && 
      !String(a.category).toLowerCase().includes('supplier')
    );
    
    if (conflictingAccount) {
        return alert(`⚠️ Validation Error:\n\nYou have entered an Accounting Ledger name ("${formData.supplier}") into the Supplier field.\n\nThe Supplier field should be the brand/company name (e.g., 'Amazon'), and the Account field should be the category (e.g., '${formData.supplier}').\n\nPlease swap them!`);
    }

    if (!window.confirm(formData.id ? "Are you sure you want to update this invoice?" : "Are you sure you want to save this invoice?")) return; 
    
    const validLines = formData.lines.filter(l => l.account || l.gross || l.vat);
    const recordId = formData.id || Date.now().toString();
    const invoiceRecord = { 
      ...formData, 
      id: recordId, 
      status: formData.status || 'Finalized',
      paymentStatus: formData.paymentStatus || 'Unpaid',
      lines: validLines.length > 0 ? validLines : [{ account: '', gross: 0, vat: 0 }], 
      totalGross: totals.gross, 
      totalVat: totals.vat, 
      totalNet: totals.net 
    };

    let newDb;
    if (formData.id) {
      newDb = displayDb.map(t => t.id === formData.id ? invoiceRecord : t).sort((a, b) => toDateNum(b.date) - toDateNum(a.date));
    } else {
      newDb = [invoiceRecord, ...displayDb].sort((a, b) => toDateNum(b.date) - toDateNum(a.date));
    }
    
    if (setDb) setDb(newDb);
    
    try {
      await setDoc(doc(firebaseDb, "erp_purchases", recordId), invoiceRecord);
      alert(formData.id ? `✅ Invoice updated successfully!` : `✅ Invoice saved successfully!`);
      setFormData(getInitialForm());
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { if(dateInputRef.current) dateInputRef.current.focus(); }, 50);
    } catch (error) {
      alert("Database Error: Could not save the invoice.");
    }
  };

  const openPaymentModal = async (row) => {
    setPaymentModal({ isLoading: true });
    try {
      const querySnapshot = await getDocs(collection(firebaseDb, "erp_receipts"));
      const receipts = [];
      querySnapshot.forEach((doc) => receipts.push(doc.data()));
      
      const unlinked = receipts.filter(r => r.type === 'Payment' && !r.linkedInvoiceId && !(r.description || '').includes('Automated Payment for Inv/Ref'));
      unlinked.sort((a, b) => new Date(b.date) - new Date(a.date));

      setPaymentModal({
        invoice: row,
        tab: 'link',
        unlinkedReceipts: unlinked,
        searchStr: '',
        showAllUnlinked: false,
        date: getToday(),
        bankName: '',
        amount: row.totalGross,
        isLoading: false
      });
    } catch (error) {
      alert("Failed to load existing payments. Please check connection.");
      setPaymentModal(null);
    }
  };

  const handleLinkPayment = async (receipt) => {
    if (!window.confirm(`Are you sure you want to link the payment of £${receipt.amount} to this invoice?`)) return;

    try {
      const batch = writeBatch(firebaseDb);
      const updatedReceipt = {
          ...receipt,
          linkedInvoiceId: paymentModal.invoice.id,
          account: paymentModal.invoice.supplier || 'Unassigned Supplier',
          category: 'Accounts Payable (Supplier)',
          payee: paymentModal.invoice.supplier || receipt.payee,
          description: `Linked to Inv/Ref: ${paymentModal.invoice.refNo} | ${receipt.description}`
      };
      batch.set(doc(firebaseDb, "erp_receipts", receipt.id), updatedReceipt);

      const updatedInvoice = { ...paymentModal.invoice, paymentStatus: 'Paid' };
      batch.set(doc(firebaseDb, "erp_purchases", updatedInvoice.id), updatedInvoice);
      
      await batch.commit();

      if (setDb) setDb(prev => prev.map(t => t.id === updatedInvoice.id ? updatedInvoice : t));
      alert("✅ Payment successfully linked! The receipt has been re-coded to Accounts Payable to prevent P&L duplication.");
      setPaymentModal(null);
    } catch (err) {
      alert("Database Error: Could not link the payment.");
    }
  };

  const handleRecordNewPayment = async (e) => {
    e.preventDefault();
    if (!paymentModal.bankName) return alert("Please select a bank account.");

    const receiptId = Date.now().toString();
    const receiptRecord = {
        id: receiptId,
        type: 'Payment',
        date: paymentModal.date,
        mode: 'Bank',
        bankName: paymentModal.bankName,
        account: paymentModal.invoice.supplier || 'Unassigned Supplier',
        category: 'Accounts Payable (Supplier)',
        payee: paymentModal.invoice.supplier || '',
        description: `Automated Payment for Inv/Ref: ${paymentModal.invoice.refNo}`,
        amount: Number(paymentModal.amount),
        linkedInvoiceId: paymentModal.invoice.id,
        lines: [{ id: Date.now(), account: '', debit: '', credit: '', description: '' }, { id: Date.now() + 1, account: '', debit: '', credit: '', description: '' }]
    };

    const updatedInvoice = { ...paymentModal.invoice, paymentStatus: 'Paid' };

    try {
        const batch = writeBatch(firebaseDb);
        batch.set(doc(firebaseDb, "erp_receipts", receiptId), receiptRecord);
        batch.set(doc(firebaseDb, "erp_purchases", updatedInvoice.id), updatedInvoice);
        await batch.commit();

        if (setDb) setDb(prev => prev.map(t => t.id === updatedInvoice.id ? updatedInvoice : t));
        alert("✅ New payment recorded successfully!");
        setPaymentModal(null);
    } catch (err) {
        alert("Database Error: Could not record the automated payment.");
    }
  };

  const handleUnlinkPayment = async (invoice) => {
    if (!isAdmin) return alert("Unauthorized: Only Administrators can unlink payments.");
    if (!window.confirm(`Admin Action: Are you sure you want to completely UNLINK the payment for ${invoice.supplier}? The payment will be returned to the Unlinked Audit List.`)) return;

    try {
        const querySnapshot = await getDocs(collection(firebaseDb, "erp_receipts"));
        let linkedReceipt = null;
        querySnapshot.forEach(doc => {
            if(doc.data().linkedInvoiceId === invoice.id) linkedReceipt = doc.data();
        });

        const batch = writeBatch(firebaseDb);
        if (linkedReceipt) {
            const updatedReceipt = { ...linkedReceipt, linkedInvoiceId: null };
            updatedReceipt.description = (updatedReceipt.description || '').replace(`Linked to Inv/Ref: ${invoice.refNo} | `, '').replace(`Automated Payment for Inv/Ref: ${invoice.refNo}`, 'UNLINKED AUTOMATED PAYMENT');
            batch.set(doc(firebaseDb, "erp_receipts", linkedReceipt.id), updatedReceipt);
        }

        const updatedInvoice = { ...invoice, paymentStatus: 'Unpaid' };
        batch.set(doc(firebaseDb, "erp_purchases", invoice.id), updatedInvoice);
        
        await batch.commit();

        if (setDb) setDb(prev => prev.map(t => t.id === invoice.id ? updatedInvoice : t));
        alert("✅ Link severed. Invoice is unpaid, and payment is back in the audit log.");
    } catch(err) {
        alert("Database Error: Could not process unlink action.");
    }
  };

  const handleEdit = (row) => {
    setFormData({ ...row, status: row.status || 'Finalized', lines: row.lines?.length > 0 ? row.lines.map(l => ({ ...l })) : [getEmptyLine()] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this invoice?")) {
      const newDb = displayDb.filter(t => t.id !== id);
      if (setDb) setDb(newDb);
      try { await deleteDoc(doc(firebaseDb, "erp_purchases", id)); } catch (error) { alert("Database Error: Could not delete the invoice."); }
    }
  };

  const handleAddNewLedger = async (e) => {
    e.preventDefault();
    if (!newLedgerName || !newLedgerCategory) return;
    const ledgerNameTrimmed = newLedgerName.trim();
    
    const existingMatch = accountsDb.find(a => a.name.toLowerCase() === ledgerNameTrimmed.toLowerCase());
    if (existingMatch) {
      if (activeModal?.type === 'supplier') { setFormData(prev => ({ ...prev, supplier: existingMatch.name })); } 
      else if (activeModal?.type === 'category' && activeModal.lineIndex !== undefined) { handleLineChange(activeModal.lineIndex, 'account', existingMatch.name); }
      setNewLedgerName(''); setNewLedgerCategory(''); setActiveModal(null);
      return;
    }

    const newLedger = { name: ledgerNameTrimmed, type: newLedgerCategory.includes('Payable') ? 'Liability' : 'Expense', category: newLedgerCategory, balance: 0 };
    
    try {
      const docRef = await addDoc(collection(firebaseDb, "erp_accounts"), newLedger);
      const finalLedger = { id: docRef.id, ...newLedger };
      setAccountsDb(prev => [...prev, finalLedger]);

      if (activeModal?.type === 'supplier') { setFormData(prev => ({ ...prev, supplier: finalLedger.name })); } 
      else if (activeModal?.type === 'category' && activeModal.lineIndex !== undefined) { handleLineChange(activeModal.lineIndex, 'account', finalLedger.name); }
      
      setNewLedgerName(''); setNewLedgerCategory(''); setActiveModal(null);
    } catch (err) {
      alert("Failed to create account in the cloud.");
    }
  };

  const filteredDb = useMemo(() => {
    let result = [...displayDb];
    if (filterStatus === 'Pending') result = result.filter(row => row.status === 'Pending');
    if (filterDateFrom && filterDateTo) result = result.filter(row => { const rDate = toDateNum(row.date); return rDate >= toDateNum(filterDateFrom) && rDate <= toDateNum(filterDateTo); });
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(row => {
        const linesStr = row.lines?.map(l => l.account).join(' ').toLowerCase() || '';
        return (String(row.supplier || '').toLowerCase().includes(term) || String(row.refNo || '').toLowerCase().includes(term) || String(row.description || '').toLowerCase().includes(term) || String(row.totalGross || '').includes(term) || String(formatDate(row.date) || '').includes(term) || linesStr.includes(term));
      });
    }
    // Enforce strict date descending sort (Newest first)
    return result.sort((a, b) => toDateNum(b.date) - toDateNum(a.date));
  }, [displayDb, searchTerm, filterDateFrom, filterDateTo, filterStatus]);

  const handleExport = (format) => {
    if (filteredDb.length === 0) return alert("No invoices available to export.");
    const headers = ['Date', 'Supplier', 'Status', 'Ref #', 'Description', 'Expense Accounts', 'Total VAT (£)', 'Total Gross (£)'];
    const dataRows = filteredDb.map(row => [ formatDate(row.date), row.supplier || 'Unassigned', row.status === 'Pending' ? 'Pending' : 'Finalized', row.refNo || '-', row.description || '-', row.lines?.map(l => l.account).filter(Boolean).join(', ') || 'None', fmtMoney(row.totalVat), fmtMoney(row.totalGross) ]);

    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 8px; }</style></head><body><table><tr><td colspan="8" style="font-size: 18px; font-weight: bold; border: none;">Ali's Kitchen</td></tr><tr><td colspan="8" style="font-size: 14px; font-weight: bold; border: none;">Purchases & Expenses Log</td></tr><tr><td colspan="8" style="font-size: 12px; color: #555; border: none;">Period: ${filterDateFrom ? formatDate(filterDateFrom) : 'All Time'} to ${filterDateTo ? formatDate(filterDateTo) : 'Present'}</td></tr><tr><td colspan="8" style="border: none;"></td></tr><tr>`;
      headers.forEach((h, i) => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold; ${i >= 6 ? 'text-align: right;' : 'text-align: left;'}">${h}</th>`; }); html += `</tr>`;
      dataRows.forEach(row => { html += `<tr>`; row.forEach((val, idx) => { html += `<td style="border: 1px solid #cbd5e1; padding: 8px; ${idx >= 6 ? 'text-align: right;' : 'text-align: left;'}">${val}</td>`; }); html += `</tr>`; }); html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `Purchases_Log.xls`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } else if (format === 'pdf') {
      const doc = new jsPDF('l', 'pt', 'a4'); doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text("Ali's Kitchen", 40, 40); doc.setFontSize(14); doc.text("Purchases & Expenses Log", 40, 60); doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(`Period: ${filterDateFrom ? formatDate(filterDateFrom) : 'All Time'} to ${filterDateTo ? formatDate(filterDateTo) : 'Present'}`, 40, 75);
      autoTable(doc, { startY: 90, head: [headers], body: dataRows, theme: 'grid', headStyles: { fillColor: [15, 23, 42], fontSize: 9, cellPadding: 5 }, styles: { fontSize: 8, cellPadding: 5 }, columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' } } });
      doc.save(`Purchases_Log.pdf`);
    }
  };

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#ffffff', minHeight: '100vh', color: '#000' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Purchases & Expenses Log</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Record formal supplier invoices, pre-payment placeholders, and expense splits.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '40px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
            <thead>
              <tr><th colSpan="2" style={{ background: sheetTheme.headerOrangeBg, color: sheetTheme.headerOrangeText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>INVOICE HEADER</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={labelTd}>Invoice Date</td>
                <td style={inputTd}><CellInput inputRef={dateInputRef} type="date" name="date" value={formData.date} onChange={handleHeaderChange} onKeyDown={handleKeyDown} align="right" required /></td>
              </tr>
              <tr>
                <td style={labelTd}>Invoice Status</td>
                <td style={inputTd}>
                  <select name="status" value={formData.status || 'Finalized'} onChange={handleHeaderChange} onKeyDown={handleKeyDown} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent', fontWeight: '800', color: formData.status === 'Pending' ? '#c2410c' : '#166534' }}>
                    <option value="Finalized">Finalized (Formal Invoice Logged)</option>
                    <option value="Pending">Pending (Awaiting Formal Paperwork)</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Supplier Account</td>
                <td style={inputTd}>
                  <div style={{ display: 'flex' }}>
                    <input 
                      list="supplier-list"
                      name="supplier" 
                      value={formData.supplier} 
                      onChange={handleHeaderChange} 
                      onKeyDown={handleKeyDown} 
                      placeholder="Type any supplier name or select from list..."
                      style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent', color: '#c2410c', fontWeight: '700' }} 
                      required 
                    />
                    <datalist id="supplier-list">
                      {allAccountsSorted.map(s => <option key={s.id} value={s.name}>{s.name} ({s.category})</option>)}
                    </datalist>
                    <button type="button" onClick={() => { setActiveModal({ type: 'supplier' }); setNewLedgerCategory('Accounts Payable (Supplier)'); }} style={{ padding: '0 12px', background: '#f8fafc', color: '#c2410c', borderLeft: `1px solid ${sheetTheme.border}`, borderTop: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', fontWeight: '800' }} title="Add Formal Supplier Ledger"><Plus size={14} /></button>
                  </div>
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Invoice / Ref #</td>
                <td style={inputTd}><CellInput type="text" name="refNo" value={formData.refNo} onChange={handleHeaderChange} onKeyDown={handleKeyDown} placeholder={formData.status === 'Pending' ? "e.g. PENDING PAYMENT" : "e.g. INV-1004"} align="left" required /></td>
              </tr>
              <tr>
                <td style={labelTd}>Description / Notes</td>
                <td style={inputTd}><CellInput type="text" name="description" value={formData.description} onChange={handleHeaderChange} onKeyDown={handleKeyDown} placeholder="Quick note..." align="left" /></td>
              </tr>
            </tbody>
          </table>

          <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '700', color: sheetTheme.headerBlueText }}>INVOICE LINE ITEMS</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginBottom: '16px' }}>
            <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#374151', textTransform: 'uppercase' }}>
              <tr>
                <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '35%' }}>Expense / Purchase Account</th>
                <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '20%', textAlign: 'center' }}>Gross<br/>Amount (£)</th>
                <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '20%', textAlign: 'center' }}>VAT<br/>Amount (£)</th>
                <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '20%', textAlign: 'right' }}>Net<br/>(Auto)</th>
                <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, width: '5%', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {formData.lines.map((line, index) => {
                const gross = Number(line.gross) || 0;
                const vat = Number(line.vat) || 0;
                const net = gross - vat;

                return (
                  <tr key={line.id} style={{ background: '#fff' }}>
                    <td style={{ padding: '0', border: `1px solid ${sheetTheme.border}` }}>
                      <div style={{ display: 'flex' }}>
                        <select value={line.account} onChange={e => handleLineChange(index, 'account', e.target.value)} onKeyDown={handleKeyDown} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent' }} required>
                          <option value="">-- Choose Account Ledger --</option>
                          <optgroup label="🛒 PURCHASES (Cost of Goods Sold)">
                            {purchasesAccounts.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                          </optgroup>
                          <optgroup label="🏢 OPERATING EXPENSES">
                            {expenseAccounts.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                          </optgroup>
                        </select>
                        <button type="button" onClick={() => { setActiveModal({ type: 'category', lineIndex: index }); setNewLedgerCategory('Operating Expenses'); }} style={{ padding: '0 10px', background: '#f8fafc', color: '#64748b', borderLeft: `1px solid ${sheetTheme.border}`, borderTop: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer' }} title="Add New Ledger Account"><Plus size={14} /></button>
                      </div>
                    </td>
                    <td style={{ padding: '0', border: `1px solid ${sheetTheme.border}` }}>
                      <CellInput type="number" step="any" value={line.gross} onChange={e => handleLineChange(index, 'gross', e.target.value)} onKeyDown={handleKeyDown} placeholder="0.00" align="right" required />
                    </td>
                    <td style={{ padding: '0', border: `1px solid ${sheetTheme.border}` }}>
                      <CellInput type="number" step="any" value={line.vat} onChange={e => handleLineChange(index, 'vat', e.target.value)} onKeyDown={handleKeyDown} placeholder="0.00" align="right" textColor="#dc2626" />
                    </td>
                    <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '700', fontSize: '13px', color: '#059669', background: sheetTheme.calcBg, whiteSpace: 'nowrap' }}>
                      {fmtMoney(net)}
                    </td>
                    <td style={{ padding: '0', border: `1px solid ${sheetTheme.border}`, textAlign: 'center' }}>
                      <button type="button" onClick={() => removeLine(index)} style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }} title="Remove Row">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              
              <tr>
                <td colSpan="5" style={{ padding: '6px 0', borderLeft: `1px solid ${sheetTheme.border}`, borderRight: `1px solid ${sheetTheme.border}` }}>
                  <button type="button" onClick={addLine} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '98%', margin: '0 auto', padding: '8px', background: 'transparent', color: '#0369a1', border: `1px dashed ${sheetTheme.border}`, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                    <Plus size={14} /> Add Another Expense Line
                  </button>
                </td>
              </tr>
              
              <tr style={{ background: '#f1f5f9' }}>
                <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#333' }}>INVOICE TOTALS:</td>
                <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#1f2937' }}>£ {fmtMoney(totals.gross)}</td>
                <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#dc2626' }}>£ {fmtMoney(totals.vat)}</td>
                <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#059669', whiteSpace: 'nowrap' }}>£ {fmtMoney(totals.net)}</td>
                <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}` }}></td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button type="button" onClick={handleCancel} style={{ padding: '8px 24px', background: '#f3f4f6', color: '#374151', fontSize: '13px', fontWeight: '700', border: `1px solid ${sheetTheme.border}`, cursor: 'pointer' }}>
              {formData.id ? 'Cancel Edit' : 'Cancel'}
            </button>
            <button type="submit" style={{ padding: '8px 32px', background: formData.id ? '#166534' : '#c2410c', color: '#fff', fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer' }}>
              {formData.id ? 'Update Invoice' : 'Save Invoice'}
            </button>
          </div>
        </form>

        <div>
          <div style={{ background: sheetTheme.headerBlueBg, padding: '12px', border: `1px solid ${sheetTheme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: sheetTheme.headerBlueText }}>Master Invoice Log</h2>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => setFilterStatus(prev => prev === 'Pending' ? 'All' : 'Pending')} style={{ padding: '6px 12px', background: filterStatus === 'Pending' ? '#c2410c' : '#fff', color: filterStatus === 'Pending' ? '#fff' : '#c2410c', border: `2px solid #c2410c`, borderRadius: '4px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>
                {filterStatus === 'Pending' ? 'Clear Pending Filter' : 'View Pending Invoices'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', padding: '4px 8px', border: `1px solid ${sheetTheme.border}` }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>FROM:</span>
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font }} />
                <span style={{ color: sheetTheme.border }}>|</span>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>TO:</span>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font }} />
              </div>
              <input type="text" placeholder="Search invoices..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ border: `1px solid ${sheetTheme.border}`, padding: '4px 8px', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font, width: '150px' }} />
              <button onClick={() => handleExport('excel')} style={{ padding: '4px 10px', background: '#10b981', color: '#fff', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Excel</button>
              <button onClick={() => handleExport('pdf')} style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>PDF</button>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto', maxHeight: '500px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px', backgroundColor: '#fff' }}>
              <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#374151', textTransform: 'uppercase', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Date</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Supplier & Ref</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Description / Notes</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Expense Accounts & Summary</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'right' }}>Total Gross (£)</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDb.length === 0 ? (
                  <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>No invoices match your search or date range.</td></tr>
                ) : (
                  filteredDb.map((row) => {
                    const isPaid = row.paymentStatus === 'Paid';
                    return (
                    <tr key={row.id}>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '600' }}>{formatDate(row.date)}</td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px' }}>
                        <div style={{ fontWeight: '700', color: '#1f2937' }}>{row.supplier || 'Unassigned'}</div>
                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>Ref: {row.refNo}</div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <div style={{ fontSize: '10px', fontWeight: '800', color: row.status === 'Pending' ? '#c2410c' : '#166534', background: row.status === 'Pending' ? '#ffedd5' : '#dcfce7', display: 'inline-block', padding: '2px 6px', borderRadius: '4px' }}>
                                {row.status === 'Pending' ? 'PENDING' : 'FINALIZED'}
                            </div>
                            {isPaid && (
                                <div style={{ fontSize: '10px', fontWeight: '800', color: '#0369a1', background: '#e0f2fe', display: 'inline-block', padding: '2px 6px', borderRadius: '4px' }}>
                                    PAID
                                </div>
                            )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', color: '#374151' }}>{row.description || '-'}</td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', color: '#374151' }}>
                        <div style={{ fontWeight: '700', color: '#1f2937', marginBottom: '2px' }}>
                          {row.lines?.map(l => l.account).filter(Boolean).join(', ') || 'No Category'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>
                          {row.lines?.length} line(s) • VAT: £{fmtMoney(row.totalVat)}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '700', fontSize: '13px', color: '#c2410c' }}>
                        {fmtMoney(row.totalGross)}
                      </td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'center' }}>
                        {!isPaid ? (
                            <button onClick={() => openPaymentModal(row)} style={{ background: 'transparent', color: '#10b981', border: 'none', cursor: 'pointer', marginRight: '8px' }} title="Match or Record Payment">
                                <Wallet size={14} />
                            </button>
                        ) : (
                            isAdmin && (
                                <button onClick={() => handleUnlinkPayment(row)} style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', marginRight: '8px' }} title="Admin: Unlink Payment">
                                    <Unlink size={14} />
                                </button>
                            )
                        )}
                        <button onClick={() => handleEdit(row)} style={{ background: 'transparent', color: '#0369a1', border: 'none', cursor: 'pointer', marginRight: '8px' }} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(row.id)} style={{ background: 'transparent', color: '#dc2626', border: 'none', cursor: 'pointer' }} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )})
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {activeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '400px', borderRadius: '0', border: `1px solid ${sheetTheme.border}`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}`, background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New {activeModal.type === 'supplier' ? 'Supplier' : 'Account Ledger'}</h2>
              <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: sheetTheme.headerBlueText }}>✖</button>
            </div>
            <form onSubmit={handleAddNewLedger} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: sheetTheme.font }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Name</label>
                <input type="text" value={newLedgerName} onChange={e => setNewLedgerName(e.target.value)} placeholder={activeModal.type === 'supplier' ? 'e.g. Costco' : 'e.g. Cleaning Supplies'} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, boxSizing: 'border-box' }} required autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Account Category</label>
                <select value={newLedgerCategory} onChange={e => setNewLedgerCategory(e.target.value)} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, boxSizing: 'border-box' }} required>
                  <option value="">-- Select Category --</option>
                  {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <button type="submit" style={{ padding: '10px', background: '#0369a1', color: '#fff', fontWeight: '700', border: 'none', cursor: 'pointer', fontSize: '13px' }}>Save & Sync to Cloud</button>
            </form>
          </div>
        </div>
      )}

      {paymentModal && !paymentModal.isLoading && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.8)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '600px', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', fontFamily: sheetTheme.font, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '16px 20px', background: '#059669', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Wallet size={18} /><h2 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Record or Match Payment</h2></div>
              <button onClick={() => setPaymentModal(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#fff' }}>✖</button>
            </div>
            
            <div style={{ display: 'flex', background: '#f8fafc', borderBottom: `1px solid ${sheetTheme.border}` }}>
                <button onClick={() => setPaymentModal({...paymentModal, tab: 'link'})} style={{ flex: 1, padding: '12px', fontWeight: '700', fontSize: '13px', background: paymentModal.tab === 'link' ? '#fff' : 'transparent', color: paymentModal.tab === 'link' ? '#059669' : '#64748b', border: 'none', borderBottom: paymentModal.tab === 'link' ? `2px solid #059669` : 'none', cursor: 'pointer' }}><LinkIcon size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }}/> Match Existing Payment</button>
                <button onClick={() => setPaymentModal({...paymentModal, tab: 'create'})} style={{ flex: 1, padding: '12px', fontWeight: '700', fontSize: '13px', background: paymentModal.tab === 'create' ? '#fff' : 'transparent', color: paymentModal.tab === 'create' ? '#059669' : '#64748b', border: 'none', borderBottom: paymentModal.tab === 'create' ? `2px solid #059669` : 'none', cursor: 'pointer' }}><PlusCircle size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }}/> Create New Payment</button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto' }}>
                <div style={{ background: '#f1f5f9', padding: '12px', borderRadius: '6px', border: `1px solid ${sheetTheme.border}`, marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Paying Supplier: <strong style={{ color: '#0f172a' }}>{paymentModal.invoice.supplier}</strong></div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Invoice Ref: <strong style={{ color: '#0f172a' }}>{paymentModal.invoice.refNo}</strong> | Amount Due: <strong style={{ color: '#dc2626' }}>£{fmtMoney(paymentModal.invoice.totalGross)}</strong></div>
                </div>

                {paymentModal.tab === 'link' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <input type="text" placeholder="Search unlinked payments..." value={paymentModal.searchStr} onChange={e => setPaymentModal({...paymentModal, searchStr: e.target.value})} style={{ width: '50%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', fontSize: '13px' }} />
                            
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600', color: '#475569' }}>
                                <input type="checkbox" checked={paymentModal.showAllUnlinked} onChange={(e) => setPaymentModal({...paymentModal, showAllUnlinked: e.target.checked})} />
                                Show all unlinked payments
                            </label>
                        </div>
                        <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', maxHeight: '250px', overflowY: 'auto' }}>
                            {paymentModal.unlinkedReceipts.filter(r => {
                                const matchSearch = (String(r.amount).includes(paymentModal.searchStr) || String(r.date).includes(paymentModal.searchStr) || String(r.description).toLowerCase().includes(paymentModal.searchStr.toLowerCase()) || String(r.account).toLowerCase().includes(paymentModal.searchStr.toLowerCase()));
                                const matchSupplier = paymentModal.showAllUnlinked || (r.account === paymentModal.invoice.supplier || r.payee === paymentModal.invoice.supplier);
                                return matchSearch && matchSupplier;
                            }).length === 0 ? (
                                <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                                    {paymentModal.showAllUnlinked ? "No unlinked payments found in the system." : `No unlinked payments found matching supplier "${paymentModal.invoice.supplier}". Try checking "Show all unlinked payments" if the name was typed differently.`}
                                </div>
                            ) : (
                                paymentModal.unlinkedReceipts.filter(r => {
                                    const matchSearch = (String(r.amount).includes(paymentModal.searchStr) || String(r.date).includes(paymentModal.searchStr) || String(r.description).toLowerCase().includes(paymentModal.searchStr.toLowerCase()) || String(r.account).toLowerCase().includes(paymentModal.searchStr.toLowerCase()));
                                    const matchSupplier = paymentModal.showAllUnlinked || (r.account === paymentModal.invoice.supplier || r.payee === paymentModal.invoice.supplier);
                                    return matchSearch && matchSupplier;
                                }).map(r => (
                                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                                        <div>
                                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>£{fmtMoney(r.amount)} <span style={{ color: '#64748b', fontWeight: '400', fontSize: '12px' }}>on {formatDate(r.date)}</span></div>
                                            <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{r.account} {r.bankName ? `(${r.bankName})` : ''}</div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>{r.description || 'No description'}</div>
                                        </div>
                                        <button type="button" onClick={() => handleLinkPayment(r)} style={{ padding: '6px 12px', background: '#e2e8f0', color: '#0f172a', fontWeight: '700', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Link</button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {paymentModal.tab === 'create' && (
                    <form onSubmit={handleRecordNewPayment} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Payment Date</label>
                            <input type="date" value={paymentModal.date} onChange={e => setPaymentModal({...paymentModal, date: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box' }} required />
                        </div>
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Payment From (Bank Account)</label>
                            <select value={paymentModal.bankName} onChange={e => setPaymentModal({...paymentModal, bankName: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', background: '#fff' }} required>
                            <option value="">-- Select Bank Account --</option>
                            {bankAccounts.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '6px', display: 'block', color: '#334155' }}>Amount Paid (£)</label>
                            <input type="number" step="any" value={paymentModal.amount} onChange={e => setPaymentModal({...paymentModal, amount: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', boxSizing: 'border-box', fontSize: '16px', fontWeight: '700', color: '#059669' }} required />
                        </div>
                        <div style={{ marginTop: '8px', display: 'flex', gap: '12px' }}>
                            <button type="button" onClick={() => setPaymentModal(null)} style={{ flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', fontWeight: '700', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                            <button type="submit" style={{ flex: 2, padding: '12px', background: '#059669', color: '#fff', fontWeight: '700', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Generate Payment</button>
                        </div>
                    </form>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}