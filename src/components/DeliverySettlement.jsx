import React, { useState, useEffect, useMemo } from 'react';
import { doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { db as firebaseDb } from "../firebase"; 
import { Trash2, Edit2, Plus } from 'lucide-react';

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getMondayBefore = (dateStr) => {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
  const monday = new Date(d.setDate(diff));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
};

const getSundayAfter = (dateStr) => {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() + (day === 0 ? 0 : 7 - day);
  const sunday = new Date(d.setDate(diff));
  return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
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
  if (n === '' || n === null || n === undefined || isNaN(Number(n))) return n;
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const calculateErpGross = (start, end, plat, dbSales) => {
  if (!start || !end || !plat || !dbSales || dbSales.length === 0) return '';
  const sNum = toDateNum(start);
  const eNum = toDateNum(end);
  let key = '';
  if (plat === 'Uber Eats') key = 'uber';
  else if (plat === 'Deliveroo') key = 'deliveroo';
  else if (plat === 'Just Eat') key = 'justEat';
  else if (plat === 'App4') key = 'app4';
  if (!key) return '';

  const total = dbSales
    .filter(s => toDateNum(s.date) >= sNum && toDateNum(s.date) <= eNum)
    .reduce((sum, s) => sum + (Number(s[key]) || 0), 0);
  
  return total > 0 ? total : '';
};

const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerOrangeBg: '#ffedd5', headerOrangeText: '#c2410c',
};

const labelTd = { border: `1px solid ${sheetTheme.border}`, padding: '8px 12px', fontSize: '13px', color: '#333', background: sheetTheme.labelBg, whiteSpace: 'nowrap', width: '40%', fontWeight: '600' };
const inputTd = { border: `1px solid ${sheetTheme.border}`, padding: '0', background: '#fff', width: '60%' };

const CellInput = ({ name, value, onChange, onKeyDown, isNumeric=true, placeholder="", align="right", textColor="#000", bg="transparent", disabled=false }) => {
  const [isFocused, setIsFocused] = useState(false);
  const [localVal, setLocalVal] = useState('');

  useEffect(() => {
    if (!isFocused) {
      setLocalVal((isNumeric && value !== '' && value !== null && !isNaN(Number(value))) ? fmtMoney(value) : (value || ''));
    }
  }, [value, isFocused, isNumeric]);

  const handleFocus = (e) => {
    setIsFocused(true);
    setLocalVal(value || ''); 
    const target = e.target;
    setTimeout(() => { if (target) target.select(); }, 10);
  };

  const handleLocalChange = (e) => {
    const raw = e.target.value;
    setLocalVal(raw); 
    onChange({ target: { name, value: raw, type: 'text' } });
  };

  return (
    <input
      type="text"
      inputMode={isNumeric ? "decimal" : undefined}
      className="enter-focusable"
      name={name} 
      value={localVal} 
      onFocus={handleFocus}
      onBlur={() => setIsFocused(false)}
      onChange={handleLocalChange} 
      onKeyDown={onKeyDown} 
      placeholder={placeholder}
      disabled={disabled}
      style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: align, outline: 'none', background: disabled ? '#f3f4f6' : bg, color: textColor, cursor: disabled ? 'not-allowed' : 'text' }}
    />
  );
};

const CellCalc = ({ value, bold = false, color = '#000', bg = sheetTheme.calcBg }) => (
  <div style={{ width: '100%', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: 'right', background: bg, color: color, fontWeight: bold ? '900' : '400', border: 'none', whiteSpace: 'nowrap' }}>
    {value}
  </div>
);

const VarianceBadge = ({ variance }) => {
  const isMatch = Math.abs(variance) < 0.01;
  const isPositive = variance > 0.01;
  const bg = isMatch ? '#ecfdf5' : isPositive ? '#fef08a' : '#fecaca'; 
  const color = isMatch ? '#059669' : isPositive ? '#854d0e' : '#991b1b'; 
  const text = isMatch ? '✓ MATCH' : `${isPositive ? '+ ' : ''}${fmtMoney(variance)}`;

  return (
    <div style={{ width: '100%', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', textAlign: 'right', fontWeight: '900', background: bg, color: color, whiteSpace: 'nowrap' }}>
      {text}
    </div>
  );
};

const getInitialFormState = () => ({
  id: '', syncReceiptId: '', dateFrom: getMondayBefore(getToday()), dateTo: getSundayAfter(getToday()), payoutDate: '',
  platform: 'Uber Eats', grossSales: '', platformGross: '', grossVarianceReason: '', commission: '', vatOnCommission: '',
  advertisement: '', vatOnAdvertisement: '', serviceCharges: '', vatOnServiceCharges: '', refunds: '',
  adjPosList: [{ amount: '', reason: '' }], adjNegList: [{ amount: '', reason: '' }], expectedPayout: '', actualPayout: '', varianceReason: ''
});

export default function DeliverySettlements({ db = [], setDb, setDeliveryDb, salesDb = [], receiptsDb = [], setReceiptsDb }) {
  
  const [localDb, setLocalDb] = useState(() => {
    return db.length > 0 ? db : (JSON.parse(localStorage.getItem('erp_delivery')) || []);
  });

  const activeSalesDb = salesDb.length > 0 ? salesDb : (JSON.parse(localStorage.getItem('erp_sales_db')) || []);
  const activeReceiptsDb = receiptsDb.length > 0 ? receiptsDb : (JSON.parse(localStorage.getItem('erp_receipts')) || []);

  const [formData, setFormData] = useState(getInitialFormState());
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const migrateDeliveryToFirebase = async () => {
      const localData = JSON.parse(localStorage.getItem('erp_delivery'));
      const isMigrated = localStorage.getItem('erp_delivery_migrated');
      
      if (localData && Array.isArray(localData) && localData.length > 0 && !isMigrated) {
        try {
          const batch = writeBatch(firebaseDb);
          localData.forEach(record => {
            const recordId = record.id || Date.now().toString() + Math.random().toString(36).substring(7);
            const docRef = doc(firebaseDb, "erp_delivery", recordId);
            batch.set(docRef, { ...record, id: recordId });
          });
          await batch.commit();
          localStorage.setItem('erp_delivery_migrated', 'true');
        } catch (error) {
          console.error("Migration failed: ", error);
        }
      }
    };
    migrateDeliveryToFirebase();
  }, []);

  useEffect(() => {
    if (db.length > 0) setLocalDb(db);
  }, [db]);
  
  useEffect(() => {
    if (!formData.id && !formData.grossSales) {
      const fetchedGross = calculateErpGross(formData.dateFrom, formData.dateTo, formData.platform, activeSalesDb);
      if (fetchedGross) setFormData(prev => ({ ...prev, grossSales: fetchedGross }));
    }
    // eslint-disable-next-line
  }, []);

  const handleIdentifierChange = (e) => {
    const { name, value } = e.target;
    let newFrom = formData.dateFrom;
    let newTo = formData.dateTo;
    let newPlat = formData.platform;

    if (name === 'dateFrom') { newFrom = value; newTo = getSundayAfter(value); } 
    else if (name === 'dateTo') { newTo = value; } 
    else if (name === 'platform') { newPlat = value; }

    const targetNum = toDateNum(newTo);
    const existing = localDb.find(r => toDateNum(r.dateTo || r.date) === targetNum && r.platform === newPlat);

    if (existing) {
      const loaded = { ...existing };
      if (!loaded.adjPosList) loaded.adjPosList = [{ amount: loaded.adjustmentPositive || '', reason: loaded.adjustmentPositiveReason || '' }];
      if (!loaded.adjNegList) loaded.adjNegList = [{ amount: loaded.adjustmentNegative || '', reason: loaded.adjustmentNegativeReason || '' }];
      setFormData({ ...getInitialFormState(), ...loaded });
    } else {
      const fetchedGross = calculateErpGross(newFrom, newTo, newPlat, activeSalesDb);
      setFormData({
        ...getInitialFormState(), dateFrom: newFrom, dateTo: newTo, platform: newPlat, grossSales: fetchedGross !== '' ? fetchedGross : ''
      });
    }
  };

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    
    if (type === 'date') {
      setFormData(prev => ({ ...prev, [name]: value }));
      return;
    }

    const textFields = ['grossVarianceReason', 'varianceReason'];
    if (textFields.includes(name)) {
      setFormData(prev => ({ ...prev, [name]: value }));
    } else {
      const cleanValue = value.replace(/[^0-9.-]/g, '');
      const numValue = cleanValue === '' ? '' : Number(cleanValue);
      
      if (name === 'commission') {
        setFormData(prev => ({ ...prev, commission: cleanValue, vatOnCommission: numValue === '' ? '' : (numValue * 0.20) }));
      } else if (name === 'advertisement') {
        setFormData(prev => ({ ...prev, advertisement: cleanValue, vatOnAdvertisement: numValue === '' ? '' : (numValue * 0.20) }));
      } else if (name === 'serviceCharges') {
        setFormData(prev => ({ ...prev, serviceCharges: cleanValue, vatOnServiceCharges: (prev.platform === 'Just Eat') ? '' : (numValue === '' ? '' : (numValue * 0.20)) }));
      } else {
        setFormData(prev => ({ ...prev, [name]: cleanValue }));
      }
    }
  };

  const handleAdjChange = (type, index, field, value) => {
    const listName = type === 'pos' ? 'adjPosList' : 'adjNegList';
    setFormData(prev => {
      const newList = [...prev[listName]];
      if (field === 'amount') newList[index] = { ...newList[index], [field]: value.replace(/[^0-9.-]/g, '') };
      else newList[index] = { ...newList[index], [field]: value };
      return { ...prev, [listName]: newList };
    });
  };

  const addAdjRow = (type) => {
    const listName = type === 'pos' ? 'adjPosList' : 'adjNegList';
    setFormData(prev => ({ ...prev, [listName]: [...prev[listName], { amount: '', reason: '' }] }));
  };

  const removeAdjRow = (type, index) => {
    const listName = type === 'pos' ? 'adjPosList' : 'adjNegList';
    setFormData(prev => {
      const newList = [...prev[listName]];
      newList.splice(index, 1);
      if (newList.length === 0) newList.push({ amount: '', reason: '' });
      return { ...prev, [listName]: newList };
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (e.target.tagName.toLowerCase() === 'button' || e.target.classList.contains('save-btn')) {
        return; 
      }
      e.preventDefault(); 
      const container = document.getElementById('settlement-form-container');
      if (container) {
        const focusable = Array.from(container.querySelectorAll('.enter-focusable:not(:disabled)'));
        const index = focusable.indexOf(e.target);
        if (index > -1 && index < focusable.length - 1) focusable[index + 1].focus();
      }
    }
  };

  const val = (num) => Number(num) || 0;
  const isJustEat = formData.platform === 'Just Eat';

  const totalAdjPos = formData.adjPosList.reduce((sum, a) => sum + val(a.amount), 0);
  const totalAdjNeg = formData.adjNegList.reduce((sum, a) => sum + val(a.amount), 0);

  const erpGrossInput = val(formData.grossSales);
  const serviceCharges = val(formData.serviceCharges);
  
  const effectiveErpGross = isJustEat ? (erpGrossInput - serviceCharges) : erpGrossInput;
  
  let theoreticalComm = 0;
  if (formData.platform === 'Uber Eats') theoreticalComm = effectiveErpGross * 0.26;
  else if (formData.platform === 'Deliveroo') theoreticalComm = effectiveErpGross * 0.25;
  else if (formData.platform === 'Just Eat') theoreticalComm = effectiveErpGross * 0.30;
  else if (formData.platform === 'App4') theoreticalComm = effectiveErpGross * 0.04;
  
  const theoreticalVat = theoreticalComm * 0.20;

  const liveExpectedPayout = 
    effectiveErpGross - theoreticalComm - theoreticalVat - val(formData.advertisement) - val(formData.vatOnAdvertisement) - 
    (isJustEat ? 0 : serviceCharges) - (isJustEat ? 0 : val(formData.vatOnServiceCharges)) - val(formData.refunds) - totalAdjNeg + totalAdjPos;

  const liveVariance = val(formData.actualPayout) - liveExpectedPayout;
  const grossVariance = val(formData.platformGross) - effectiveErpGross;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.platform) return alert("Please select a Platform.");

    if (!window.confirm(formData.id ? `Update settlement for ${formData.platform}?` : `Save settlement for ${formData.platform}?`)) return;

    const posReasonString = formData.adjPosList.map(a => a.reason).filter(Boolean).join(' | ');
    const negReasonString = formData.adjNegList.map(a => a.reason).filter(Boolean).join(' | ');
    
    const syncId = formData.syncReceiptId || `sync_del_${Date.now()}`;

    const recordToSave = {
      ...formData,
      adjustmentPositive: totalAdjPos, adjustmentPositiveReason: posReasonString,
      adjustmentNegative: totalAdjNeg, adjustmentNegativeReason: negReasonString,
      expectedPayout: liveExpectedPayout, syncReceiptId: syncId
    };

    let newDb;
    const isNew = !formData.id;
    if (!isNew) {
      newDb = localDb.map(t => t.id === formData.id ? recordToSave : t);
    } else {
      recordToSave.id = Date.now().toString();
      newDb = [...localDb, recordToSave];
    }
    
    newDb.sort((a, b) => toDateNum(b.dateTo || b.date) - toDateNum(a.dateTo || a.date));
    
    setLocalDb(newDb);
    const updateGlobalDb = setDb || setDeliveryDb;
    if (updateGlobalDb) updateGlobalDb(newDb);

    try {
      await setDoc(doc(firebaseDb, "erp_delivery", recordToSave.id), recordToSave);

      // Auto-deposits purely into LK Associates as requested
      if (setReceiptsDb && formData.actualPayout && Number(formData.actualPayout) > 0 && formData.payoutDate) {
        const receiptEntry = {
          id: syncId,
          type: 'Receipt',
          date: formData.payoutDate,
          mode: 'Bank',
          bankName: 'LK Associates', 
          category: 'Income / Revenue', 
          account: formData.platform,
          description: `Auto-Settlement: ${formData.platform} (${formatDate(formData.dateFrom)} to ${formatDate(formData.dateTo)})`,
          amount: Number(formData.actualPayout),
          fromBank: '',
          toBank: '',
          debitAccount: '',
          creditAccount: ''
        };
        
        const existingReceipt = activeReceiptsDb.find(r => r.id === syncId);
        let updatedReceipts;
        if (existingReceipt) {
           updatedReceipts = activeReceiptsDb.map(r => r.id === syncId ? receiptEntry : r);
        } else {
           updatedReceipts = [...activeReceiptsDb, receiptEntry];
        }
        setReceiptsDb(updatedReceipts);
        
        await setDoc(doc(firebaseDb, "erp_receipts", syncId), receiptEntry);
      }

      alert(isNew ? `✅ ${formData.platform} settlement saved!` : `✅ ${formData.platform} settlement updated!`);
      setFormData(recordToSave);
    } catch (error) {
      console.error("Error saving settlement to Firebase: ", error);
      alert("Database Error: Could not save the settlement.");
    }
  };

  const handleEdit = (row) => {
    const loadedRecord = { ...row };
    if (!loadedRecord.adjPosList) loadedRecord.adjPosList = [{ amount: loadedRecord.adjustmentPositive || '', reason: loadedRecord.adjustmentPositiveReason || '' }];
    if (!loadedRecord.adjNegList) loadedRecord.adjNegList = [{ amount: loadedRecord.adjustmentNegative || '', reason: loadedRecord.adjustmentNegativeReason || '' }];
    setFormData(loadedRecord);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (row) => {
    if (window.confirm("Are you sure you want to completely delete this settlement?")) {
      const newDb = localDb.filter(t => t.id !== row.id);
      
      setLocalDb(newDb);
      const updateGlobalDb = setDb || setDeliveryDb;
      if (updateGlobalDb) updateGlobalDb(newDb);
      
      try {
        await deleteDoc(doc(firebaseDb, "erp_delivery", row.id));

        if (setReceiptsDb && row.syncReceiptId) {
           const newReceipts = activeReceiptsDb.filter(r => r.id !== row.syncReceiptId);
           setReceiptsDb(newReceipts);
           await deleteDoc(doc(firebaseDb, "erp_receipts", row.syncReceiptId));
        }
      } catch (error) {
        console.error("Error deleting from Firebase: ", error);
        alert("Database Error: Could not delete the settlement.");
      }
    }
  };

  const handleCancel = () => {
    const fetchedGross = calculateErpGross(getInitialFormState().dateFrom, getInitialFormState().dateTo, getInitialFormState().platform, activeSalesDb);
    setFormData({ ...getInitialFormState(), grossSales: fetchedGross });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredDb = useMemo(() => {
    if (!searchTerm.trim()) return localDb;
    const term = searchTerm.toLowerCase();
    return localDb.filter(row => 
      String(row.platform || '').toLowerCase().includes(term) ||
      String(formatDate(row.dateTo) || '').includes(term) ||
      String(row.varianceReason || '').toLowerCase().includes(term) ||
      String(row.grossVarianceReason || '').toLowerCase().includes(term)
    );
  }, [localDb, searchTerm]);

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#ffffff', minHeight: '100vh', color: '#000' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Delivery Settlements</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Reconcile platform payouts against ERP sales.</p>
          </div>
        </div>

        <div id="settlement-form-container" style={{ marginBottom: '40px' }}>
          
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
            <thead>
              <tr><th colSpan="2" style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>SETTLEMENT PERIOD & PLATFORM</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={labelTd}>Period Date Range</td>
                <td style={{...inputTd, padding: '8px 12px', background: '#fff'}}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="date" className="enter-focusable" name="dateFrom" value={formData.dateFrom} onChange={handleIdentifierChange} onKeyDown={handleKeyDown} style={{ border: 'none', outline: 'none', fontFamily: sheetTheme.font, fontSize: '13px', background: 'transparent' }} />
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280' }}>TO</span>
                    <input type="date" className="enter-focusable" name="dateTo" value={formData.dateTo} onChange={handleIdentifierChange} onKeyDown={handleKeyDown} style={{ border: 'none', outline: 'none', fontFamily: sheetTheme.font, fontSize: '13px', background: 'transparent' }} />
                  </div>
                </td>
              </tr>
              <tr>
                <td style={labelTd}>Select Platform</td>
                <td style={inputTd}>
                  <select className="enter-focusable" name="platform" value={formData.platform} onChange={handleIdentifierChange} onKeyDown={handleKeyDown} style={{ width: '100%', border: 'none', padding: '8px 12px', boxSizing: 'border-box', fontFamily: sheetTheme.font, fontSize: '13px', outline: 'none', background: 'transparent', color: sheetTheme.headerBlueText, fontWeight: '700' }}>
                    <option value="Uber Eats">Uber Eats</option>
                    <option value="Deliveroo">Deliveroo</option>
                    <option value="Just Eat">Just Eat</option>
                    <option value="App4">App4</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
            
            <div style={{ flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th colSpan="2" style={{ background: sheetTheme.headerOrangeBg, color: sheetTheme.headerOrangeText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Gross & Deductions</th></tr>
                </thead>
                <tbody>
                  <tr><td style={labelTd}>ERP Gross Sales (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="grossSales" value={formData.grossSales} onChange={handleChange} /></td></tr>
                  
                  {isJustEat && (
                    <tr>
                      <td style={{...labelTd, color: '#0369a1'}}>Effective ERP Gross (£)</td>
                      <td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={fmtMoney(effectiveErpGross)} bold={true} color="#0369a1" bg="#e0f2fe" /></td>
                    </tr>
                  )}

                  <tr><td style={labelTd}>Platform Gross (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="platformGross" value={formData.platformGross} onChange={handleChange} /></td></tr>
                  
                  <tr><td style={{...labelTd, fontWeight: '800'}}>Gross Variance (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><VarianceBadge variance={grossVariance} /></td></tr>
                  <tr><td style={labelTd}>Gross Var Reason</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={false} name="grossVarianceReason" value={formData.grossVarianceReason} onChange={handleChange} align="left" placeholder="Enter reason if required..." /></td></tr>
                  
                  <tr><td style={labelTd}>Commission (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="commission" value={formData.commission} onChange={handleChange} textColor="#dc2626" /></td></tr>
                  <tr><td style={labelTd}>VAT on Commission (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="vatOnCommission" value={formData.vatOnCommission} onChange={handleChange} textColor="#dc2626" bg="#fef2f2" /></td></tr>
                  
                  <tr><td style={labelTd}>Advertisement (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="advertisement" value={formData.advertisement} onChange={handleChange} textColor="#dc2626" /></td></tr>
                  <tr><td style={labelTd}>VAT on Adv (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="vatOnAdvertisement" value={formData.vatOnAdvertisement} onChange={handleChange} textColor="#dc2626" bg="#fef2f2" /></td></tr>
                  
                  <tr><td style={{...labelTd, color: isJustEat ? '#94a3b8' : '#333'}}>Service Charges (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="serviceCharges" value={formData.serviceCharges} onChange={handleChange} textColor={isJustEat ? '#94a3b8' : '#dc2626'} /></td></tr>
                  <tr><td style={{...labelTd, color: isJustEat ? '#94a3b8' : '#333'}}>VAT on Service Chg (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="vatOnServiceCharges" value={formData.vatOnServiceCharges} onChange={handleChange} textColor={isJustEat ? '#94a3b8' : '#dc2626'} bg={isJustEat ? '#f1f5f9' : '#fef2f2'} disabled={isJustEat} /></td></tr>
                  
                  <tr><td style={labelTd}>Customer Refunds (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="refunds" value={formData.refunds} onChange={handleChange} textColor="#dc2626" /></td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th colSpan="2" style={{ background: sheetTheme.headerGreenBg, color: sheetTheme.headerGreenText, padding: '8px 12px', textAlign: 'left', border: `1px solid ${sheetTheme.border}`, fontSize: '14px', fontWeight: '700' }}>Adjustments & Payout</th></tr>
                </thead>
                <tbody>
                  
                  <tr><td colSpan="2" style={{ background: '#f1f5f9', fontSize: '12px', fontWeight: '700', padding: '6px 12px', color: '#059669', border: `1px solid ${sheetTheme.border}` }}>Positive Adjustments (+)</td></tr>
                  {formData.adjPosList.map((adj, index) => (
                    <tr key={`pos-${index}`}>
                      <td style={{ padding: 0, border: `1px solid ${sheetTheme.border}`, background: sheetTheme.labelBg }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <button type="button" onClick={() => removeAdjRow('pos', index)} style={{ padding: '8px 10px', background: 'transparent', color: '#dc2626', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, cursor: 'pointer' }}><Trash2 size={14} /></button>
                          <input className="enter-focusable" type="text" value={adj.reason} onFocus={(e) => { e.target.select(); }} onChange={(e) => handleAdjChange('pos', index, 'reason', e.target.value)} onKeyDown={handleKeyDown} placeholder="Reason..." style={{ width: '100%', border: 'none', padding: '8px 8px', outline: 'none', fontFamily: sheetTheme.font, fontSize: '13px', background: 'transparent' }} />
                        </div>
                      </td>
                      <td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="amount" value={adj.amount} onChange={(e) => handleAdjChange('pos', index, 'amount', e.target.value)} textColor="#059669" /></td>
                    </tr>
                  ))}
                  <tr><td colSpan="2" style={{ padding: '0', border: `1px solid ${sheetTheme.border}` }}><button type="button" onClick={() => addAdjRow('pos')} style={{ width: '100%', padding: '6px', background: '#fff', color: '#059669', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}><Plus size={14}/> Add (+) Row</button></td></tr>

                  <tr><td colSpan="2" style={{ background: '#f1f5f9', fontSize: '12px', fontWeight: '700', padding: '6px 12px', color: '#dc2626', border: `1px solid ${sheetTheme.border}` }}>Negative Adjustments (-)</td></tr>
                  {formData.adjNegList.map((adj, index) => (
                    <tr key={`neg-${index}`}>
                      <td style={{ padding: 0, border: `1px solid ${sheetTheme.border}`, background: sheetTheme.labelBg }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <button type="button" onClick={() => removeAdjRow('neg', index)} style={{ padding: '8px 10px', background: 'transparent', color: '#dc2626', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, cursor: 'pointer' }}><Trash2 size={14} /></button>
                          <input className="enter-focusable" type="text" value={adj.reason} onFocus={(e) => { e.target.select(); }} onChange={(e) => handleAdjChange('neg', index, 'reason', e.target.value)} onKeyDown={handleKeyDown} placeholder="Reason..." style={{ width: '100%', border: 'none', padding: '8px 8px', outline: 'none', fontFamily: sheetTheme.font, fontSize: '13px', background: 'transparent' }} />
                        </div>
                      </td>
                      <td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="amount" value={adj.amount} onChange={(e) => handleAdjChange('neg', index, 'amount', e.target.value)} textColor="#dc2626" /></td>
                    </tr>
                  ))}
                  <tr><td colSpan="2" style={{ padding: '0', border: `1px solid ${sheetTheme.border}` }}><button type="button" onClick={() => addAdjRow('neg')} style={{ width: '100%', padding: '6px', background: '#fff', color: '#dc2626', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}><Plus size={14}/> Add (-) Row</button></td></tr>
                  
                  <tr><td style={{...labelTd, fontWeight: '800', background: '#dbeafe'}}>ERP Expected Payout</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><CellCalc value={`£ ${fmtMoney(liveExpectedPayout)}`} bold={true} color="#1d4ed8" bg="#dbeafe" /></td></tr>
                  
                  <tr><td style={labelTd}>Actual Bank Payout (£)</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={true} name="actualPayout" value={formData.actualPayout} onChange={handleChange} /></td></tr>
                  
                  <tr>
                    <td style={labelTd}>Date Received in Bank</td>
                    <td style={{...inputTd, padding: '8px 12px'}}>
                      <input type="date" className="enter-focusable" name="payoutDate" value={formData.payoutDate} onChange={handleChange} onKeyDown={handleKeyDown} style={{ width: '100%', border: 'none', outline: 'none', fontFamily: sheetTheme.font, fontSize: '13px', background: 'transparent' }} />
                    </td>
                  </tr>
                  
                  <tr><td style={{...labelTd, fontWeight: '800'}}>Net Variance (£)</td><td style={{border: `1px solid ${sheetTheme.border}`, padding: 0}}><VarianceBadge variance={liveVariance} /></td></tr>
                  <tr><td style={labelTd}>Net Variance Notes</td><td style={inputTd}><CellInput onKeyDown={handleKeyDown} isNumeric={false} name="varianceReason" value={formData.varianceReason} onChange={handleChange} align="left" placeholder="Explain variance..." /></td></tr>
                </tbody>
              </table>
            </div>

          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${sheetTheme.border}` }}>
            <button type="button" onClick={handleCancel} style={{ padding: '8px 24px', background: '#f3f4f6', color: '#374151', fontSize: '13px', fontWeight: '700', border: `1px solid #d1d5db`, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} className="enter-focusable save-btn" style={{ padding: '8px 32px', background: formData.id ? '#166534' : '#0369a1', color: '#fff', fontSize: '13px', fontWeight: '700', border: 'none', cursor: 'pointer' }}>
              {formData.id ? `Update ${formData.platform}` : `Mark Received: ${formData.platform}`}
            </button>
          </div>
        </div>

        {/* LOG TABLE */}
        <div style={{ background: '#fff', border: `1px solid ${sheetTheme.border}` }}>
          <div style={{ background: sheetTheme.headerBlueBg, padding: '12px', borderBottom: `1px solid ${sheetTheme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: sheetTheme.headerBlueText }}>Recent Settlements</h2>
            <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ border: `1px solid ${sheetTheme.border}`, padding: '4px 8px', outline: 'none', fontSize: '12px', fontFamily: sheetTheme.font, width: '150px' }} />
          </div>
          
          <div style={{ overflowX: 'auto', maxHeight: '500px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px', backgroundColor: '#fff' }}>
              <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#374151', textTransform: 'uppercase', position: 'sticky', top: 0 }}>
                <tr>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}` }}>Platform & Period</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right' }}>ERP Gross</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right' }}>Expected</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right' }}>Actual Bank</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right' }}>Variance</th>
                  <th style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDb.length === 0 ? (
                  <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>No records match your search.</td></tr>
                ) : (
                  filteredDb.map((row) => {
                    const varianceNum = val(row.actualPayout) - val(row.expectedPayout);
                    return (
                      <tr key={row.id}>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, fontSize: '12px' }}>
                          <div style={{ fontWeight: '700', color: sheetTheme.headerBlueText }}>{row.platform}</div>
                          <div style={{ color: '#64748b', fontSize: '11px' }}>{formatDate(row.dateFrom)} to {formatDate(row.dateTo)}</div>
                        </td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontSize: '13px' }}>{fmtMoney(row.grossSales)}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontSize: '13px' }}>{fmtMoney(row.expectedPayout)}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '700', color: '#059669', fontSize: '13px' }}>{fmtMoney(row.actualPayout)}</td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'right', fontWeight: '800', color: Math.abs(varianceNum) < 0.01 ? '#059669' : (varianceNum > 0 ? '#854d0e' : '#991b1b'), fontSize: '13px' }}>
                          {Math.abs(varianceNum) < 0.01 ? '✓' : `${varianceNum > 0 ? '+ ' : ''}${fmtMoney(varianceNum)}`}
                        </td>
                        <td style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, textAlign: 'center' }}>
                          <button onClick={() => handleEdit(row)} style={{ background: 'transparent', color: '#0369a1', border: 'none', cursor: 'pointer', marginRight: '8px' }} title="Edit"><Edit2 size={14} /></button>
                          <button onClick={() => handleDelete(row)} style={{ background: 'transparent', color: '#dc2626', border: 'none', cursor: 'pointer' }} title="Delete"><Trash2 size={14} /></button>
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