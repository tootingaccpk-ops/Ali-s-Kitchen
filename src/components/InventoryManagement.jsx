import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc, writeBatch } from "firebase/firestore";
import { PackageOpen, PlusCircle, LayoutDashboard, Trash2, Save, ShoppingCart } from 'lucide-react';

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtMoney = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
};

export default function InventoryManagement() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Database States
  const [ingredientsDb, setIngredientsDb] = useState([]);
  const [stockReceiptsDb, setStockReceiptsDb] = useState([]);
  
  // Setup Form States
  const [newIngredient, setNewIngredient] = useState({ name: '', category: 'Food', unit: 'kg' });
  
  // Receiving Form States
  const [receiveForm, setReceiveForm] = useState({
    date: getToday(), supplier: '', invoiceRef: '',
    lines: [{ id: Date.now(), ingredientId: '', qty: '', totalCost: '' }]
  });

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      try {
        const ingSnap = await getDocs(collection(db, "erp_ingredients"));
        const recSnap = await getDocs(collection(db, "erp_stock_receipts"));
        
        const loadedIng = [];
        ingSnap.forEach(doc => loadedIng.push({ id: doc.id, ...doc.data() }));
        setIngredientsDb(loadedIng);

        const loadedRec = [];
        recSnap.forEach(doc => loadedRec.push({ id: doc.id, ...doc.data() }));
        setStockReceiptsDb(loadedRec);
      } catch (err) {
        console.error("Failed to load inventory data", err);
      }
    };
    loadData();
  }, []);

  // --- TAB 1: MASTER INGREDIENT SETUP ---
  const handleSaveIngredient = async (e) => {
    e.preventDefault();
    if (!newIngredient.name.trim()) return;
    
    const record = { ...newIngredient, name: newIngredient.name.trim() };
    try {
      const docRef = await addDoc(collection(db, "erp_ingredients"), record);
      setIngredientsDb(prev => [...prev, { id: docRef.id, ...record }]);
      setNewIngredient({ name: '', category: 'Food', unit: 'kg' });
      alert("✅ Ingredient Added!");
    } catch (err) {
      alert("Error saving ingredient.");
    }
  };

  const handleDeleteIngredient = async (id) => {
    if (!window.confirm("Delete this ingredient?")) return;
    try {
      await deleteDoc(doc(db, "erp_ingredients", id));
      setIngredientsDb(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      alert("Error deleting ingredient.");
    }
  };

  // --- TAB 2: STOCK RECEIVING ---
  const handleReceiveLineChange = (index, field, value) => {
    setReceiveForm(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addReceiveLine = () => {
    setReceiveForm(prev => ({ ...prev, lines: [...prev.lines, { id: Date.now(), ingredientId: '', qty: '', totalCost: '' }] }));
  };

  const removeReceiveLine = (index) => {
    setReceiveForm(prev => {
      const newLines = [...prev.lines];
      newLines.splice(index, 1);
      if (newLines.length === 0) newLines.push({ id: Date.now(), ingredientId: '', qty: '', totalCost: '' });
      return { ...prev, lines: newLines };
    });
  };

  const handleSaveReceipt = async (e) => {
    e.preventDefault();
    const cleanLines = receiveForm.lines.filter(l => l.ingredientId && Number(l.qty) > 0);
    if (cleanLines.length === 0) return alert("Please add at least one valid item with a quantity.");

    const batch = writeBatch(db);
    const newRecords = [];

    cleanLines.forEach(line => {
      const recordId = Date.now().toString() + Math.random().toString(36).substring(7);
      const record = {
        id: recordId,
        date: receiveForm.date,
        supplier: receiveForm.supplier,
        invoiceRef: receiveForm.invoiceRef,
        ingredientId: line.ingredientId,
        qty: Number(line.qty),
        totalCost: Number(line.totalCost) || 0,
        unitCost: (Number(line.totalCost) || 0) / Number(line.qty)
      };
      batch.set(doc(db, "erp_stock_receipts", recordId), record);
      newRecords.push(record);
    });

    try {
      await batch.commit();
      setStockReceiptsDb(prev => [...prev, ...newRecords]);
      alert("✅ Stock Successfully Received!");
      setReceiveForm({ date: getToday(), supplier: '', invoiceRef: '', lines: [{ id: Date.now(), ingredientId: '', qty: '', totalCost: '' }] });
      setActiveTab('dashboard');
    } catch (err) {
      alert("Database error saving receipt.");
    }
  };

  // --- TAB 3: LIVE DASHBOARD CALCULATIONS ---
  const currentStock = useMemo(() => {
    const stockMap = {};
    
    ingredientsDb.forEach(ing => {
      stockMap[ing.id] = { ...ing, totalQty: 0, totalValue: 0, avgUnitCost: 0 };
    });

    // Phase 1 only calculates "Stock In". Deductions will come in Phase 2.
    stockReceiptsDb.forEach(rec => {
      if (stockMap[rec.ingredientId]) {
        stockMap[rec.ingredientId].totalQty += rec.qty;
        stockMap[rec.ingredientId].totalValue += rec.totalCost;
      }
    });

    return Object.values(stockMap).map(item => {
      if (item.totalQty > 0) item.avgUnitCost = item.totalValue / item.totalQty;
      return item;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredientsDb, stockReceiptsDb]);

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#ffffff', minHeight: '100vh', color: '#000' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Inventory & Stock (Phase 1)</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Manage ingredients, log supplier deliveries, and track unit costs.</p>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div style={{ display: 'flex', border: `1px solid ${sheetTheme.border}`, marginBottom: '24px' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'dashboard' ? sheetTheme.headerBlueBg : '#fff', color: activeTab === 'dashboard' ? sheetTheme.headerBlueText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><LayoutDashboard size={16} /> LIVE STOCK</button>
          <button onClick={() => setActiveTab('receive')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'receive' ? sheetTheme.headerGreenBg : '#fff', color: activeTab === 'receive' ? sheetTheme.headerGreenText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><ShoppingCart size={16} /> RECEIVE DELIVERY</button>
          <button onClick={() => setActiveTab('setup')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'setup' ? '#f3e8ff' : '#fff', color: activeTab === 'setup' ? '#7e22ce' : '#6b7280', border: 'none', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><PackageOpen size={16} /> INGREDIENT MASTER</button>
        </div>

        {/* TAB CONTENT: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, fontSize: '12px', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '12px', borderBottom: `1px solid ${sheetTheme.border}` }}>Ingredient Name</th>
                  <th style={{ padding: '12px', borderBottom: `1px solid ${sheetTheme.border}` }}>Category</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Current Qty</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Avg Cost / Unit</th>
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {currentStock.length === 0 ? (
                  <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>No stock data available. Add ingredients and receive stock first.</td></tr>
                ) : (
                  currentStock.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '12px', fontWeight: '700', fontSize: '13px' }}>{item.name}</td>
                      <td style={{ padding: '12px', fontSize: '12px', color: '#4b5563' }}>{item.category}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: '800', fontSize: '13px', color: '#059669' }}>{fmtQty(item.totalQty)} {item.unit}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '13px' }}>£ {fmtMoney(item.avgUnitCost)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: '700', fontSize: '13px' }}>£ {fmtMoney(item.totalValue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB CONTENT: RECEIVE STOCK */}
        {activeTab === 'receive' && (
          <form onSubmit={handleSaveReceipt} style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '16px', background: sheetTheme.headerGreenBg, borderBottom: `1px solid ${sheetTheme.border}` }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Delivery Date</label>
                  <input type="date" value={receiveForm.date} onChange={e => setReceiveForm({...receiveForm, date: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Supplier Name</label>
                  <input type="text" value={receiveForm.supplier} onChange={e => setReceiveForm({...receiveForm, supplier: e.target.value})} placeholder="e.g. Booker Wholesale" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Invoice Ref #</label>
                  <input type="text" value={receiveForm.invoiceRef} onChange={e => setReceiveForm({...receiveForm, invoiceRef: e.target.value})} placeholder="Optional" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                </div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#4b5563', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '10px 16px', textAlign: 'left', borderBottom: `1px solid ${sheetTheme.border}` }}>Ingredient</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Qty Received</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Total Cost (£)</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${sheetTheme.border}`, width: '10%' }}></th>
                </tr>
              </thead>
              <tbody>
                {receiveForm.lines.map((line, idx) => {
                  const selectedIng = ingredientsDb.find(i => i.id === line.ingredientId);
                  const unitLabel = selectedIng ? selectedIng.unit : '';
                  return (
                    <tr key={line.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '8px 16px' }}>
                        <select value={line.ingredientId} onChange={e => handleReceiveLineChange(idx, 'ingredientId', e.target.value)} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required>
                          <option value="">-- Choose Ingredient --</option>
                          {ingredientsDb.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="number" step="any" value={line.qty} onChange={e => handleReceiveLineChange(idx, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                        <span style={{ fontSize: '12px', color: '#6b7280', width: '30px' }}>{unitLabel}</span>
                      </td>
                      <td style={{ padding: '8px 16px' }}>
                        <input type="number" step="any" value={line.totalCost} onChange={e => handleReceiveLineChange(idx, 'totalCost', e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '8px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                      </td>
                      <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                        <button type="button" onClick={() => removeReceiveLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td colSpan="4" style={{ padding: '12px 16px' }}>
                    <button type="button" onClick={addReceiveLine} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#f1f5f9', color: '#0369a1', border: `1px dashed ${sheetTheme.border}`, borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><PlusCircle size={14} /> Add Item</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ padding: '16px', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${sheetTheme.border}` }}>
              <button type="submit" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', background: '#166534', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '700', cursor: 'pointer' }}><Save size={16} /> Process Stock Delivery</button>
            </div>
          </form>
        )}

        {/* TAB CONTENT: SETUP */}
        {activeTab === 'setup' && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#f3e8ff', color: '#7e22ce', padding: '12px 16px', fontWeight: '700', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Add New Ingredient</div>
              <form onSubmit={handleSaveIngredient} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Ingredient Name</label>
                  <input type="text" value={newIngredient.name} onChange={e => setNewIngredient({...newIngredient, name: e.target.value})} placeholder="e.g. Chicken Breast" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Category</label>
                  <select value={newIngredient.category} onChange={e => setNewIngredient({...newIngredient, category: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }}>
                    <option value="Meat & Poultry">Meat & Poultry</option>
                    <option value="Produce / Veg">Produce / Veg</option>
                    <option value="Dairy">Dairy</option>
                    <option value="Dry Goods / Spices">Dry Goods / Spices</option>
                    <option value="Packaging">Packaging</option>
                    <option value="Beverages">Beverages</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Measurement Unit</label>
                  <select value={newIngredient.unit} onChange={e => setNewIngredient({...newIngredient, unit: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }}>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="L">Liters (L)</option>
                    <option value="units">Individual Units (pcs/boxes)</option>
                  </select>
                </div>
                <button type="submit" style={{ marginTop: '8px', padding: '10px', background: '#7e22ce', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '700', cursor: 'pointer' }}>Save to Master List</button>
              </form>
            </div>

            <div style={{ flex: 2, border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', padding: '12px 16px', fontWeight: '700', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Master Database</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '8px 16px' }}>Name</th>
                    <th style={{ padding: '8px 16px' }}>Category</th>
                    <th style={{ padding: '8px 16px' }}>Unit</th>
                    <th style={{ padding: '8px 16px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientsDb.map(ing => (
                    <tr key={ing.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '8px 16px', fontWeight: '600', fontSize: '13px' }}>{ing.name}</td>
                      <td style={{ padding: '8px 16px', fontSize: '12px', color: '#6b7280' }}>{ing.category}</td>
                      <td style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700' }}>{ing.unit}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                        <button onClick={() => handleDeleteIngredient(ing.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}