import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, doc, deleteDoc, writeBatch } from "firebase/firestore";
import { PackageOpen, PlusCircle, LayoutDashboard, Trash2, Save, ShoppingCart, XCircle } from 'lucide-react';

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
  
  // Modal States for Inline Addition
  const [showIngModal, setShowIngModal] = useState(false);
  const [pendingLineIndex, setPendingLineIndex] = useState(null);
  const [newIngredient, setNewIngredient] = useState({ name: '', category: 'Food', unit: 'kg' });
  
  // Receiving Form States
  const [receiveForm, setReceiveForm] = useState({
    date: getToday(), supplier: '', invoiceRef: '', totalVat: '',
    lines: [{ id: Date.now(), ingredientId: '', qty: '', rate: '' }]
  });

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      try {
        const ingSnap = await getDocs(collection(db, "erp_ingredients"));
        const recSnap = await getDocs(collection(db, "erp_stock_receipts"));
        
        const loadedIng = [];
        ingSnap.forEach(doc => loadedIng.push({ id: doc.id, ...doc.data() }));
        setIngredientsDb(loadedIng.sort((a,b) => a.name.localeCompare(b.name)));

        const loadedRec = [];
        recSnap.forEach(doc => loadedRec.push({ id: doc.id, ...doc.data() }));
        setStockReceiptsDb(loadedRec);
      } catch (err) {
        console.error("Failed to load inventory data", err);
      }
    };
    loadData();
  }, []);

  // --- ADD INGREDIENT LOGIC ---
  const handleSaveIngredient = async (e) => {
    e.preventDefault();
    if (!newIngredient.name.trim()) return;
    
    const record = { ...newIngredient, name: newIngredient.name.trim() };
    try {
      const docRef = await addDoc(collection(db, "erp_ingredients"), record);
      const addedIng = { id: docRef.id, ...record };
      setIngredientsDb(prev => [...prev, addedIng].sort((a,b) => a.name.localeCompare(b.name)));
      
      // If added from the Receiving Form dropdown
      if (pendingLineIndex !== null) {
        handleReceiveLineChange(pendingLineIndex, 'ingredientId', docRef.id);
      }
      
      setNewIngredient({ name: '', category: 'Food', unit: 'kg' });
      setShowIngModal(false);
      setPendingLineIndex(null);
      if (activeTab === 'setup') alert("✅ Ingredient Added!");
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

  // --- TAB 2: STOCK RECEIVING (UNIFIED INVOICE) ---
  const handleReceiveLineChange = (index, field, value) => {
    setReceiveForm(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addReceiveLine = () => {
    setReceiveForm(prev => ({ ...prev, lines: [...prev.lines, { id: Date.now(), ingredientId: '', qty: '', rate: '' }] }));
  };

  const removeReceiveLine = (index) => {
    setReceiveForm(prev => {
      const newLines = [...prev.lines];
      newLines.splice(index, 1);
      if (newLines.length === 0) newLines.push({ id: Date.now(), ingredientId: '', qty: '', rate: '' });
      return { ...prev, lines: newLines };
    });
  };

  // Auto-calculated Subtotal
  const formSubtotal = useMemo(() => {
    return receiveForm.lines.reduce((sum, line) => sum + ((Number(line.qty) || 0) * (Number(line.rate) || 0)), 0);
  }, [receiveForm.lines]);

  const handleSaveReceipt = async (e) => {
    e.preventDefault();
    if (!receiveForm.supplier.trim()) return alert("Supplier Name is required to post to Accounts Payable.");
    
    const cleanLines = receiveForm.lines.filter(l => l.ingredientId && Number(l.qty) > 0 && Number(l.rate) >= 0);
    if (cleanLines.length === 0) return alert("Please add at least one valid item with a quantity and rate.");

    const totalVat = Number(receiveForm.totalVat) || 0;
    const totalNet = formSubtotal;
    const totalGross = totalNet + totalVat;

    const batch = writeBatch(db);
    const newStockRecords = [];
    const purchaseLines = [];

    // Apportion VAT across lines based on their financial weight
    let remainingVat = totalVat;
    
    cleanLines.forEach((line, index) => {
      const lineNet = Number(line.qty) * Number(line.rate);
      
      // Calculate Line VAT (Pro-Rata)
      const isLast = index === cleanLines.length - 1;
      const lineVat = totalNet > 0 
          ? (isLast ? remainingVat : Number(((lineNet / totalNet) * totalVat).toFixed(2)))
          : 0;
      remainingVat -= lineVat;

      const ingName = ingredientsDb.find(i => i.id === line.ingredientId)?.name || 'Unknown Item';

      // 1. Prepare Stock Receipt Record (Strictly Net Cost for Inventory)
      const stockId = Date.now().toString() + Math.random().toString(36).substring(7);
      const stockRecord = {
        id: stockId,
        date: receiveForm.date,
        supplier: receiveForm.supplier.trim(),
        invoiceRef: receiveForm.invoiceRef,
        ingredientId: line.ingredientId,
        qty: Number(line.qty),
        totalCost: lineNet,
        unitCost: Number(line.rate)
      };
      batch.set(doc(db, "erp_stock_receipts", stockId), stockRecord);
      newStockRecords.push(stockRecord);

      // 2. Prepare Purchase Ledger Line (Gross = Net + VAT)
      purchaseLines.push({
        account: 'Purchases', // This routes safely to COGS/Expenses in the P&L
        description: `Stock Delivery: ${ingName} (${line.qty})`,
        gross: lineNet + lineVat,
        vat: lineVat
      });
    });

    // 3. Prepare the Master Purchase Invoice (Hits P&L and Supplier Payable)
    const purchaseId = "INV-STK-" + Date.now().toString();
    const purchaseInvoice = {
      id: purchaseId,
      date: receiveForm.date,
      supplier: receiveForm.supplier.trim(),
      invoiceRef: receiveForm.invoiceRef || 'Stock Entry',
      totalGross: totalGross,
      totalVat: totalVat,
      totalNet: totalNet,
      lines: purchaseLines
    };
    batch.set(doc(db, "erp_purchases", purchaseId), purchaseInvoice);

    try {
      await batch.commit();
      setStockReceiptsDb(prev => [...prev, ...newStockRecords]);
      alert("✅ Delivery Processed! Stock updated and Supplier Purchase Invoice posted to ledgers.");
      setReceiveForm({ date: getToday(), supplier: '', invoiceRef: '', totalVat: '', lines: [{ id: Date.now(), ingredientId: '', qty: '', rate: '' }] });
      setActiveTab('dashboard');
    } catch (err) {
      console.error(err);
      alert("Database error saving receipt.");
    }
  };

  // --- TAB 3: LIVE DASHBOARD CALCULATIONS ---
  const currentStock = useMemo(() => {
    const stockMap = {};
    ingredientsDb.forEach(ing => {
      stockMap[ing.id] = { ...ing, totalQty: 0, totalValue: 0, avgUnitCost: 0 };
    });

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
      
      {/* INLINE INGREDIENT MODAL */}
      {showIngModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '400px', borderRadius: '8px', border: `1px solid ${sheetTheme.border}`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}`, background: '#f3e8ff', color: '#7e22ce', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New Ingredient</h2>
              <button onClick={() => { setShowIngModal(false); setPendingLineIndex(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7e22ce' }}><XCircle size={18} /></button>
            </div>
            <form onSubmit={handleSaveIngredient} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Ingredient Name</label>
                <input type="text" value={newIngredient.name} onChange={e => setNewIngredient({...newIngredient, name: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Category</label>
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
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Measurement Unit</label>
                <select value={newIngredient.unit} onChange={e => setNewIngredient({...newIngredient, unit: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }}>
                  <option value="kg">Kilograms (kg)</option>
                  <option value="L">Liters (L)</option>
                  <option value="units">Individual Units (pcs/boxes)</option>
                </select>
              </div>
              <button type="submit" style={{ padding: '10px', background: '#7e22ce', color: '#fff', fontWeight: '700', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Save & Select</button>
            </form>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Inventory & Stock</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Manage ingredients and process stock deliveries as unified purchase invoices.</p>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div style={{ display: 'flex', border: `1px solid ${sheetTheme.border}`, marginBottom: '24px' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'dashboard' ? sheetTheme.headerBlueBg : '#fff', color: activeTab === 'dashboard' ? sheetTheme.headerBlueText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><LayoutDashboard size={16} /> LIVE STOCK</button>
          <button onClick={() => setActiveTab('receive')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'receive' ? sheetTheme.headerGreenBg : '#fff', color: activeTab === 'receive' ? sheetTheme.headerGreenText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}><ShoppingCart size={16} /> RECEIVE DELIVERY (INVOICE)</button>
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
                  <th style={{ padding: '12px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Avg Cost / Unit (Net)</th>
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

        {/* TAB CONTENT: RECEIVE STOCK (UNIFIED INVOICE) */}
        {activeTab === 'receive' && (
          <form onSubmit={handleSaveReceipt} style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '16px', background: sheetTheme.headerGreenBg, borderBottom: `1px solid ${sheetTheme.border}` }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Delivery Date</label>
                  <input type="date" value={receiveForm.date} onChange={e => setReceiveForm({...receiveForm, date: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Supplier Name (Accounts Payable)</label>
                  <input type="text" value={receiveForm.supplier} onChange={e => setReceiveForm({...receiveForm, supplier: e.target.value})} placeholder="e.g. Booker Wholesale" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Supplier Invoice Ref</label>
                  <input type="text" value={receiveForm.invoiceRef} onChange={e => setReceiveForm({...receiveForm, invoiceRef: e.target.value})} placeholder="Optional" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                </div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#4b5563', textTransform: 'uppercase' }}>
                <tr>
                  <th style={{ padding: '10px 16px', textAlign: 'left', borderBottom: `1px solid ${sheetTheme.border}` }}>Ingredient</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Qty Received</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Net Rate (£)</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Net Total (£)</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${sheetTheme.border}`, width: '5%' }}></th>
                </tr>
              </thead>
              <tbody>
                {receiveForm.lines.map((line, idx) => {
                  const selectedIng = ingredientsDb.find(i => i.id === line.ingredientId);
                  const unitLabel = selectedIng ? selectedIng.unit : '';
                  const lineNetTotal = (Number(line.qty) || 0) * (Number(line.rate) || 0);

                  return (
                    <tr key={line.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '8px 16px' }}>
                        <select 
                          value={line.ingredientId} 
                          onChange={e => {
                            if (e.target.value === 'ADD_NEW_ING') {
                              setPendingLineIndex(idx);
                              setShowIngModal(true);
                            } else {
                              handleReceiveLineChange(idx, 'ingredientId', e.target.value);
                            }
                          }} 
                          style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} 
                          required
                        >
                          <option value="">-- Choose Ingredient --</option>
                          {ingredientsDb.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                          <option value="ADD_NEW_ING" style={{ fontWeight: '800', color: '#0369a1' }}>➕ Add New Ingredient...</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="number" step="any" value={line.qty} onChange={e => handleReceiveLineChange(idx, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                        <span style={{ fontSize: '12px', color: '#6b7280', width: '30px' }}>{unitLabel}</span>
                      </td>
                      <td style={{ padding: '8px 16px' }}>
                        <input type="number" step="any" value={line.rate} onChange={e => handleReceiveLineChange(idx, 'rate', e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '8px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                      </td>
                      <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '700', fontSize: '13px' }}>
                        {fmtMoney(lineNetTotal)}
                      </td>
                      <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                        <button type="button" onClick={() => removeReceiveLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td colSpan="5" style={{ padding: '12px 16px', background: '#f8fafc' }}>
                    <button type="button" onClick={addReceiveLine} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#fff', color: '#0369a1', border: `1px dashed ${sheetTheme.border}`, borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><PlusCircle size={14} /> Add Another Item</button>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* FINANCIAL INVOICE SUMMARY */}
            <div style={{ padding: '20px 32px', background: '#f1f5f9', borderTop: `2px solid ${sheetTheme.border}`, display: 'flex', justifyContent: 'flex-end' }}>
              <table style={{ width: '300px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px', fontSize: '13px', fontWeight: '700', color: '#4b5563', textAlign: 'right' }}>Subtotal (Net Cost):</td>
                    <td style={{ padding: '8px', fontSize: '14px', fontWeight: '800', textAlign: 'right' }}>£ {fmtMoney(formSubtotal)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', fontSize: '13px', fontWeight: '700', color: '#dc2626', textAlign: 'right', verticalAlign: 'middle' }}>Total VAT (£):</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                      <input type="number" step="any" value={receiveForm.totalVat} onChange={e => setReceiveForm({...receiveForm, totalVat: e.target.value})} placeholder="0.00" style={{ width: '100px', padding: '6px', textAlign: 'right', border: `1px solid #fca5a5`, borderRadius: '4px', color: '#dc2626', fontWeight: '700' }} />
                    </td>
                  </tr>
                  <tr style={{ borderTop: `2px solid ${sheetTheme.border}` }}>
                    <td style={{ padding: '12px 8px', fontSize: '14px', fontWeight: '900', color: '#0f172a', textAlign: 'right' }}>Grand Total (Gross):</td>
                    <td style={{ padding: '12px 8px', fontSize: '16px', fontWeight: '900', color: '#166534', textAlign: 'right' }}>£ {fmtMoney(formSubtotal + (Number(receiveForm.totalVat) || 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ padding: '16px', background: '#e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600' }}>* Saving will update physical stock AND post the liability to Accounts Payable automatically.</div>
              <button type="submit" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 32px', background: '#166534', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '800', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}><Save size={18} /> Post Unified Invoice</button>
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