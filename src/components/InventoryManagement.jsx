import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, writeBatch } from "firebase/firestore";
import { PackageOpen, PlusCircle, LayoutDashboard, Trash2, Save, ShoppingCart, XCircle, ClipboardList, ChefHat, Edit3, Edit } from 'lucide-react';

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtMoney = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sheetTheme = {
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif', labelBg: '#f8fafc', calcBg: '#f1f5f9',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1', headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerPurpleBg: '#f3e8ff', headerPurpleText: '#7e22ce', headerOrangeBg: '#fff7ed', headerOrangeText: '#c2410c'
};

export default function InventoryManagement() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Databases
  const [itemsDb, setItemsDb] = useState([]);
  const [stockReceiptsDb, setStockReceiptsDb] = useState([]);
  const [recipesDb, setRecipesDb] = useState([]);
  const [productionDb, setProductionDb] = useState([]);
  const [accountsDb, setAccountsDb] = useState([]);
  const [salesDb, setSalesDb] = useState([]);
  
  // Modals & Edit States
  const [showItemModal, setShowItemModal] = useState(false);
  const [pendingLineIndex, setPendingLineIndex] = useState(null);
  const [editItemId, setEditItemId] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', category: 'Food', type: 'Recipe Stock', unit: 'kg' });

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplier, setNewSupplier] = useState('');
  
  // Forms
  const [receiveForm, setReceiveForm] = useState({
    date: getToday(), supplier: '', invoiceRef: '', totalVat: '',
    lines: [{ id: Date.now(), itemId: '', qty: '', rate: '' }]
  });

  const [recipeForm, setRecipeForm] = useState({
    name: '', lines: [{ id: Date.now(), itemId: '', qty: '' }]
  });

  const [productionForm, setProductionForm] = useState({
    date: getToday(), recipeId: '', portionsMade: ''
  });

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [itemSnap, recSnap, recipeSnap, prodSnap, accSnap, salesSnap] = await Promise.all([
          getDocs(collection(db, "erp_ingredients")),
          getDocs(collection(db, "erp_stock_receipts")),
          getDocs(collection(db, "erp_recipes")),
          getDocs(collection(db, "erp_production_logs")),
          getDocs(collection(db, "erp_accounts")),
          getDocs(collection(db, "erp_sales_db"))
        ]);
        
        setItemsDb(itemSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)));
        setStockReceiptsDb(recSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setRecipesDb(recipeSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)));
        setProductionDb(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setAccountsDb(accSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setSalesDb(salesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Failed to load inventory data", err);
      }
    };
    loadData();
  }, []);

  const payableAccounts = useMemo(() => accountsDb.filter(a => String(a.category).toLowerCase().includes('payable') || String(a.category).toLowerCase().includes('supplier')).sort((a,b) => a.name.localeCompare(b.name)), [accountsDb]);

  // --- LIVE DASHBOARD CALCULATIONS (AVERAGE COSTING ENGINE) ---
  const currentRawStock = useMemo(() => {
    const stockMap = {};
    itemsDb.filter(i => i.type === 'Recipe Stock').forEach(item => {
      stockMap[item.id] = { ...item, totalQty: 0, totalValue: 0, avgUnitCost: 0 };
    });

    stockReceiptsDb.forEach(rec => {
      if (!rec.isVoid && stockMap[rec.itemId]) {
        stockMap[rec.itemId].totalQty += Number(rec.qty) || 0;
        stockMap[rec.itemId].totalValue += Number(rec.totalCost) || 0;
      }
    });

    return Object.values(stockMap).map(item => {
      if (item.totalQty > 0) item.avgUnitCost = item.totalValue / item.totalQty;
      else item.avgUnitCost = 0;
      return item;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [itemsDb, stockReceiptsDb]);

  const rawCostMap = useMemo(() => {
    const map = {};
    currentRawStock.forEach(item => { map[item.id] = item.avgUnitCost; });
    return map;
  }, [currentRawStock]);

  const currentPreparedStock = useMemo(() => {
    const prepMap = {};
    recipesDb.forEach(rec => {
      prepMap[rec.id] = { ...rec, totalPortions: 0, totalValue: 0, avgPortionCost: 0 };
    });

    productionDb.forEach(prod => {
      if (prepMap[prod.recipeId]) {
        prepMap[prod.recipeId].totalPortions += Number(prod.portionsMade) || 0;
        prepMap[prod.recipeId].totalValue += Number(prod.totalBatchCost) || 0;
      }
    });

    salesDb.forEach(sale => {
      if (sale.pmix) {
        sale.pmix.forEach(p => {
          if (prepMap[p.recipeId] && p.qtySold) {
            const qty = Number(p.qtySold);
            const currentAvgCost = prepMap[p.recipeId].totalPortions > 0 ? prepMap[p.recipeId].totalValue / prepMap[p.recipeId].totalPortions : 0;
            prepMap[p.recipeId].totalPortions -= qty;
            prepMap[p.recipeId].totalValue -= (qty * currentAvgCost);
          }
        });
      }
    });

    return Object.values(prepMap).map(item => {
      if (item.totalPortions > 0) item.avgPortionCost = item.totalValue / item.totalPortions;
      else item.avgPortionCost = 0;
      return item;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [recipesDb, productionDb, salesDb]);

  const masterInvoicesList = useMemo(() => {
    const map = {};
    stockReceiptsDb.forEach(rec => {
      if (rec.masterInvoiceId && !rec.isVoid) {
        if (!map[rec.masterInvoiceId]) {
          map[rec.masterInvoiceId] = {
            masterInvoiceId: rec.masterInvoiceId,
            date: rec.date,
            supplier: rec.supplier,
            invoiceRef: rec.invoiceRef,
            totalNet: 0,
            lines: []
          };
        }
        map[rec.masterInvoiceId].lines.push(rec);
        map[rec.masterInvoiceId].totalNet += (Number(rec.qty) * Number(rec.unitCost));
      }
    });
    return Object.values(map).sort((a,b) => new Date(b.date) - new Date(a.date));
  }, [stockReceiptsDb]);

  // --- REAL-TIME DUPLICATE CHECK LOGIC ---
  const isDuplicateItemName = useMemo(() => {
    if (!newItem.name || newItem.name.trim() === '') return false;
    const searchName = newItem.name.trim().toLowerCase();
    return itemsDb.some(i => i.name.toLowerCase() === searchName && i.id !== editItemId);
  }, [newItem.name, itemsDb, editItemId]);

  // --- MODAL & ITEM HANDLERS ---
  const handleEditItemClick = (item) => {
    setNewItem({ name: item.name, category: item.category, type: item.type || 'Recipe Stock', unit: item.unit });
    setEditItemId(item.id);
    setActiveTab('setup');
  };

  const handleCancelEditItem = () => {
    setNewItem({ name: '', category: 'Food', type: 'Recipe Stock', unit: 'kg' });
    setEditItemId(null);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (isDuplicateItemName) return; // Hard block just in case
    if (!newItem.name.trim() || !newItem.unit.trim()) return;

    const record = { ...newItem, name: newItem.name.trim(), unit: newItem.unit.trim() };
    
    try {
      if (editItemId) {
        await updateDoc(doc(db, "erp_ingredients", editItemId), record);
        setItemsDb(prev => prev.map(i => i.id === editItemId ? { id: editItemId, ...record } : i));
        alert("✅ Item Updated!");
      } else {
        const docRef = await addDoc(collection(db, "erp_ingredients"), record);
        const addedItem = { id: docRef.id, ...record };
        setItemsDb(prev => [...prev, addedItem].sort((a,b) => a.name.localeCompare(b.name)));
        if (pendingLineIndex !== null) {
          if (activeTab === 'receive') handleReceiveLineChange(pendingLineIndex, 'itemId', docRef.id);
          if (activeTab === 'recipes') handleRecipeLineChange(pendingLineIndex, 'itemId', docRef.id);
        }
        if (activeTab === 'setup') alert("✅ Item Added!");
      }
      setNewItem({ name: '', category: 'Food', type: 'Recipe Stock', unit: 'kg' });
      setShowItemModal(false);
      setPendingLineIndex(null);
      setEditItemId(null);
    } catch (err) { alert("Error saving item."); }
  };

  const handleSaveSupplier = async (e) => {
    e.preventDefault();
    if (!newSupplier.trim()) return;
    const accName = newSupplier.trim();
    try {
      const docRef = await addDoc(collection(db, "erp_accounts"), { name: accName, category: "Accounts Payable (Supplier)", balance: 0 });
      setAccountsDb(prev => [...prev, { id: docRef.id, name: accName, category: "Accounts Payable (Supplier)", balance: 0 }]);
      setReceiveForm({...receiveForm, supplier: accName});
      setShowSupplierModal(false);
      setNewSupplier('');
    } catch(err) { alert("Failed to add supplier"); }
  };

  const handleDeleteItem = async (id) => {
    if (!window.confirm("Delete this item? Warning: Doing this may break past invoices.")) return;
    try {
      await deleteDoc(doc(db, "erp_ingredients", id));
      setItemsDb(prev => prev.filter(i => i.id !== id));
    } catch (err) { alert("Error deleting item."); }
  };

  // --- TAB: STOCK RECEIVING (WITH MIXED ITEM ROUTING & VOID/RELOAD EDIT) ---
  const handleReceiveLineChange = (index, field, value) => {
    setReceiveForm(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addReceiveLine = () => { setReceiveForm(prev => ({ ...prev, lines: [...prev.lines, { id: Date.now(), itemId: '', qty: '', rate: '' }] })); };
  const removeReceiveLine = (index) => { setReceiveForm(prev => { const newLines = [...prev.lines]; newLines.splice(index, 1); if (newLines.length === 0) newLines.push({ id: Date.now(), itemId: '', qty: '', rate: '' }); return { ...prev, lines: newLines }; }); };

  const formSubtotal = useMemo(() => { return receiveForm.lines.reduce((sum, line) => sum + ((Number(line.qty) || 0) * (Number(line.rate) || 0)), 0); }, [receiveForm.lines]);

  const handleSaveReceipt = async (e) => {
    e.preventDefault();
    if (!receiveForm.supplier.trim()) return alert("Supplier Name is required.");
    
    const cleanLines = receiveForm.lines.filter(l => l.itemId && Number(l.qty) > 0 && Number(l.rate) >= 0);
    if (cleanLines.length === 0) return alert("Please add at least one valid item with a quantity greater than zero.");

    const totalVat = Number(receiveForm.totalVat) || 0;
    const totalNet = formSubtotal;
    const totalGross = totalNet + totalVat;

    const batch = writeBatch(db);
    const newStockRecords = [];
    const purchaseLines = [];
    let remainingVat = totalVat;
    
    const masterInvoiceId = receiveForm.masterInvoiceId || ("INV-STK-" + Date.now().toString());

    if (receiveForm.masterInvoiceId) {
      const oldRecords = stockReceiptsDb.filter(r => r.masterInvoiceId === receiveForm.masterInvoiceId);
      oldRecords.forEach(oldRec => {
        batch.update(doc(db, "erp_stock_receipts", oldRec.id), { isVoid: true });
      });
    }
    
    cleanLines.forEach((line, index) => {
      const lineNet = Number(line.qty) * Number(line.rate);
      const isLast = index === cleanLines.length - 1;
      const lineVat = totalNet > 0 ? (isLast ? remainingVat : Number(((lineNet / totalNet) * totalVat).toFixed(2))) : 0;
      remainingVat -= lineVat;

      const itemObj = itemsDb.find(i => i.id === line.itemId);
      const itemName = itemObj ? itemObj.name : 'Unknown Item';
      const itemType = itemObj ? itemObj.type : 'Recipe Stock';

      const stockId = Date.now().toString() + Math.random().toString(36).substring(7);
      const stockRecord = {
        id: stockId,
        masterInvoiceId: masterInvoiceId,
        date: receiveForm.date,
        supplier: receiveForm.supplier.trim(),
        invoiceRef: receiveForm.invoiceRef,
        itemId: line.itemId,
        qty: Number(line.qty),
        totalCost: lineNet,
        unitCost: Number(line.rate),
        isDirectExpense: itemType === 'Direct Expense',
        isVoid: false
      };
      batch.set(doc(db, "erp_stock_receipts", stockId), stockRecord);
      newStockRecords.push(stockRecord);

      const targetLedgerAccount = itemType === 'Direct Expense' ? 'Operating Expenses' : 'Purchases';
      purchaseLines.push({ account: targetLedgerAccount, description: `${itemType === 'Direct Expense' ? 'Expense' : 'Stock'}: ${itemName} (${line.qty})`, gross: lineNet + lineVat, vat: lineVat });
    });

    const purchaseInvoice = { id: masterInvoiceId, date: receiveForm.date, supplier: receiveForm.supplier.trim(), invoiceRef: receiveForm.invoiceRef || 'Stock/Expense Entry', totalGross: totalGross, totalVat: totalVat, totalNet: totalNet, lines: purchaseLines };
    batch.set(doc(db, "erp_purchases", masterInvoiceId), purchaseInvoice);

    try {
      await batch.commit();
      setStockReceiptsDb(prev => [...prev.filter(r => r.masterInvoiceId !== masterInvoiceId), ...newStockRecords]);
      alert("✅ Invoice Processed Successfully!");
      setReceiveForm({ date: getToday(), supplier: '', invoiceRef: '', totalVat: '', lines: [{ id: Date.now(), itemId: '', qty: '', rate: '' }] });
      setActiveTab('dashboard');
    } catch (err) { alert("Database error saving receipt."); }
  };

  const handleEditInvoice = (inv) => {
    setReceiveForm({
      date: inv.date,
      supplier: inv.supplier,
      invoiceRef: inv.invoiceRef,
      totalVat: '', 
      masterInvoiceId: inv.masterInvoiceId,
      lines: inv.lines.map(l => ({ id: l.id, itemId: l.itemId, qty: l.qty === 0 ? '' : l.qty, rate: l.unitCost }))
    });
    setActiveTab('receive');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteInvoice = async (masterInvoiceId) => {
    if (!window.confirm("Void and delete this entire invoice?")) return;
    const batch = writeBatch(db);
    const targetRecords = stockReceiptsDb.filter(r => r.masterInvoiceId === masterInvoiceId);
    targetRecords.forEach(rec => {
      batch.update(doc(db, "erp_stock_receipts", rec.id), { isVoid: true });
    });
    try {
      await batch.commit();
      setStockReceiptsDb(prev => prev.map(r => r.masterInvoiceId === masterInvoiceId ? { ...r, isVoid: true } : r));
      alert("✅ Invoice Voided.");
    } catch(e) { alert("Error voiding invoice."); }
  };

  // --- TAB: RECIPE MASTER ---
  const handleRecipeLineChange = (index, field, value) => {
    setRecipeForm(prev => { const newLines = [...prev.lines]; newLines[index] = { ...newLines[index], [field]: value }; return { ...prev, lines: newLines }; });
  };

  const addRecipeLine = () => { setRecipeForm(prev => ({ ...prev, lines: [...prev.lines, { id: Date.now(), itemId: '', qty: '' }] })); };
  const removeRecipeLine = (index) => { setRecipeForm(prev => { const newLines = [...prev.lines]; newLines.splice(index, 1); if (newLines.length === 0) newLines.push({ id: Date.now(), itemId: '', qty: '' }); return { ...prev, lines: newLines }; }); };

  const handleSaveRecipe = async (e) => {
    e.preventDefault();
    if (!recipeForm.name.trim()) return alert("Recipe name is required.");
    const cleanLines = recipeForm.lines.filter(l => l.itemId && Number(l.qty) > 0);
    if (cleanLines.length === 0) return alert("Please add at least one item to the template.");

    const newRecipe = {
      name: recipeForm.name.trim(),
      ingredients: cleanLines.map(l => ({ itemId: l.itemId, qty: Number(l.qty) }))
    };

    try {
      const docRef = await addDoc(collection(db, "erp_recipes"), newRecipe);
      setRecipesDb(prev => [...prev, { id: docRef.id, ...newRecipe }].sort((a,b) => a.name.localeCompare(b.name)));
      alert("✅ Recipe Template Saved!");
      setRecipeForm({ name: '', lines: [{ id: Date.now(), itemId: '', qty: '' }] });
    } catch (err) { alert("Error saving recipe."); }
  };

  const handleDeleteRecipe = async (id) => {
    if (!window.confirm("Delete this recipe template?")) return;
    try {
      await deleteDoc(doc(db, "erp_recipes", id));
      setRecipesDb(prev => prev.filter(r => r.id !== id));
    } catch (err) { alert("Error deleting recipe."); }
  };

  // --- TAB: KITCHEN PRODUCTION ---
  const handleSaveProduction = async (e) => {
    e.preventDefault();
    if (!productionForm.recipeId || !productionForm.portionsMade) return;
    
    const recipe = recipesDb.find(r => r.id === productionForm.recipeId);
    if (!recipe) return;

    const portions = Number(productionForm.portionsMade);
    let totalBatchCost = 0;
    const rawDeductions = [];

    recipe.ingredients.forEach(ing => {
      const avgCost = rawCostMap[ing.itemId] || 0;
      const costForIng = ing.qty * avgCost;
      totalBatchCost += costForIng;
      
      rawDeductions.push({
        itemId: ing.itemId,
        qty: -ing.qty,
        totalCost: -costForIng,
        unitCost: avgCost
      });
    });

    const prodId = "PROD-" + Date.now();
    const batch = writeBatch(db);

    const prodRecord = {
      id: prodId,
      date: productionForm.date,
      recipeId: productionForm.recipeId,
      portionsMade: portions,
      totalBatchCost: totalBatchCost
    };
    batch.set(doc(db, "erp_production_logs", prodId), prodRecord);

    rawDeductions.forEach((deduction, idx) => {
      const stockId = `DED-${prodId}-${idx}`;
      batch.set(doc(db, "erp_stock_receipts", stockId), {
        id: stockId,
        date: productionForm.date,
        supplier: 'Kitchen Production',
        invoiceRef: `Batch-${prodId}`,
        itemId: deduction.itemId,
        qty: deduction.qty,
        totalCost: deduction.totalCost,
        unitCost: deduction.unitCost,
        isProductionDeduction: true,
        productionId: prodId,
        isVoid: false
      });
    });

    try {
      await batch.commit();
      setProductionDb(prev => [...prev, prodRecord]);
      const newStockDeductions = rawDeductions.map((d, i) => ({ id: `DED-${prodId}-${i}`, date: productionForm.date, itemId: d.itemId, qty: d.qty, totalCost: d.totalCost, unitCost: d.unitCost, isVoid: false }));
      setStockReceiptsDb(prev => [...prev, ...newStockDeductions]);
      
      alert("✅ Batch Logged! Raw materials deducted and prepared portions added to freezer stock.");
      setProductionForm({ date: getToday(), recipeId: '', portionsMade: '' });
      setActiveTab('dashboard');
    } catch (err) { alert("Error logging production."); }
  };

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#ffffff', minHeight: '100vh', color: '#000' }}>
      
      {/* INLINE ITEM MODAL WITH DUPLICATE CHECK */}
      {showItemModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '420px', borderRadius: '8px', border: `1px solid ${sheetTheme.border}`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}`, background: sheetTheme.headerPurpleBg, color: sheetTheme.headerPurpleText, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New Item / Expense</h2>
              <button onClick={() => { setShowItemModal(false); setPendingLineIndex(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sheetTheme.headerPurpleText }}><XCircle size={18} /></button>
            </div>
            <form onSubmit={handleSaveItem} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Item Name</label>
                <input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${isDuplicateItemName ? '#dc2626' : sheetTheme.border}`, borderRadius: '4px' }} required autoFocus placeholder="e.g. Chicken Breast or Bleach" />
                {isDuplicateItemName && <div style={{ color: '#dc2626', fontSize: '11px', marginTop: '4px', fontWeight: '700' }}>⚠️ An item with this exact name already exists.</div>}
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Item Classification Type</label>
                <select value={newItem.type} onChange={e => setNewItem({...newItem, type: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', fontWeight: '700', color: newItem.type === 'Recipe Stock' ? '#059669' : '#d97706' }}>
                  <option value="Recipe Stock">Recipe Stock (Enters Fridge/Kitchen Stock)</option>
                  <option value="Direct Expense">Direct Expense / Consumable (Bypasses Fridge Stock)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Category</label>
                <select value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }}>
                  <option value="Meat & Poultry">Meat & Poultry</option>
                  <option value="Produce / Veg">Produce / Veg</option>
                  <option value="Dairy">Dairy</option>
                  <option value="Dry Goods / Spices">Dry Goods / Spices</option>
                  <option value="Packaging & Consumables">Packaging & Consumables</option>
                  <option value="Cleaning & Chemicals">Cleaning & Chemicals</option>
                  <option value="Beverages">Beverages</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Unit of Measure (UOM)</label>
                <input type="text" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required placeholder="e.g. kg, L, bottles, boxes" />
              </div>
              <button type="submit" disabled={isDuplicateItemName} style={{ padding: '10px', background: isDuplicateItemName ? '#94a3b8' : sheetTheme.headerPurpleText, color: '#fff', fontWeight: '700', border: 'none', cursor: isDuplicateItemName ? 'not-allowed' : 'pointer', borderRadius: '4px' }}>Save & Select</button>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER MODAL */}
      {showSupplierModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.7)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '400px', borderRadius: '8px', border: `1px solid ${sheetTheme.border}`, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}`, background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '14px', fontWeight: '700' }}>➕ Add New Supplier</h2>
              <button onClick={() => { setShowSupplierModal(false); setNewSupplier(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sheetTheme.headerBlueText }}><XCircle size={18} /></button>
            </div>
            <form onSubmit={handleSaveSupplier} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Supplier / Vendor Name</label>
                <input type="text" value={newSupplier} onChange={e => setNewSupplier(e.target.value)} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required autoFocus placeholder="e.g. Booker Wholesale" />
              </div>
              <button type="submit" style={{ padding: '10px', background: '#0369a1', color: '#fff', fontWeight: '700', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Save to Chart of Accounts</button>
            </form>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'normal', color: '#1f2937' }}>Inventory & Kitchen Production</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>Track raw materials, template recipes, mixed invoices, and kitchen batches.</p>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div style={{ display: 'flex', border: `1px solid ${sheetTheme.border}`, marginBottom: '24px', flexWrap: 'wrap', borderRadius: '6px', overflow: 'hidden' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'dashboard' ? sheetTheme.headerBlueBg : '#fff', color: activeTab === 'dashboard' ? sheetTheme.headerBlueText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><LayoutDashboard size={16} /> LIVE DASHBOARD</button>
          <button onClick={() => setActiveTab('receive')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'receive' ? sheetTheme.headerGreenBg : '#fff', color: activeTab === 'receive' ? sheetTheme.headerGreenText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><ShoppingCart size={16} /> RECEIVE INVOICE</button>
          <button onClick={() => setActiveTab('recipes')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'recipes' ? sheetTheme.headerOrangeBg : '#fff', color: activeTab === 'recipes' ? sheetTheme.headerOrangeText : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><ClipboardList size={16} /> RECIPE MASTER</button>
          <button onClick={() => setActiveTab('production')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'production' ? '#fef3c7' : '#fff', color: activeTab === 'production' ? '#b45309' : '#6b7280', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><ChefHat size={16} /> LOG PRODUCTION</button>
          <button onClick={() => setActiveTab('setup')} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'setup' ? sheetTheme.headerPurpleBg : '#fff', color: activeTab === 'setup' ? sheetTheme.headerPurpleText : '#6b7280', border: 'none', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><PackageOpen size={16} /> ITEM MASTER</button>
        </div>

        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            
            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
                <div style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '16px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Raw Ingredients Inventory (Cold Room / Dry Store)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', background: '#f8fafc' }}>
                    <tr>
                    <th style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}` }}>Item Name</th>
                    <th style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}` }}>Category</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Current Qty</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Avg Cost (Net)</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Total Value</th>
                    </tr>
                </thead>
                <tbody>
                    {currentRawStock.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>No raw stock data available.</td></tr>
                    ) : (
                    currentRawStock.map(item => (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '12px 16px', fontWeight: '700', fontSize: '13px' }}>{item.name}</td>
                        <td style={{ padding: '12px 16px', fontSize: '12px', color: '#4b5563' }}>{item.category}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '800', fontSize: '13px', color: item.totalQty < 0 ? '#dc2626' : '#059669' }}>{fmtQty(item.totalQty)} {item.unit}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px' }}>£ {fmtMoney(item.avgUnitCost)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '700', fontSize: '13px' }}>£ {fmtMoney(item.totalValue)}</td>
                        </tr>
                    ))
                    )}
                </tbody>
                </table>
            </div>

            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
                <div style={{ background: '#ecfdf5', color: '#065f46', padding: '16px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Prepared Food Inventory (Freezer / Fridge Portions)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', background: '#f8fafc' }}>
                    <tr>
                    <th style={{ padding: '12px 16px', borderBottom: `1px solid ${sheetTheme.border}` }}>Recipe / Dish Name</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Available Portions</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Avg Cost / Portion</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Total Value</th>
                    </tr>
                </thead>
                <tbody>
                    {currentPreparedStock.filter(item => item.totalPortions !== 0).length === 0 ? (
                    <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>No prepared food available. Use the Production tab to cook batches.</td></tr>
                    ) : (
                    currentPreparedStock.filter(item => item.totalPortions !== 0).map(item => (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '12px 16px', fontWeight: '800', fontSize: '14px' }}>{item.name}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '900', fontSize: '15px', color: item.totalPortions < 0 ? '#dc2626' : '#2563eb' }}>{fmtQty(item.totalPortions)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: '13px' }}>£ {fmtMoney(item.avgPortionCost)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '700', fontSize: '13px' }}>£ {fmtMoney(item.totalValue)}</td>
                        </tr>
                    ))
                    )}
                </tbody>
                </table>
            </div>

          </div>
        )}

        {/* TAB 2: RECEIVE INVOICE (WITH VOID/RELOAD HISTORY) */}
        {activeTab === 'receive' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <form onSubmit={handleSaveReceipt} style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '16px', background: sheetTheme.headerGreenBg, borderBottom: `1px solid ${sheetTheme.border}` }}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Delivery Date</label>
                    <input type="date" value={receiveForm.date} onChange={e => setReceiveForm({...receiveForm, date: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                  </div>
                  <div style={{ flex: 2, minWidth: '300px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Supplier (Chart of Accounts)</label>
                    <select 
                      value={receiveForm.supplier} 
                      onChange={e => {
                        if (e.target.value === 'ADD_NEW_SUPPLIER') setShowSupplierModal(true);
                        else setReceiveForm({...receiveForm, supplier: e.target.value});
                      }}
                      style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} 
                      required
                    >
                      <option value="">-- Select Supplier --</option>
                      {payableAccounts.map(acc => <option key={acc.id} value={acc.name}>{acc.name}</option>)}
                      <option value="ADD_NEW_SUPPLIER" style={{ fontWeight: '800', color: '#0369a1' }}>➕ Add New Supplier...</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '700', color: sheetTheme.headerGreenText, display: 'block', marginBottom: '4px' }}>Supplier Invoice Ref</label>
                    <input type="text" value={receiveForm.invoiceRef} onChange={e => setReceiveForm({...receiveForm, invoiceRef: e.target.value})} placeholder="Optional" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                  </div>
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#4b5563', textTransform: 'uppercase' }}>
                  <tr>
                    <th style={{ padding: '10px 16px', textAlign: 'left', borderBottom: `1px solid ${sheetTheme.border}` }}>Item / Expense Name</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Qty</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Net Rate (£)</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '20%' }}>Net Total (£)</th>
                    <th style={{ padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${sheetTheme.border}`, width: '5%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {receiveForm.lines.map((line, idx) => {
                    const selectedItem = itemsDb.find(i => i.id === line.itemId);
                    const lineNetTotal = (Number(line.qty) || 0) * (Number(line.rate) || 0);
                    return (
                      <tr key={line.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '8px 16px' }}>
                          <select value={line.itemId} onChange={e => { if (e.target.value === 'ADD_NEW_ITEM') { setPendingLineIndex(idx); setShowItemModal(true); } else { handleReceiveLineChange(idx, 'itemId', e.target.value); } }} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required>
                            <option value="">-- Choose Item / Expense --</option>
                            {itemsDb.map(item => <option key={item.id} value={item.id}>{item.name} ({item.type === 'Direct Expense' ? 'Expense' : 'Stock'})</option>)}
                            <option value="ADD_NEW_ITEM" style={{ fontWeight: '800', color: '#0369a1' }}>➕ Add New Item / Expense...</option>
                          </select>
                        </td>
                        <td style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input type="number" step="any" value={line.qty} onChange={e => handleReceiveLineChange(idx, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '8px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                          <span style={{ fontSize: '12px', color: '#6b7280', width: '30px' }}>{selectedItem ? selectedItem.unit : ''}</span>
                        </td>
                        <td style={{ padding: '8px 16px' }}>
                          <input type="number" step="any" value={line.rate} onChange={e => handleReceiveLineChange(idx, 'rate', e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '8px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                        </td>
                        <td style={{ padding: '8px 16px', textAlign: 'right', fontWeight: '700', fontSize: '13px' }}>{fmtMoney(lineNetTotal)}</td>
                        <td style={{ padding: '8px 16px', textAlign: 'center' }}><button type="button" onClick={() => removeReceiveLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button></td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td colSpan="5" style={{ padding: '12px 16px', background: '#f8fafc' }}>
                      <button type="button" onClick={addReceiveLine} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#fff', color: '#0369a1', border: `1px dashed ${sheetTheme.border}`, borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><PlusCircle size={14} /> Add Another Line</button>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div style={{ padding: '20px 32px', background: '#f1f5f9', borderTop: `2px solid ${sheetTheme.border}`, display: 'flex', justifyContent: 'flex-end' }}>
                <table style={{ width: '300px', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr><td style={{ padding: '8px', fontSize: '13px', fontWeight: '700', color: '#4b5563', textAlign: 'right' }}>Subtotal (Net Cost):</td><td style={{ padding: '8px', fontSize: '14px', fontWeight: '800', textAlign: 'right' }}>£ {fmtMoney(formSubtotal)}</td></tr>
                    <tr>
                      <td style={{ padding: '8px', fontSize: '13px', fontWeight: '700', color: '#dc2626', textAlign: 'right' }}>Total VAT (£):</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}><input type="number" step="any" value={receiveForm.totalVat} onChange={e => setReceiveForm({...receiveForm, totalVat: e.target.value})} placeholder="0.00" style={{ width: '100px', padding: '6px', textAlign: 'right', border: `1px solid #fca5a5`, borderRadius: '4px', color: '#dc2626', fontWeight: '700' }} /></td>
                    </tr>
                    <tr style={{ borderTop: `2px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '12px 8px', fontSize: '14px', fontWeight: '900', color: '#0f172a', textAlign: 'right' }}>Grand Total (Gross):</td>
                      <td style={{ padding: '12px 8px', fontSize: '16px', fontWeight: '900', color: '#166534', textAlign: 'right' }}>£ {fmtMoney(formSubtotal + (Number(receiveForm.totalVat) || 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '16px', background: '#e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600' }}>* Mixed items route stock to fridge and expenses straight to P&L.</div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {receiveForm.masterInvoiceId && <button type="button" onClick={() => setReceiveForm({date: getToday(), supplier: '', invoiceRef: '', totalVat: '', lines: [{id: Date.now(), itemId: '', qty: '', rate: ''}]})} style={{ padding: '10px 16px', background: '#cbd5e1', border: 'none', borderRadius: '4px', fontWeight: '700', cursor: 'pointer' }}>Cancel Edit</button>}
                  <button type="submit" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 32px', background: '#166534', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '800', cursor: 'pointer' }}><Save size={18} /> {receiveForm.masterInvoiceId ? 'Update Invoice (Void & Reload)' : 'Post Unified Invoice'}</button>
                </div>
              </div>
            </form>

            {/* RECENT INVOICES HISTORY (FOR VOID & RELOAD) */}
            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: '#f8fafc', padding: '16px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Recent Posted Invoices (Edit via Void & Reload or Delete)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', background: '#f1f5f9' }}>
                  <tr>
                    <th style={{ padding: '10px 16px' }}>Date</th>
                    <th style={{ padding: '10px 16px' }}>Supplier</th>
                    <th style={{ padding: '10px 16px' }}>Ref</th>
                    <th style={{ padding: '10px 16px', textAlign: 'right' }}>Total (Net) £</th>
                    <th style={{ padding: '10px 16px' }}>Items Included</th>
                    <th style={{ padding: '10px 16px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {masterInvoicesList.length === 0 ? <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>No invoices posted yet.</td></tr> :
                  masterInvoicesList.slice(0, 10).map(inv => (
                    <tr key={inv.masterInvoiceId} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '10px 16px', fontSize: '13px' }}>{inv.date}</td>
                      <td style={{ padding: '10px 16px', fontWeight: '700', fontSize: '13px' }}>{inv.supplier}</td>
                      <td style={{ padding: '10px 16px', fontSize: '13px' }}>{inv.invoiceRef || '-'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: '800', fontSize: '13px', color: '#0369a1' }}>£ {fmtMoney(inv.totalNet)}</td>
                      <td style={{ padding: '10px 16px', fontSize: '12px', color: '#4b5563' }}>
                        {inv.lines.map(l => {
                          const itm = itemsDb.find(i => i.id === l.itemId);
                          return itm ? `${l.qty} ${itm.unit} ${itm.name}` : '';
                        }).filter(Boolean).join(' • ')}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button onClick={() => handleEditInvoice(inv)} title="Edit (Void & Reload)" style={{ background: 'none', border: 'none', color: '#0369a1', cursor: 'pointer' }}><Edit3 size={16} /></button>
                        <button onClick={() => handleDeleteInvoice(inv.masterInvoiceId)} title="Void / Delete" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* TAB 3: RECIPE MASTER */}
        {activeTab === 'recipes' && (
          <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: sheetTheme.headerOrangeBg, color: sheetTheme.headerOrangeText, padding: '16px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Recipe Master (Batch Templates)</div>
              
              <div style={{ padding: '24px', display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <form onSubmit={handleSaveRecipe} style={{ flex: '1 1 400px', background: '#fff', border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ padding: '16px', borderBottom: `1px solid ${sheetTheme.border}`, background: '#f8fafc' }}>
                        <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Batch / Recipe Name</label>
                        <input type="text" value={recipeForm.name} onChange={e => setRecipeForm({...recipeForm, name: e.target.value})} placeholder="e.g. Standard Biryani Pot" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#4b5563', textTransform: 'uppercase' }}>
                            <tr>
                            <th style={{ padding: '8px 16px', textAlign: 'left', borderBottom: `1px solid ${sheetTheme.border}` }}>Raw Item</th>
                            <th style={{ padding: '8px 16px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}`, width: '35%' }}>Qty per Batch</th>
                            <th style={{ padding: '8px 16px', textAlign: 'center', borderBottom: `1px solid ${sheetTheme.border}`, width: '10%' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {recipeForm.lines.map((line, idx) => {
                            const selectedItem = itemsDb.find(i => i.id === line.itemId);
                            return (
                                <tr key={line.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                                <td style={{ padding: '6px 16px' }}>
                                    <select value={line.itemId} onChange={e => { if (e.target.value === 'ADD_NEW_ITEM') { setPendingLineIndex(idx); setShowItemModal(true); } else { handleRecipeLineChange(idx, 'itemId', e.target.value); } }} style={{ width: '100%', padding: '6px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required>
                                    <option value="">-- Choose --</option>
                                    {itemsDb.filter(i => i.type === 'Recipe Stock').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                    <option value="ADD_NEW_ITEM" style={{ fontWeight: '800', color: '#0369a1' }}>➕ Add New Item...</option>
                                    </select>
                                </td>
                                <td style={{ padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input type="number" step="any" value={line.qty} onChange={e => handleRecipeLineChange(idx, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '6px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                                    <span style={{ fontSize: '11px', color: '#6b7280', width: '25px' }}>{selectedItem ? selectedItem.unit : ''}</span>
                                </td>
                                <td style={{ padding: '6px 16px', textAlign: 'center' }}><button type="button" onClick={() => removeRecipeLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={14} /></button></td>
                                </tr>
                            )
                            })}
                            <tr>
                            <td colSpan="3" style={{ padding: '12px 16px', background: '#f8fafc' }}>
                                <button type="button" onClick={addRecipeLine} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#fff', color: '#c2410c', border: `1px dashed #fed7aa`, borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><PlusCircle size={14} /> Add Item</button>
                            </td>
                            </tr>
                        </tbody>
                    </table>
                    <div style={{ padding: '16px', background: '#fff7ed', display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${sheetTheme.border}` }}>
                        <button type="submit" style={{ padding: '10px 24px', background: '#ea580c', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '800', cursor: 'pointer' }}>Save Template</button>
                    </div>
                </form>

                <div style={{ flex: '1 1 400px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '800', color: '#1f2937', marginBottom: '12px' }}>Saved Templates</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {recipesDb.length === 0 ? <div style={{ fontSize: '13px', color: '#6b7280' }}>No templates saved yet.</div> : recipesDb.map(recipe => (
                            <div key={recipe.id} style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', padding: '12px', background: '#f8fafc' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{ fontWeight: '800', fontSize: '14px', color: '#1f2937' }}>{recipe.name}</span>
                                    <button onClick={() => handleDeleteRecipe(recipe.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={14} /></button>
                                </div>
                                <div style={{ fontSize: '12px', color: '#4b5563' }}>
                                    {recipe.ingredients.map(ing => {
                                        const raw = itemsDb.find(i => i.id === ing.itemId);
                                        return raw ? `${ing.qty} ${raw.unit} ${raw.name}` : 'Unknown';
                                    }).join(' • ')}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
              </div>
          </div>
        )}

        {/* TAB 4: KITCHEN PRODUCTION */}
        {activeTab === 'production' && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <form onSubmit={handleSaveProduction} style={{ flex: '1 1 400px', border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ background: '#fef3c7', color: '#b45309', padding: '16px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Log Kitchen Production</div>
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#fff' }}>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Production Date</label>
                        <input type="date" value={productionForm.date} onChange={e => setProductionForm({...productionForm, date: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px', display: 'block' }}>Dish Prepared (Recipe Batch)</label>
                        <select value={productionForm.recipeId} onChange={e => setProductionForm({...productionForm, recipeId: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required>
                            <option value="">-- Select Template --</option>
                            {recipesDb.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', fontWeight: '800', color: '#b45309', marginBottom: '4px', display: 'block' }}>Actual Portions Made</label>
                        <input type="number" step="any" value={productionForm.portionsMade} onChange={e => setProductionForm({...productionForm, portionsMade: e.target.value})} placeholder="e.g. 50" style={{ width: '100%', padding: '10px', border: `1px solid #fde68a`, borderRadius: '4px', background: '#fffbeb', fontWeight: '800' }} required />
                    </div>
                </div>
                <div style={{ padding: '16px', background: '#fef3c7', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${sheetTheme.border}` }}>
                    <div style={{ fontSize: '11px', color: '#92400e', width: '200px' }}>* Auto-deducts raw materials using average cost and adds portions to freezer stock.</div>
                    <button type="submit" style={{ padding: '10px 24px', background: '#d97706', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><ChefHat size={18} /> Cook Batch</button>
                </div>
            </form>
            
            <div style={{ flex: '1 1 400px', border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ background: '#f8fafc', padding: '16px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Recent Production Logs</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: '#fff' }}>
                    <thead style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <tr>
                            <th style={{ padding: '10px 16px' }}>Date</th>
                            <th style={{ padding: '10px 16px' }}>Batch</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>Yield</th>
                            <th style={{ padding: '10px 16px', textAlign: 'right' }}>Cost/Portion</th>
                        </tr>
                    </thead>
                    <tbody>
                        {productionDb.length === 0 ? <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>No production logged yet.</td></tr> : 
                        [...productionDb].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10).map(log => {
                            const recipe = recipesDb.find(r => r.id === log.recipeId);
                            const cp = (Number(log.totalBatchCost) || 0) / (Number(log.portionsMade) || 1);
                            return (
                                <tr key={log.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                                    <td style={{ padding: '10px 16px', fontSize: '12px' }}>{log.date}</td>
                                    <td style={{ padding: '10px 16px', fontWeight: '700', fontSize: '13px' }}>{recipe ? recipe.name : 'Unknown'}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: '800', color: '#059669', fontSize: '13px' }}>{log.portionsMade}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: '13px' }}>£ {fmtMoney(cp)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
          </div>
        )}

        {/* TAB 5: SETUP (ITEM MASTER) WITH REAL-TIME DUPLICATE CHECK */}
        {activeTab === 'setup' && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 350px', border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: sheetTheme.headerPurpleBg, color: sheetTheme.headerPurpleText, padding: '12px 16px', fontWeight: '700', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                {editItemId ? '✏️ Edit Item / Expense' : '➕ Add New Item / Expense'}
              </div>
              <form onSubmit={handleSaveItem} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Item Name</label>
                  <input type="text" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} placeholder="e.g. Chicken Breast or Bleach" style={{ width: '100%', padding: '8px', border: `1px solid ${isDuplicateItemName ? '#dc2626' : sheetTheme.border}`, borderRadius: '4px' }} required />
                  {isDuplicateItemName && <div style={{ color: '#dc2626', fontSize: '11px', marginTop: '4px', fontWeight: '700' }}>⚠️ An item with this exact name already exists.</div>}
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Classification Type</label>
                  <select value={newItem.type} onChange={e => setNewItem({...newItem, type: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px', fontWeight: '700', color: newItem.type === 'Recipe Stock' ? '#059669' : '#d97706' }}>
                    <option value="Recipe Stock">Recipe Stock</option>
                    <option value="Direct Expense">Direct Expense / Consumable</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Category</label>
                  <select value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})} style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }}>
                    <option value="Meat & Poultry">Meat & Poultry</option>
                    <option value="Produce / Veg">Produce / Veg</option>
                    <option value="Dairy">Dairy</option>
                    <option value="Dry Goods / Spices">Dry Goods / Spices</option>
                    <option value="Packaging & Consumables">Packaging & Consumables</option>
                    <option value="Cleaning & Chemicals">Cleaning & Chemicals</option>
                    <option value="Beverages">Beverages</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', display: 'block', marginBottom: '4px' }}>Unit of Measure (UOM)</label>
                  <input type="text" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} placeholder="kg, L, boxes, pcs" style={{ width: '100%', padding: '8px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} required />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  {editItemId && (
                    <button type="button" onClick={handleCancelEditItem} style={{ flex: 1, padding: '10px', background: '#cbd5e1', color: '#1e293b', border: 'none', borderRadius: '4px', fontWeight: '700', cursor: 'pointer' }}>Cancel</button>
                  )}
                  <button type="submit" disabled={isDuplicateItemName} style={{ flex: 2, padding: '10px', background: isDuplicateItemName ? '#94a3b8' : sheetTheme.headerPurpleText, color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '700', cursor: isDuplicateItemName ? 'not-allowed' : 'pointer' }}>
                    {editItemId ? 'Update Item' : 'Save to Master List'}
                  </button>
                </div>
              </form>
            </div>

            <div style={{ flex: '2 1 500px', border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', padding: '12px 16px', fontWeight: '700', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}` }}>Master Item & Expense List</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#4b5563', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '8px 16px' }}>Name</th>
                    <th style={{ padding: '8px 16px' }}>Type</th>
                    <th style={{ padding: '8px 16px' }}>Category</th>
                    <th style={{ padding: '8px 16px' }}>UOM</th>
                    <th style={{ padding: '8px 16px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsDb.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '8px 16px', fontWeight: '600', fontSize: '13px' }}>{item.name}</td>
                      <td style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700', color: item.type === 'Direct Expense' ? '#d97706' : '#059669' }}>{item.type || 'Recipe Stock'}</td>
                      <td style={{ padding: '8px 16px', fontSize: '12px', color: '#6b7280' }}>{item.category}</td>
                      <td style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700' }}>{item.unit}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button onClick={() => handleEditItemClick(item)} title="Edit Item" style={{ background: 'none', border: 'none', color: '#0369a1', cursor: 'pointer' }}><Edit size={14} /></button>
                        <button onClick={() => handleDeleteItem(item.id)} title="Delete Item" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={14} /></button>
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