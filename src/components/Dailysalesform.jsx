import React, { useState, useEffect, useRef } from 'react';
import { doc, writeBatch } from "firebase/firestore";
import { db as firebaseDb } from "../firebase"; 

const getToday = () => new Date().toISOString().split('T')[0];

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

const fmtMoney = (n) => {
  if (n === '' || n === null || n === undefined) return '';
  const num = Number(n);
  if (isNaN(num)) return n;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Removed M1/M2 to streamline the form for Ali's Kitchen
const initialFormState = {
  date: getToday(),
  cashGross: '', cashRefund: '',
  m3Gross: '', m3Refund: '',
  tillCardGross: '', tillCardRefund: '', cardVarReason: '',
  uber: '', deliveroo: '', justEat: '', app4: '', otherDel: '',
  openingTill: 0,
  collections: '', safeBox: '', safeBoxDate: '', physicalTill: '', tillVarReason: '',
  tillSalesGross: '', tillSalesRefund: '', salesVarReason: '',
  vatAmount: ''
};

const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerYellowBg: '#fef9c3', headerYellowText: '#854d0e',
};

const labelTd = { border: `1px solid ${sheetTheme.border}`, padding: '6px 12px', fontSize: '12px', color: '#333', background: sheetTheme.labelBg, whiteSpace: 'nowrap', width: '40%' };
const inputTd = { border: `1px solid ${sheetTheme.border}`, padding: '0', background: '#fff', width: '60%' };

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
      style={{ width: '100%', border: 'none', padding: '6px 10px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: align, outline: 'none', background: 'transparent', color: textColor }}
    />
  );
};

const CellCalc = ({ value, bold = false, color = '#000', bg = sheetTheme.calcBg }) => (
  <div style={{ width: '100%', padding: '6px 10px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: 'right', background: bg, color: color, fontWeight: bold ? '700' : '400', border: 'none', whiteSpace: 'nowrap' }}>
    {value}
  </div>
);

const VarianceCell = ({ variance }) => {
  const isMatch = Math.abs(variance) < 0.01;
  const isOverage = variance > 0;
  const bg = isMatch ? '#ecfdf5' : isOverage ? '#fffbeb' : '#fef2f2';
  const color = isMatch ? '#059669' : isOverage ? '#d97706' : '#dc2626';
  return (
    <div style={{ width: '100%', padding: '6px 10px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: 'right', fontWeight: '700', background: bg, color: color, whiteSpace: 'nowrap' }}>
      {isMatch ? '✓ EXACT MATCH' : fmtMoney(Math.abs(variance))}
    </div>
  );
};

export default function DailySalesForm({ db = [], salesDb = [], setSalesDb, accountsDb = [], editDate }) {
  const activeDb = salesDb.length > 0 ? salesDb : db;
  const [formData, setFormData] = useState(initialFormState);
  const [originalDate, setOriginalDate] = useState(null);
  const dateInputRef = useRef(null);

  useEffect(() => {
    const migrateToFirebase = async () => {
      const localData = JSON.parse(localStorage.getItem('erp_sales_db'));
      const isMigrated = localStorage.getItem('erp_sales_migrated');
      
      if (localData && Array.isArray(localData) && localData.length > 0 && !isMigrated) {
        try {
          const batch = writeBatch(firebaseDb);
          localData.forEach(record => {
            const docRef = doc(firebaseDb, "erp_sales_db", record.date);
            batch.set(docRef, record);
          });
          await batch.commit();
          localStorage.setItem('erp_sales_migrated', 'true');
        } catch (error) {
          console.error("Migration failed: ", error);
        }
      }
    };
    migrateToFirebase();
  }, []);

  const getOpeningTillForDate = (dateStr, currentDb = activeDb) => {
    try {
      const targetNum = toDateNum(dateStr);
      const priorRecords = currentDb.filter(r => toDateNum(r.date) < targetNum);
      if (priorRecords.length > 0) {
        priorRecords.sort((a, b) => toDateNum(b.date) - toDateNum(a.date));
        return Number(priorRecords[0].physicalTill) || 0;
      }
      const setupTill = accountsDb.find(acc => acc.category === 'Physical Till Float');
      return setupTill ? Number(setupTill.balance) : 0;
    } catch (error) { return 0; }
  };

  useEffect(() => {
    const targetDate = editDate || getToday();
    const targetNum = toDateNum(targetDate);
    const existing = activeDb.find(r => toDateNum(r.date) === targetNum);
    
    if (existing) {
       setFormData({ ...initialFormState, ...existing, date: targetDate });
       setOriginalDate(existing.date);
    } else {
       setFormData(prev => ({ ...prev, date: targetDate, openingTill: getOpeningTillForDate(targetDate) }));
       setOriginalDate(null);
    }
  }, [editDate, activeDb]); 

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    if (type === 'date' || type === 'text') {
      setFormData(prev => ({ ...prev, [name]: value }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value === '' ? '' : Number(value) }));
    }
  };

  const handleTextChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (e) => {
    const { value } = e.target;
    if (!value) {
      setFormData(prev => ({ ...prev, date: value }));
      return;
    }
    const targetNum = toDateNum(value);
    const existing = activeDb.find(r => toDateNum(r.date) === targetNum);

    if (existing) {
      if (originalDate && toDateNum(existing.date) === toDateNum(originalDate)) {
        setFormData(prev => ({ ...prev, date: value }));
        return;
      }
      if (window.confirm(`Data already exists for ${value}. Load it to edit?`)) {
        setFormData({ ...initialFormState, ...existing, date: value });
        setOriginalDate(existing.date);
        return;
      }
    }
    setFormData({
      ...initialFormState,
      date: value,
      openingTill: getOpeningTillForDate(value)
    });
    setOriginalDate(null);
  };

  const handleDateBlur = (e) => {
    const { value } = e.target;
    if (!value) return;
    const targetNum = toDateNum(value);
    const existing = activeDb.find(r => toDateNum(r.date) === targetNum);

    if (existing) {
      if (originalDate && toDateNum(existing.date) === toDateNum(originalDate)) return;
      if(window.confirm(`Data already exists for ${value}. Load it to edit?`)) {
        setFormData({ ...initialFormState, ...existing, date: value });
        setOriginalDate(existing.date);
        return;
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target.name === 'date') handleDateBlur(e);
      const form = e.target.form;
      if (form) {
        const focusable = Array.from(form.elements).filter(el => !el.disabled && !el.readOnly && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || (el.tagName === 'BUTTON' && el.type === 'submit')));
        const index = focusable.indexOf(e.target);
        if (index > -1 && index < focusable.length - 1) focusable[index + 1].focus();
      }
    }
  };

  const isExistingRecord = !!originalDate || (formData.date && activeDb.some(r => toDateNum(r.date) === toDateNum(formData.date)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const targetNum = toDateNum(formData.date);
    let updatedDb;
    
    if (originalDate) {
      updatedDb = activeDb.filter(r => toDateNum(r.date) !== toDateNum(originalDate) && toDateNum(r.date) !== targetNum);
      updatedDb.push(formData);
    } else if (isExistingRecord) {
      updatedDb = activeDb.map(r => toDateNum(r.date) === targetNum ? formData : r);
    } else {
      updatedDb = [...activeDb, formData];
    }
    
    updatedDb.sort((a, b) => toDateNum(a.date) - toDateNum(b.date));
    
    const setupTill = accountsDb.find(acc => acc.category === 'Physical Till Float');
    let rollingTill = setupTill ? Number(setupTill.balance) : 0;
    
    const fullyUpdatedDb = updatedDb.map(record => {
      const updatedRecord = { ...record, openingTill: rollingTill };
      rollingTill = Number(updatedRecord.physicalTill) || 0;
      return updatedRecord;
    });
    
    if (setSalesDb) setSalesDb(fullyUpdatedDb);
    
    try {
      const batch = writeBatch(firebaseDb);
      fullyUpdatedDb.forEach(record => {
        const docRef = doc(firebaseDb, "erp_sales_db", record.date);
        batch.set(docRef, record);
      });
      await batch.commit();

      alert(originalDate || isExistingRecord ? `✅ Daily Sales Entry for ${formData.date} Updated!` : `✅ Daily Sales Entry for ${formData.date} Saved!`);
      
      setOriginalDate(null);
      setFormData({ ...initialFormState, date: getToday(), openingTill: getOpeningTillForDate(getToday(), fullyUpdatedDb) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { if(dateInputRef.current) dateInputRef.current.focus(); }, 50);
    } catch (error) {
      console.error("Error saving to Firebase: ", error);
      alert("Database Error: Could not save the sales record.");
    }
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    const targetDate = originalDate || formData.date;
    if (!window.confirm(`Are you sure you want to permanently delete the sales record for ${targetDate}?`)) return;

    const targetNum = toDateNum(targetDate);
    const updatedDb = activeDb.filter(r => toDateNum(r.date) !== targetNum).sort((a, b) => toDateNum(a.date) - toDateNum(b.date));
    
    const setupTill = accountsDb.find(acc => acc.category === 'Physical Till Float');
    let rollingTill = setupTill ? Number(setupTill.balance) : 0;
    
    const fullyUpdatedDb = updatedDb.map(record => {
      const updatedRecord = { ...record, openingTill: rollingTill };
      rollingTill = Number(updatedRecord.physicalTill) || 0;
      return updatedRecord;
    });
    
    if (setSalesDb) setSalesDb(fullyUpdatedDb);
    
    try {
      const batch = writeBatch(firebaseDb);
      fullyUpdatedDb.forEach(record => {
        const docRef = doc(firebaseDb, "erp_sales_db", record.date);
        batch.set(docRef, record);
      });
      batch.delete(doc(firebaseDb, "erp_sales_db", targetDate));
      await batch.commit();

      alert("✅ Daily Sales Record Deleted!");
      
      setOriginalDate(null);
      setFormData({ ...initialFormState, date: getToday(), openingTill: getOpeningTillForDate(getToday(), fullyUpdatedDb) });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { if(dateInputRef.current) dateInputRef.current.focus(); }, 50);
    } catch (error) {
      console.error("Error deleting from Firebase: ", error);
      alert("Database Error: Could not delete the sales record.");
    }
  };

  const handleCancel = (e) => {
    e.preventDefault();
    setOriginalDate(null);
    setFormData({ ...initialFormState, date: getToday(), openingTill: getOpeningTillForDate(getToday()) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { if(dateInputRef.current) dateInputRef.current.focus(); }, 50);
  };

  const val = (num) => Number(num) || 0;
  const netCash = val(formData.cashGross) - val(formData.cashRefund);
  
  // Exclusively routes the single input through the LK Associates mapping channel
  const erpCardNet = (val(formData.m3Gross) - val(formData.m3Refund));
  const tillCardNet = val(formData.tillCardGross) - val(formData.tillCardRefund);
  const cardVariance = erpCardNet - tillCardNet;
  
  const totalDelivery = val(formData.uber) + val(formData.deliveroo) + val(formData.justEat) + val(formData.app4) + val(formData.otherDel);
  
  const expectedTill = val(formData.openingTill) + netCash - val(formData.collections) - val(formData.safeBox);
  const tillVariance = val(formData.physicalTill) - expectedTill;
  
  const erpTotalGross = val(formData.cashGross) + val(formData.m3Gross) + totalDelivery;
  const erpTotalRefund = val(formData.cashRefund) + val(formData.m3Refund);
  const erpTotalNet = erpTotalGross - erpTotalRefund;
  const tillTotalNet = val(formData.tillSalesGross) - val(formData.tillSalesRefund);
  const salesVariance = erpTotalNet - tillTotalNet;

  const vatPercentage = tillTotalNet > 0 && formData.vatAmount ? ((val(formData.vatAmount) / tillTotalNet) * 100).toFixed(2) : '0.00';

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#ffffff', minHeight: '100vh', color: '#000' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '8px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Daily Sales Financial Model</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Fill in only the white cells in order to populate the shaded cells.</p>
          </div>
          <table style={{ borderCollapse: 'collapse', border: `1px solid ${sheetTheme.border}` }}>
            <tbody>
              <tr>
                <td style={{ padding: '6px 16px', background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, fontWeight: '700', border: `1px solid ${sheetTheme.border}`, fontSize: '12px' }}>Date of Record</td>
                <td style={{ padding: '0', border: `1px solid ${sheetTheme.border}`, background: '#fff' }}>
                  <input ref={dateInputRef} type="date" name="date" value={formData.date || ''} onChange={handleDateChange} onBlur={handleDateBlur} onKeyDown={handleKeyDown} style={{ border: 'none', padding: '6px 12px', outline: 'none', fontFamily: sheetTheme.font, fontSize: '13px', fontWeight: '700', textAlign: 'right' }} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', marginTop: '20px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th colSpan="2" style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Cash Sales Inputs</th></tr></thead>
                <tbody>
                  <tr><td style={labelTd}>Gross Cash Sales (£)</td><td style={inputTd}><CellInput name="cashGross" value={formData.cashGross} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={labelTd}>Cash Refunds (£)</td><td style={inputTd}><CellInput name="cashRefund" value={formData.cashRefund} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Net Cash (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(netCash)} bold={true} /></td></tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th colSpan="4" style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Card Terminal Inputs</th></tr>
                  <tr><td style={{...labelTd, width: '40%', textAlign: 'center'}}>Merchant</td><td style={{...labelTd, width: '20%', textAlign: 'center'}}>Gross (£)</td><td style={{...labelTd, width: '20%', textAlign: 'center'}}>Refund (£)</td><td style={{...labelTd, width: '20%', textAlign: 'center'}}>Net (£)</td></tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={labelTd}>Card Sales (LK Associates)</td>
                    <td style={inputTd}><CellInput name="m3Gross" value={formData.m3Gross} onChange={handleChange} onKeyDown={handleKeyDown} /></td>
                    <td style={inputTd}><CellInput name="m3Refund" value={formData.m3Refund} onChange={handleChange} onKeyDown={handleKeyDown} /></td>
                    <td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(val(formData.m3Gross) - val(formData.m3Refund))} /></td>
                  </tr>
                  <tr><td colSpan="3" style={{...labelTd, textAlign: 'right', fontWeight: '700'}}>Total ERP Card Net (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(erpCardNet)} bold={true} bg="#e2efda" color="#276749" /></td></tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th colSpan="2" style={{ background: sheetTheme.headerYellowBg, color: sheetTheme.headerYellowText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Card Reconciliation Analysis</th></tr></thead>
                <tbody>
                  <tr><td style={labelTd}>Till Card Gross (£)</td><td style={inputTd}><CellInput name="tillCardGross" value={formData.tillCardGross} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={labelTd}>Till Card Refund (£)</td><td style={inputTd}><CellInput name="tillCardRefund" value={formData.tillCardRefund} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Card Variance (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><VarianceCell variance={cardVariance} /></td></tr>
                  <tr><td style={labelTd}>Variance Reason</td><td style={inputTd}><CellInput type="text" name="cardVarReason" align="left" value={formData.cardVarReason || ''} onChange={handleTextChange} onKeyDown={handleKeyDown} placeholder="Enter reason if required..." /></td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th colSpan="2" style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Delivery Platforms Inputs</th></tr></thead>
                <tbody>
                  {[ { key: 'uber', label: 'Uber Eats' }, { key: 'deliveroo', label: 'Deliveroo' }, { key: 'justEat', label: 'Just Eat' }, { key: 'app4', label: 'App4' }, { key: 'otherDel', label: '' } ].map(plat => (
                    <tr key={plat.key}><td style={labelTd}>{plat.label} (£)</td><td style={inputTd}><CellInput name={plat.key} value={formData[plat.key]} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  ))}
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Total Delivery Net (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(totalDelivery)} bold={true} /></td></tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th colSpan="2" style={{ background: sheetTheme.headerGreenBg, color: sheetTheme.headerGreenText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Till Reconciliation Analysis</th></tr></thead>
                <tbody>
                  <tr><td style={{...labelTd, color: '#6b7280'}}>System Opening Till (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(val(formData.openingTill))} color="#6b7280" /></td></tr>
                  <tr><td style={labelTd}>Collections Dropped (£)</td><td style={inputTd}><CellInput name="collections" value={formData.collections} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={labelTd}>Safe Box Drop (£)</td><td style={inputTd}><CellInput name="safeBox" value={formData.safeBox} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={labelTd}>Safe Box Date</td><td style={inputTd}><CellInput type="date" name="safeBoxDate" align="right" value={formData.safeBoxDate || ''} onChange={handleTextChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Expected Till Closing (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(expectedTill)} bold={true} bg={sheetTheme.headerYellowBg} color={sheetTheme.headerYellowText} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700', background: '#dbeafe'}}>Actual Physical Till (£)</td><td style={{border: `2px solid #3b82f6`, padding: 0, background: '#fff'}}><CellInput name="physicalTill" value={formData.physicalTill} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Till Variance (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><VarianceCell variance={tillVariance} /></td></tr>
                  <tr><td style={labelTd}>Variance Reason</td><td style={inputTd}><CellInput type="text" name="tillVarReason" align="left" value={formData.tillVarReason || ''} onChange={handleTextChange} onKeyDown={handleKeyDown} placeholder="Enter reason if required..." /></td></tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th colSpan="2" style={{ background: sheetTheme.headerGreenBg, color: sheetTheme.headerGreenText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Overall Sales Reconciliation</th></tr></thead>
                <tbody>
                  <tr><td style={{...labelTd, fontWeight: '700', color: '#6b7280'}}>Total ERP Net (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(erpTotalNet)} color="#6b7280" /></td></tr>
                  <tr><td style={labelTd}>Till Z-Read Gross (£)</td><td style={inputTd}><CellInput name="tillSalesGross" value={formData.tillSalesGross} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={labelTd}>Till Z-Read Refund (£)</td><td style={inputTd}><CellInput name="tillSalesRefund" value={formData.tillSalesRefund} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Sales Variance (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><VarianceCell variance={salesVariance} /></td></tr>
                  <tr><td style={labelTd}>Variance Reason</td><td style={inputTd}><CellInput type="text" name="salesVarReason" align="left" value={formData.salesVarReason || ''} onChange={handleTextChange} onKeyDown={handleKeyDown} placeholder="Enter reason if required..." /></td></tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th colSpan="2" style={{ background: sheetTheme.headerYellowBg, color: sheetTheme.headerYellowText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>VAT Key Performance Indicator</th></tr></thead>
                <tbody>
                  <tr><td style={labelTd}>VAT Amount Taken (£)</td><td style={inputTd}><CellInput name="vatAmount" value={formData.vatAmount} onChange={handleChange} onKeyDown={handleKeyDown} /></td></tr>
                  <tr><td style={{...labelTd, fontWeight: '700'}}>Effective VAT % Rate</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={`${vatPercentage} %`} bold={true} /></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${sheetTheme.border}` }}>
            {isExistingRecord && (
              <button type="button" onClick={handleDelete} style={{ padding: '8px 24px', background: '#fef2f2', color: '#dc2626', fontSize: '13px', fontWeight: '700', border: `1px solid #fecaca`, cursor: 'pointer', marginRight: 'auto' }}>
                Delete Record
              </button>
            )}
            <button type="button" onClick={handleCancel} style={{ padding: '8px 24px', background: '#f3f4f6', color: '#374151', fontSize: '13px', fontWeight: '700', border: `1px solid #d1d5db`, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" style={{ padding: '8px 32px', background: isExistingRecord ? '#166534' : '#0369a1', color: '#fff', fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer' }}>
              {isExistingRecord ? 'Update Record' : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}