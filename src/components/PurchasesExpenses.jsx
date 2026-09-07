import React, { useState, useMemo, useRef, useEffect } from 'react';
import { doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { db as firebaseDb } from "../firebase"; // Adjusted path to match other files
import { ShoppingCart, Plus, Trash2, Edit2, FileText, X, Search, FileSpreadsheet } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

// STRICT MONEY FORMATTER
const fmtMoney = (n) => {
  if (n === '' || n === null || n === undefined) return '';
  const num = Number(n);
  if (isNaN(num)) return n;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getEmptyLine = () => ({ id: Date.now() + Math.random(), account: '', gross: '', vat: '' });

const getInitialForm = () => ({
  id: '', date: getToday(), supplier: '', refNo: '', bankCategory: '', description: '', lines: [getEmptyLine()]
});

// === SPREADSHEET-STYLE UI THEME ===
const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerOrangeBg: '#ffedd5', headerOrangeText: '#c2410c',
};

const labelTd = { border: `1px solid ${sheetTheme.border}`, padding: '8px 12px', fontSize: '13px', color: '#333', background: sheetTheme.labelBg, whiteSpace: 'nowrap', width: '30%', fontWeight: '600' };
const inputTd = { border: `1px solid ${sheetTheme.border}`, padding: '0', background: '#fff', width: '70%' };

// SMART CELL INPUT
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
  const [newLedgerName, setNewLedgerName] = useState('');
  const dateInputRef = useRef(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // MIGRATION SCRIPT FOR PURCHASES
  useEffect(() => {
    const migratePurchasesToFirebase = async () => {
      const localData = JSON.parse(localStorage.getItem('erp_purchases'));
      const isMigrated = localStorage.getItem('erp_purchases_migrated');
      
      if (localData && Array.isArray(localData) && localData.length > 0 && !isMigrated) {
        try {
          console.log("Migrating Purchases to Firebase...");
          const batch = writeBatch(firebaseDb);
          localData.forEach(record => {
            const recordId = record.id || Date.now().toString() + Math.random().toString(36).substring(7);
            const docRef = doc(firebaseDb, "erp_purchases", recordId);
            batch.set(docRef, { ...record, id: recordId });
          });
          await batch.commit();
          localStorage.setItem('erp_purchases_migrated', 'true');
          console.log("Purchases Migration Complete!");
        } catch (error) {
          console.error("Migration failed: ", error);
        }
      }
    };
    migratePurchasesToFirebase();
  }, []);

  const suppliers = accountsDb.filter(acc => String(acc.category).includes('Accounts Payable') || String(acc.category).includes('Supplier')).sort((a, b) => a.name.localeCompare(b.name));
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
    if (!window.confirm(formData.id ? "Are you sure you want to update this invoice?" : "Are you sure you want to save this invoice?")) return; 
    
    const validLines = formData.lines.filter(l => l.account || l.gross || l.vat);
    const recordId = formData.id || Date.now().toString();
    const invoiceRecord = { 
      ...formData, 
      id: recordId, 
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
      // Firebase Write
      await setDoc(doc(firebaseDb, "erp_purchases", recordId), invoiceRecord);
      
      alert(formData.id ? `✅ Invoice updated successfully!` : `✅ Invoice saved successfully!`);
      setFormData(getInitialForm());
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { if(dateInputRef.current) dateInputRef.current.focus(); }, 50);
    } catch (error) {
      console.error("Error saving purchase to Firebase: ", error);
      alert("Database Error: Could not save the invoice.");
    }
  };

  const handleEdit = (row) => {
    setFormData({ ...row, lines: row.lines?.length > 0 ? row.lines.map(l => ({ ...l })) : [getEmptyLine()] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this invoice?")) {
      const newDb = displayDb.filter(t => t.id !== id);
      if (setDb) setDb(newDb);
      
      try {
        // Firebase Delete
        await deleteDoc(doc(firebaseDb, "erp_purchases", id));
      } catch (error) {
        console.error("Error deleting purchase from Firebase: ", error);
        alert("Database Error: Could not delete the invoice.");
      }
    }
  };

  const handleAddNewLedger = (e) => {
    e.preventDefault();
    if (!newLedgerName) return;

    const newLedger = { id: Date.now().toString(), name: newLedgerName, type: activeModal?.type === 'supplier' ? 'Liability' : 'Expense', category: activeModal?.type === 'supplier' ? 'Accounts Payable (Supplier)' : 'Operating Expenses', balance: 0 };
    setAccountsDb(prev => [...prev, newLedger]);
    
    if (activeModal?.type === 'supplier') {
      setFormData(prev => ({ ...prev, supplier: newLedger.name }));
    } else if (activeModal?.type === 'category' && activeModal.lineIndex !== undefined) {
      handleLineChange(activeModal.lineIndex, 'account', newLedger.name);
    }
    setNewLedgerName('');
    setActiveModal(null);
  };

  const filteredDb = useMemo(() => {
    let result = displayDb;
    if (filterDateFrom && filterDateTo) {
       result = result.filter(row => { const rDate = toDateNum(row.date); return rDate >= toDateNum(filterDateFrom) && rDate <= toDateNum(filterDateTo); });
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(row => {
        const linesStr = row.lines?.map(l => l.account).join(' ').toLowerCase() || '';
        return (String(row.supplier || '').toLowerCase().includes(term) || String(row.refNo || '').toLowerCase().includes(term) || String(row.description || '').toLowerCase().includes(term) || String(row.totalGross || '').includes(term) || String(row.bankCategory || '').toLowerCase().includes(term) || String(formatDate(row.date) || '').includes(term) || linesStr.includes(term));
      });
    }
    return result;
  }, [displayDb, searchTerm, filterDateFrom, filterDateTo]);

  const handleExport = (format) => {
    if (filteredDb.length === 0) return alert("No invoices available to export.");
    const headers = ['Date', 'Supplier', 'Ref #', 'P&L Bank Category', 'Description', 'Expense Accounts Used', 'Total VAT (£)', 'Total Gross (£)'];
    const dataRows = filteredDb.map(row => [ formatDate(row.date), row.supplier || 'Unassigned', row.refNo || '-', row.bankCategory || 'Uncategorized', row.description || '-', row.lines?.map(l => l.account).filter(Boolean).join(', ') || 'None', fmtMoney(row.totalVat), fmtMoney(row.totalGross) ]);

    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 8px; }</style></head><body><table><tr><td colspan="8" style="font-size: 18px; font-weight: bold; border: none;">Ali's Kitchen - </td></tr><tr><td colspan="8" style="font-size: 14px; font-weight: bold; border: none;">Purchases & Expenses Log</td></tr><tr><td colspan="8" style="font-size: 12px; color: #555; border: none;">Period: ${filterDateFrom ? formatDate(filterDateFrom) : 'All Time'} to ${filterDateTo ? formatDate(filterDateTo) : 'Present'}</td></tr><tr><td colspan="8" style="border: none;"></td></tr><tr>`;
      headers.forEach((h, i) => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold; ${i >= 6 ? 'text-align: right;' : 'text-align: left;'}">${h}</th>`; }); html += `</tr>`;
      dataRows.forEach(row => { html += `<tr>`; row.forEach((val, idx) => { html += `<td style="border: 1px solid #cbd5e1; padding: 8px; ${idx >= 6 ? 'text-align: right;' : 'text-align: left;'}">${val}</td>`; }); html += `</tr>`; }); html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `Purchases_Log.xls`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } else if (format === 'pdf') {
      const doc = new jsPDF('l', 'pt', 'a4'); doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text("Ali's Kitchen - ", 40, 40); doc.setFontSize(14); doc.text("Purchases & Expenses Log", 40, 60); doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(`Period: ${filterDateFrom ? formatDate(filterDateFrom) : 'All Time'} to ${filterDateTo ? formatDate(filterDateTo) : 'Present'}`, 40, 75);
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
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Record supplier invoices and split expenses with manual VAT.</p>
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
                <td style={labelTd}>Supplier Account</td>
                <td style={inputTd}>
                  <div style={{ display: 'flex' }}>
                    <select name="supplier" value={formData.supplier} onChange={handleHeaderChange} onKeyDown={handleKeyDown} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent', color: '#c2410c', fontWeight: '700' }} required>
                      <option value="">-- Choose Supplier --</option>
                      {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setActiveModal({ type: 'supplier' })} style={{ padding: '0 12px', background: '#f8fafc', color: '#c2410c', borderLeft: `1px solid ${sheetTheme.border}`, borderTop: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', fontWeight: '800' }} title="Add New Supplier"><Plus size={14} /></button>
                  </div>
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Invoice / Ref #</td>
                <td style={inputTd}><CellInput type="text" name="refNo" value={formData.refNo} onChange={handleHeaderChange} onKeyDown={handleKeyDown} placeholder="e.g. INV-1004" align="left" required /></td>
              </tr>
              <tr>
                <td style={labelTd}>P&L Bank Category (Tag)</td>
                <td style={inputTd}>
                  <select name="bankCategory" value={formData.bankCategory} onChange={handleHeaderChange} onKeyDown={handleKeyDown} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent', color: '#0369a1', fontWeight: '700' }} required>
                    <option value="">-- Select Bank Category --</option>
                    <option value="Memon Services Ltd">Memon Services Ltd</option>
                    <option value="Khanani Management">Khanani Management</option>
                    <option value="LK Associates">LK Associates</option>
                    <option value="Cash in Hand">Cash in Hand</option>
                  </select>
                </td>
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
                        <button type="button" onClick={() => setActiveModal({ type: 'category', lineIndex: index })} style={{ padding: '0 10px', background: '#f8fafc', color: '#64748b', borderLeft: `1px solid ${sheetTheme.border}`, borderTop: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer' }} title="Add New Ledger Account"><Plus size={14} /></button>
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
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>P&L Category Tag</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Description / Notes</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none' }}>Expense Accounts & Summary</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'right' }}>Total Gross (£)</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderTop: 'none', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDb.length === 0 ? (
                  <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>No invoices match your search or date range.</td></tr>
                ) : (
                  filteredDb.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '600' }}>{formatDate(row.date)}</td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px' }}>
                        <div style={{ fontWeight: '700', color: '#1f2937' }}>{row.supplier || 'Unassigned'}</div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>{row.refNo}</div>
                      </td>
                      <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px', color: '#0369a1', fontWeight: '700' }}>{row.bankCategory || '-'}</td>
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
                        <button onClick={() => handleEdit(row)} style={{ background: 'transparent', color: '#0369a1', border: 'none', cursor: 'pointer', marginRight: '8px' }} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(row.id)} style={{ background: 'transparent', color: '#dc2626', border: 'none', cursor: 'pointer' }} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
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
              <button type="submit" style={{ padding: '10px', background: '#0369a1', color: '#fff', fontWeight: '700', border: 'none', cursor: 'pointer', fontSize: '13px' }}>Save & Use</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}