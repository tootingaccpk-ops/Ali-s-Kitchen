import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";
import { LayoutDashboard, Save, ChefHat, Trash2, FileSpreadsheet, FileText, BarChart3, Settings, PlusCircle, PackageOpen, Edit } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getFirstDayOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const fmtMoney = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtPct = (n) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

const sheetTheme = {
  border: '#d1d5db', font: '"Inter", "Arial", sans-serif',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1',
  headerOrangeBg: '#fff7ed', headerOrangeText: '#c2410c',
  headerPurpleBg: '#f3e8ff', headerPurpleText: '#7e22ce',
  headerGreenBg: '#dcfce7', headerGreenText: '#166534'
};

export default function InventoryManagement() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [recipesDb, setRecipesDb] = useState([]);
  const [productionDb, setProductionDb] = useState([]);
  const [salesDb, setSalesDb] = useState([]);
  
  const [editingId, setEditingId] = useState(null);
  const [setupForm, setSetupForm] = useState({
    name: '', portionName: '', finishedUom: 'Portions', defaultYield: '', spicesCost: '',
    lines: [{ id: Date.now(), ingredient: '', uom: '', qty: '', rate: '' }]
  });
  
  const [stockAsOfDate, setStockAsOfDate] = useState(getToday());
  const [reportDates, setReportDates] = useState({ startDate: getFirstDayOfMonth(), endDate: getToday() });
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [prodLog, setProdLog] = useState({ date: getToday(), recipe: null, actualYield: '' });
  
  const [localOpeningStock, setLocalOpeningStock] = useState({});
  const [isSavingStock, setIsSavingStock] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({ name: '', uom: 'Cans', cost: '', qty: '' });

  useEffect(() => {
    const loadData = async () => {
      try {
        const [recipeSnap, prodSnap, salesSnap] = await Promise.all([
          getDocs(collection(db, "erp_recipes")),
          getDocs(collection(db, "erp_production_logs")),
          getDocs(collection(db, "erp_sales_db"))
        ]);
        const fetchedRecipes = recipeSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name));
        setRecipesDb(fetchedRecipes);
        setProductionDb(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setSalesDb(salesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        const osMap = {};
        fetchedRecipes.forEach(r => { osMap[r.id] = r.openingQty || 0; });
        setLocalOpeningStock(osMap);
      } catch (err) { console.error("Failed to load inventory data", err); }
    };
    loadData();
  }, []);

  const finishedGoodsStock = useMemo(() => {
    const stockMap = {};
    recipesDb.forEach(rec => {
      stockMap[rec.id] = { ...rec, totalProduced: 0, totalSold: 0, openingQty: Number(rec.openingQty) || 0 };
    });
    productionDb.filter(p => p.date <= stockAsOfDate).forEach(prod => {
      if (stockMap[prod.recipeId]) stockMap[prod.recipeId].totalProduced += Number(prod.portionsMade) || 0;
    });
    salesDb.filter(s => s.date <= stockAsOfDate).forEach(sale => {
      if (sale.pmix) sale.pmix.forEach(p => { if (stockMap[p.recipeId]) stockMap[p.recipeId].totalSold += Number(p.qtySold) || 0; });
    });
    return Object.values(stockMap).map(item => {
      const currentQty = item.openingQty + item.totalProduced - item.totalSold;
      return { ...item, currentQty, totalValue: currentQty * item.costPerPortion, displayName: item.portionName || item.name };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [recipesDb, productionDb, salesDb, stockAsOfDate]);

  const dailyReportsData = useMemo(() => {
    const dailyMap = {};
    salesDb.forEach(sale => {
      const sDate = sale.date;
      if (sDate >= reportDates.startDate && sDate <= reportDates.endDate) {
        if (!dailyMap[sDate]) dailyMap[sDate] = { date: sDate, revenue: 0, cogs: 0 };
        dailyMap[sDate].revenue += Number(sale.totalNet || sale.totalGross || sale.netRevenue || 0);
        if (sale.pmix) sale.pmix.forEach(p => {
          const stockItem = recipesDb.find(r => r.id === p.recipeId);
          if (stockItem) dailyMap[sDate].cogs += (Number(p.qtySold) * stockItem.costPerPortion);
        });
      }
    });
    return Object.values(dailyMap).map(day => {
      const grossProfit = day.revenue - day.cogs;
      const foodCostPct = day.revenue > 0 ? (day.cogs / day.revenue) * 100 : 0;
      return { ...day, grossProfit, foodCostPct };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [salesDb, recipesDb, reportDates]);

  const handleRecipeLineChange = (index, field, value) => {
    setSetupForm(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addRecipeLine = () => setSetupForm(prev => ({ ...prev, lines: [...prev.lines, { id: Date.now(), ingredient: '', uom: '', qty: '', rate: '' }] }));
  
  const removeRecipeLine = (index) => {
    setSetupForm(prev => {
      const newLines = [...prev.lines];
      newLines.splice(index, 1);
      if (newLines.length === 0) newLines.push({ id: Date.now(), ingredient: '', uom: '', qty: '', rate: '' });
      return { ...prev, lines: newLines };
    });
  };

  const setupFormSubtotal = useMemo(() => {
    return setupForm.lines.reduce((sum, line) => sum + ((Number(line.qty) || 0) * (Number(line.rate) || 0)), 0) + (Number(setupForm.spicesCost) || 0);
  }, [setupForm.lines, setupForm.spicesCost]);

  const handleEditTemplate = (recipe) => {
    setEditingId(recipe.id);
    setSetupForm({
      name: recipe.name || '', portionName: recipe.portionName || recipe.name || '', finishedUom: recipe.finishedUom || 'Portions', defaultYield: recipe.defaultYield || '', spicesCost: recipe.spicesCost || '',
      lines: recipe.ingredients?.length ? recipe.ingredients.map((ing, i) => ({ id: Date.now() + i, uom: ing.uom || '', ...ing })) : [{ id: Date.now(), ingredient: '', uom: '', qty: '', rate: '' }]
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setSetupForm({ name: '', portionName: '', finishedUom: 'Portions', defaultYield: '', spicesCost: '', lines: [{ id: Date.now(), ingredient: '', uom: '', qty: '', rate: '' }] });
  };

  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!setupForm.name.trim() || !setupForm.defaultYield) return alert("Recipe name and yield are required.");
    const yieldNum = Number(setupForm.defaultYield);
    if (yieldNum <= 0) return alert("Yield must be greater than zero.");
    const batchCost = setupFormSubtotal;
    const templateData = { 
      name: setupForm.name.trim(), portionName: setupForm.portionName.trim() || setupForm.name.trim(), finishedUom: setupForm.finishedUom.trim() || 'Portions',
      batchCost: batchCost, defaultYield: yieldNum, costPerPortion: batchCost / yieldNum, spicesCost: Number(setupForm.spicesCost) || 0, ingredients: setupForm.lines.filter(l => l.ingredient.trim() !== '')
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, "erp_recipes", editingId), templateData);
        setRecipesDb(prev => prev.map(r => r.id === editingId ? { ...r, ...templateData } : r).sort((a,b) => a.name.localeCompare(b.name)));
        alert("✅ Recipe Updated Successfully!");
      } else {
        templateData.openingQty = 0;
        const docRef = await addDoc(collection(db, "erp_recipes"), templateData);
        setRecipesDb(prev => [...prev, { id: docRef.id, ...templateData }].sort((a,b) => a.name.localeCompare(b.name)));
        setLocalOpeningStock(prev => ({ ...prev, [docRef.id]: 0 }));
        alert("✅ Recipe Template Saved Successfully!");
      }
      handleCancelEdit();
    } catch (err) { alert("Error saving template."); }
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm("Delete this recipe template?")) return;
    try {
      await deleteDoc(doc(db, "erp_recipes", id));
      setRecipesDb(prev => prev.filter(r => r.id !== id));
    } catch (err) { alert("Error deleting template."); }
  };

  const handleSaveOpeningStock = async () => {
    setIsSavingStock(true);
    try {
      for (const recipe of recipesDb) {
        const newQty = Number(localOpeningStock[recipe.id]) || 0;
        if (newQty !== recipe.openingQty) await updateDoc(doc(db, "erp_recipes", recipe.id), { openingQty: newQty });
      }
      setRecipesDb(prev => prev.map(r => ({ ...r, openingQty: Number(localOpeningStock[r.id]) || 0 })));
      alert("✅ Opening Stock Updated Successfully!");
    } catch (error) { alert("Error saving opening stock"); } finally { setIsSavingStock(false); }
  };

  const handleQuickAdd = async () => {
    if (!quickAddForm.name.trim() || quickAddForm.cost === '') return alert("Please enter an Item Name and Cost.");
    const cost = Number(quickAddForm.cost);
    const qty = Number(quickAddForm.qty) || 0;
    const newItem = {
      name: quickAddForm.name.trim(), portionName: quickAddForm.name.trim(), finishedUom: quickAddForm.uom.trim() || 'Units',
      batchCost: cost, defaultYield: 1, costPerPortion: cost, spicesCost: cost, ingredients: [], openingQty: qty
    };
    try {
      const docRef = await addDoc(collection(db, "erp_recipes"), newItem);
      setRecipesDb(prev => [...prev, { id: docRef.id, ...newItem }].sort((a,b) => a.name.localeCompare(b.name)));
      setLocalOpeningStock(prev => ({ ...prev, [docRef.id]: qty }));
      setQuickAddForm({ name: '', uom: 'Cans', cost: '', qty: '' });
      alert("✅ New item instantly saved to stock!");
    } catch (err) { alert("Error adding item."); }
  };

  const openProductionModal = (recipe) => {
    setProdLog({ date: getToday(), recipe: recipe, actualYield: recipe.defaultYield });
    setShowProductionModal(true);
  };

  const handleLogProduction = async (e) => {
    e.preventDefault();
    if (!prodLog.recipe || !prodLog.actualYield) return;
    const prodRecord = { 
      id: "PROD-" + Date.now(), date: prodLog.date, recipeId: prodLog.recipe.id, portionsMade: Number(prodLog.actualYield), totalBatchCost: Number(prodLog.recipe.batchCost) 
    };
    try {
      await addDoc(collection(db, "erp_production_logs"), prodRecord);
      setProductionDb(prev => [...prev, prodRecord]);
      setShowProductionModal(false);
      alert("✅ Batch Logged!");
      setActiveTab('dashboard');
    } catch (err) { alert("Error logging production."); }
  };

  const handleExportExcel = () => {
    let wsData = [];
    if (activeTab === 'dashboard') {
      wsData.push(["Inventory Valuation Report", `As of: ${stockAsOfDate}`], []);
      wsData.push(["S.No", "Finished Item", "UOM", "Opening Qty", "Current Qty", "Static Cost/Unit (£)", "Total Asset Value (£)"]);
      finishedGoodsStock.forEach((i, idx) => wsData.push([idx + 1, i.displayName, i.finishedUom || 'Portions', i.openingQty, i.currentQty, i.costPerPortion, Math.max(0, i.totalValue)]));
    } else if (activeTab === 'reports') {
      wsData.push(["COGS Analytics Report", `From: ${reportDates.startDate} To: ${reportDates.endDate}`], []);
      wsData.push(["S.No", "Date", "Selling Price (£)", "Food Cost (£)", "Difference (£)", "Ratio of Difference (%)"]);
      dailyReportsData.forEach((d, idx) => wsData.push([idx + 1, d.date, d.revenue, d.cogs, d.grossProfit, d.foodCostPct]));
    } else if (activeTab === 'production') {
      wsData.push(["Production Logs", `Generated: ${getToday()}`], []);
      wsData.push(["S.No", "Date", "Batch Cooked", "Yield Packed", "Total Batch Cost (£)"]);
      productionDb.forEach((p, idx) => {
        const rec = recipesDb.find(r => r.id === p.recipeId);
        wsData.push([idx + 1, p.date, rec?.name || 'Unknown', p.portionsMade, p.totalBatchCost]);
      });
    } else if (activeTab === 'setup') {
      wsData.push(["Detailed Recipe Cost Breakdown", `Generated: ${getToday()}`], []);
      wsData.push(["Recipe Name", "Component", "UOM", "Qty", "Rate (£)", "Line Total (£)"]);
      recipesDb.forEach((r) => {
        wsData.push([r.name, "--- INGREDIENTS ---", "", "", "", ""]);
        if(r.ingredients) {
          r.ingredients.forEach(ing => {
            wsData.push(["", ing.ingredient, ing.uom || '-', ing.qty, ing.rate, (Number(ing.qty)*Number(ing.rate)).toFixed(2)]);
          });
        }
        wsData.push(["", "Spices / Oil (Flat)", "", "", "", Number(r.spicesCost || 0).toFixed(2)]);
        wsData.push(["", "TOTAL BATCH COST", "", "", "", Number(r.batchCost).toFixed(2)]);
        wsData.push(["", `COST PER UNIT (${r.finishedUom || 'Portions'})`, "", "", "", Number(r.costPerPortion).toFixed(2)]);
        wsData.push(["", "", "", "", "", ""]);
      });
    } else if (activeTab === 'opening') {
      wsData.push(["Opening Stock Balances", `Generated: ${getToday()}`], []);
      wsData.push(["S.No", "Finished Item", "UOM", "Opening Qty"]);
      recipesDb.forEach((r, idx) => wsData.push([idx + 1, r.portionName || r.name, r.finishedUom || 'Portions', r.openingQty]));
    }
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Data");
    XLSX.writeFile(wb, `Inventory_Report_${getToday()}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF('p', 'pt', 'a4');
    doc.setFont("helvetica", "bold");
    let title = "", headers = [], data = [], colStyles = {};
    if (activeTab === 'dashboard') {
      title = `Finished Goods Inventory (As of ${stockAsOfDate})`;
      headers = [['S.No', 'Finished Item', 'UOM', 'Opening Qty', 'Current Qty', 'Cost/Unit', 'Asset Value']];
      data = finishedGoodsStock.map((i, idx) => [idx + 1, i.displayName, i.finishedUom || 'Portions', i.openingQty, i.currentQty, `£${fmtMoney(i.costPerPortion)}`, `£${fmtMoney(Math.max(0, i.totalValue))}`]);
      colStyles = { 0: {halign: 'center', cellWidth: 40}, 1: {halign: 'left'}, 2: {halign: 'center', cellWidth: 60}, 3: {halign: 'right', cellWidth: 70}, 4: {halign: 'right', cellWidth: 70}, 5: {halign: 'right', cellWidth: 70}, 6: {halign: 'right', cellWidth: 80} };
    } else if (activeTab === 'reports') {
      title = `COGS Analytics (${reportDates.startDate} to ${reportDates.endDate})`;
      headers = [['S.No', 'Date', 'Selling Price (£)', 'Food Cost (£)', 'Difference (£)', 'Ratio (%)']];
      data = dailyReportsData.map((d, idx) => [idx + 1, d.date, `£${fmtMoney(d.revenue)}`, `£${fmtMoney(d.cogs)}`, `£${fmtMoney(d.grossProfit)}`, `${fmtPct(d.foodCostPct)}`]);
      colStyles = { 0: {halign: 'center', cellWidth: 40}, 1: {halign: 'left'}, 2: {halign: 'right'}, 3: {halign: 'right'}, 4: {halign: 'right'}, 5: {halign: 'right'} };
    } else if (activeTab === 'production') {
      title = `Production Logs History`;
      headers = [['S.No', 'Date', 'Batch Cooked', 'Yield Packed', 'Total Batch Cost']];
      data = productionDb.map((p, idx) => {
        const rec = recipesDb.find(r => r.id === p.recipeId);
        return [idx + 1, p.date, rec?.name || 'Unknown', p.portionsMade, `£${fmtMoney(p.totalBatchCost)}`];
      });
      colStyles = { 0: {halign: 'center', cellWidth: 40}, 1: {halign: 'left'}, 2: {halign: 'left'}, 3: {halign: 'right'}, 4: {halign: 'right'} };
    } else if (activeTab === 'setup') {
      title = `Detailed Recipe Cost Breakdown`;
      headers = [['Recipe Name', 'Component', 'UOM', 'Qty', 'Rate', 'Line Total']];
      recipesDb.forEach((r) => {
        data.push([r.name, '--- INGREDIENTS ---', '', '', '', '']);
        if (r.ingredients) {
          r.ingredients.forEach(ing => {
            data.push(['', ing.ingredient, ing.uom || '-', ing.qty, `£${fmtMoney(ing.rate)}`, `£${fmtMoney(Number(ing.qty)*Number(ing.rate))}`]);
          });
        }
        data.push(['', 'Spices / Oil (Flat)', '', '', '', `£${fmtMoney(r.spicesCost || 0)}`]);
        data.push(['', 'TOTAL BATCH COST', '', '', '', `£${fmtMoney(r.batchCost)}`]);
        data.push(['', `COST PER UNIT (${r.finishedUom || 'Portions'})`, '', '', '', `£${fmtMoney(r.costPerPortion)}`]);
        data.push(['', '', '', '', '', '']); // Spacer
      });
      colStyles = { 0: {halign: 'left', fontStyle: 'bold', cellWidth: 120}, 1: {halign: 'left'}, 2: {halign: 'center', cellWidth: 50}, 3: {halign: 'right'}, 4: {halign: 'right'}, 5: {halign: 'right'} };
    } else if (activeTab === 'opening') {
      title = `Opening Stock Balances`;
      headers = [['S.No', 'Finished Item', 'UOM', 'Opening Qty']];
      data = recipesDb.map((r, idx) => [idx + 1, r.portionName || r.name, r.finishedUom || 'Portions', r.openingQty]);
      colStyles = { 0: {halign: 'center', cellWidth: 50}, 1: {halign: 'left'}, 2: {halign: 'center', cellWidth: 80}, 3: {halign: 'right', cellWidth: 100} };
    }
    doc.setFontSize(16);
    doc.text(title, 40, 40);
    autoTable(doc, { startY: 60, head: headers, body: data, headStyles: { fillColor: [3, 105, 161] }, columnStyles: colStyles });
    doc.save(`Inventory_Report_${getToday()}.pdf`);
  };

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#f8fafc', minHeight: '100vh', color: '#0f172a' }}>
      
      {showProductionModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.8)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '400px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '16px 20px', background: sheetTheme.headerOrangeBg, color: sheetTheme.headerOrangeText, fontWeight: '800', fontSize: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Log Kitchen Production</span>
              <button onClick={() => setShowProductionModal(false)} style={{ background: 'none', border: 'none', color: '#c2410c', cursor: 'pointer', fontSize: '20px' }}>&times;</button>
            </div>
            <form onSubmit={handleLogProduction} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Cooking Batch:</div>
                <div style={{ fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>{prodLog.recipe?.name}</div>
                <div style={{ fontSize: '13px', color: '#059669', fontWeight: '700', marginTop: '4px' }}>Static Batch Cost: £{fmtMoney(prodLog.recipe?.batchCost)}</div>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '6px' }}>Production Date</label>
                <input type="date" value={prodLog.date} onChange={e => setProdLog({...prodLog, date: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} required />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '800', color: '#c2410c', display: 'block', marginBottom: '6px' }}>Actual Yield ({prodLog.recipe?.finishedUom || 'Portions'})</label>
                <input type="number" step="any" value={prodLog.actualYield} onChange={e => setProdLog({...prodLog, actualYield: e.target.value})} style={{ width: '100%', padding: '14px', border: `2px solid #fdba74`, borderRadius: '6px', background: '#fffbeb', fontWeight: '900', fontSize: '18px', textAlign: 'center' }} required />
              </div>
              <button type="submit" style={{ padding: '14px', background: '#ea580c', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '900', fontSize: '16px', cursor: 'pointer' }}>Confirm & Log Batch</button>
            </form>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '16px', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.5px' }}>Finished Goods Inventory</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b', fontWeight: '500' }}>Recipe costing, 1-click batch logging, and automated COGS.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Export to Excel</button>
            <button onClick={handleExportPDF} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> Export to PDF</button>
          </div>
        </div>

        <div style={{ display: 'flex', background: '#fff', border: `1px solid ${sheetTheme.border}`, marginBottom: '32px', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'dashboard' ? sheetTheme.headerBlueBg : 'transparent', color: activeTab === 'dashboard' ? sheetTheme.headerBlueText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><LayoutDashboard size={18} /> Live Stock</button>
          <button onClick={() => setActiveTab('production')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'production' ? sheetTheme.headerOrangeBg : 'transparent', color: activeTab === 'production' ? sheetTheme.headerOrangeText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><ChefHat size={18} /> Cook Batches</button>
          <button onClick={() => setActiveTab('reports')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'reports' ? sheetTheme.headerPurpleBg : 'transparent', color: activeTab === 'reports' ? sheetTheme.headerPurpleText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><BarChart3 size={18} /> COGS Analytics</button>
          <button onClick={() => setActiveTab('setup')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'setup' ? '#f1f5f9' : 'transparent', color: activeTab === 'setup' ? '#0f172a' : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><Settings size={18} /> Recipe Setup</button>
          <button onClick={() => setActiveTab('opening')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'opening' ? sheetTheme.headerGreenBg : 'transparent', color: activeTab === 'opening' ? sheetTheme.headerGreenText : '#64748b', border: 'none', fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><PackageOpen size={18} /> Opening Stock</button>
        </div>

        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', gap: '16px', background: '#fff', padding: '16px 24px', borderRadius: '12px', border: `1px solid ${sheetTheme.border}`, alignItems: 'center' }}>
              <label style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>View Stock As Of Date:</label>
              <input type="date" value={stockAsOfDate} onChange={e => setStockAsOfDate(e.target.value)} style={{ padding: '8px 12px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', fontWeight: '700', outline: 'none' }} />
            </div>
            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Finished Goods Stock (Fridge & Freezer)</span>
                <span style={{ fontSize: '13px', fontWeight: '700', background: '#fff', padding: '4px 12px', borderRadius: '20px', color: '#0284c7' }}>Total Valuation: £ {fmtMoney(finishedGoodsStock.reduce((sum, item) => sum + Math.max(0, item.totalValue), 0))}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `2px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '14px 16px', textAlign: 'center', width: '50px' }}>S.No</th>
                    <th style={{ padding: '14px 16px', textAlign: 'left' }}>Finished Item</th>
                    <th style={{ padding: '14px 16px', textAlign: 'center', width: '80px' }}>UOM</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right', width: '100px' }}>Opening Qty</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right', width: '100px' }}>Current Qty</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right', width: '110px' }}>Cost / Unit</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right', width: '120px' }}>Asset Value</th>
                  </tr>
                </thead>
                <tbody>
                  {finishedGoodsStock.length === 0 ? (
                    <tr><td colSpan="7" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>No items in stock.</td></tr>
                  ) : (
                    finishedGoodsStock.map((item, idx) => (
                      <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ padding: '16px', textAlign: 'left', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.displayName}</td>
                        <td style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{item.finishedUom || 'Portions'}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '700', fontSize: '14px', color: '#64748b' }}>{fmtQty(item.openingQty)}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '900', fontSize: '16px', color: item.currentQty < 0 ? '#dc2626' : (item.currentQty === 0 ? '#94a3b8' : '#059669') }}>{fmtQty(item.currentQty)}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontSize: '14px', fontWeight: '600', color: '#475569' }}>£ {fmtMoney(item.costPerPortion)}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>£ {fmtMoney(Math.max(0, item.totalValue))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'production' && (
          <div style={{ background: '#fff', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', padding: '24px' }}>
            <div style={{ marginBottom: '20px', borderBottom: `1px solid ${sheetTheme.border}`, paddingBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '8px' }}><ChefHat size={20} /> 1-Click Production Logger</h2>
              <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#64748b' }}>Tap a batch below when it finishes cooking to automatically add portions to stock.</p>
            </div>
            {recipesDb.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px', border: `1px dashed ${sheetTheme.border}` }}>No Recipe Templates setup.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                {recipesDb.map(recipe => (
                  <button key={recipe.id} onClick={() => openProductionModal(recipe)} style={{ background: '#fff', border: `2px solid ${sheetTheme.border}`, borderRadius: '8px', padding: '20px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>{recipe.name}</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px' }}>Cost: £{fmtMoney(recipe.batchCost)}</span>
                      <span style={{ fontSize: '12px', fontWeight: '800', color: '#ea580c', background: '#fff7ed', padding: '4px 8px', borderRadius: '4px' }}>Yield: {recipe.defaultYield} {recipe.finishedUom || 'Portions'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', gap: '16px', background: '#fff', padding: '20px', borderRadius: '12px', border: `1px solid ${sheetTheme.border}` }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Report Start Date</label>
                <input type="date" value={reportDates.startDate} onChange={e => setReportDates({...reportDates, startDate: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Report End Date</label>
                <input type="date" value={reportDates.endDate} onChange={e => setReportDates({...reportDates, endDate: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} />
              </div>
            </div>

            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: sheetTheme.headerPurpleBg, color: sheetTheme.headerPurpleText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                Daily Revenue vs. Cost of Goods Sold (COGS)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `2px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '14px 16px', textAlign: 'center', width: '50px' }}>S.No</th>
                    <th style={{ padding: '14px 16px', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Selling Price (£)</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Food Cost (£)</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Difference (£)</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Ratio (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyReportsData.length === 0 ? (
                    <tr><td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>No sales data logged in this range.</td></tr>
                  ) : (
                    dailyReportsData.map((day, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ padding: '16px', textAlign: 'left', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{day.date}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#059669' }}>£ {fmtMoney(day.revenue)}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '700', fontSize: '14px', color: '#dc2626' }}>£ {fmtMoney(day.cogs)}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '900', fontSize: '15px', color: '#0369a1' }}>£ {fmtMoney(day.grossProfit)}</td>
                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: '900', fontSize: '15px', color: day.foodCostPct > 35 ? '#dc2626' : '#059669' }}>{fmtPct(day.foodCostPct)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'setup' && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 450px', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: editingId ? '#fef3c7' : '#f1f5f9', color: '#0f172a', padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                {editingId ? '✏️ Edit Recipe Details' : '➕ Build Recipe Cost Calculator'}
              </div>
              <form onSubmit={handleSaveTemplate} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Kitchen Batch Name</label>
                    <input type="text" value={setupForm.name} onChange={e => setSetupForm({...setupForm, name: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} required placeholder="e.g. 10kg Biryani Pot" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: '12px', fontWeight: '800', color: '#0369a1', display: 'block', marginBottom: '6px' }}>Finished Stock Name</label>
                    <input type="text" value={setupForm.portionName} onChange={e => setSetupForm({...setupForm, portionName: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid #bae6fd`, background: '#f0f9ff', borderRadius: '6px' }} placeholder="e.g. Biryani Portion" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', fontWeight: '800', color: '#0369a1', display: 'block', marginBottom: '6px' }}>UOM</label>
                    <input type="text" value={setupForm.finishedUom} onChange={e => setSetupForm({...setupForm, finishedUom: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid #bae6fd`, background: '#f0f9ff', borderRadius: '6px' }} />
                  </div>
                </div>

                <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>
                      <tr>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Raw Ingredient</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}>UOM</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Qty</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Rate(£)</th>
                        <th style={{ padding: '8px', textAlign: 'center' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {setupForm.lines.map((line, idx) => (
                        <tr key={line.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                          <td style={{ padding: '6px', textAlign: 'left' }}>
                            <input type="text" value={line.ingredient} onChange={e => handleRecipeLineChange(idx, 'ingredient', e.target.value)} placeholder="e.g. Chicken" style={{ width: '100%', padding: '6px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px', width: '80px', textAlign: 'center' }}>
                            <input type="text" value={line.uom} onChange={e => handleRecipeLineChange(idx, 'uom', e.target.value)} style={{ width: '100%', padding: '6px', textAlign: 'center', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px', width: '80px', textAlign: 'right' }}>
                            <input type="number" step="any" value={line.qty} onChange={e => handleRecipeLineChange(idx, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '6px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px', width: '90px', textAlign: 'right' }}>
                            <input type="number" step="any" value={line.rate} onChange={e => handleRecipeLineChange(idx, 'rate', e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '6px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <button type="button" onClick={() => removeRecipeLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan="5" style={{ padding: '10px', background: '#f8fafc' }}>
                          <button type="button" onClick={addRecipeLine} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#fff', color: '#0369a1', border: `1px dashed ${sheetTheme.border}`, borderRadius: '4px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}><PlusCircle size={14} /> Add Ingredient</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Spices / Oil (Flat £)</label>
                    <input type="number" step="any" value={setupForm.spicesCost} onChange={e => setSetupForm({...setupForm, spicesCost: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} placeholder="e.g. 5.00" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Yield ({setupForm.finishedUom || 'Portions'})</label>
                    <input type="number" step="any" value={setupForm.defaultYield} onChange={e => setSetupForm({...setupForm, defaultYield: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} required placeholder="e.g. 40" />
                  </div>
                </div>

                <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '8px', border: `1px solid #bbf7d0` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#166534' }}>Calculated Batch Cost:</span>
                    <span style={{ fontSize: '14px', fontWeight: '900', color: '#14532d' }}>£{fmtMoney(setupFormSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#166534' }}>Cost Per Unit ({setupForm.finishedUom || 'Portions'}):</span>
                    <span style={{ fontSize: '14px', fontWeight: '900', color: '#14532d' }}>
                      £{setupForm.defaultYield ? fmtMoney(setupFormSubtotal / Number(setupForm.defaultYield)) : '0.00'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="submit" style={{ flex: 1, padding: '12px', background: editingId ? '#d97706' : '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                    {editingId ? 'Update Template' : 'Save Template'}
                  </button>
                  {editingId && (
                    <button type="button" onClick={handleCancelEdit} style={{ flex: 1, padding: '12px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div style={{ flex: '1 1 450px', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: '#f8fafc', padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>Saved Recipes</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '14px 16px', textAlign: 'center', width: '50px' }}>S.No</th>
                    <th style={{ padding: '14px 16px', textAlign: 'left' }}>Recipe Details</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Cost / Unit</th>
                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recipesDb.length === 0 ? <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>No templates saved.</td></tr> : 
                  recipesDb.map((item, idx) => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}`, background: editingId === item.id ? '#fef3c7' : '#fff' }}>
                      <td style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>{idx + 1}</td>
                      <td style={{ padding: '16px', textAlign: 'left' }}>
                        <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.name}</div>
                        <div style={{ fontSize: '11px', color: '#0369a1', marginTop: '4px', fontWeight: '600' }}>Stock Name: {item.portionName || item.name}</div>
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', fontSize: '14px', fontWeight: '800', color: '#059669' }}>£ {fmtMoney(item.costPerPortion)}</td>
                      <td style={{ padding: '16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button onClick={() => handleEditTemplate(item)} style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer' }} title="Edit"><Edit size={16} /></button>
                          <button onClick={() => handleDeleteTemplate(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} title="Delete"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: OPENING STOCK */}
        {activeTab === 'opening' && (
          <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
            <div style={{ padding: '16px 24px', background: '#f0fdf4', borderBottom: `1px solid #bbf7d0`, display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontWeight: '800', color: '#166534', marginRight: '8px' }}>⚡ Quick Add:</div>
              <input type="text" placeholder="Item Name (e.g. Water)" value={quickAddForm.name} onChange={e => setQuickAddForm({...quickAddForm, name: e.target.value})} style={{ flex: 1, minWidth: '150px', padding: '10px 12px', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: '600' }} />
              <input type="text" placeholder="UOM" value={quickAddForm.uom} onChange={e => setQuickAddForm({...quickAddForm, uom: e.target.value})} style={{ width: '80px', padding: '10px 12px', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: '600' }} />
              <input type="number" step="any" placeholder="Cost(£)" value={quickAddForm.cost} onChange={e => setQuickAddForm({...quickAddForm, cost: e.target.value})} style={{ width: '90px', padding: '10px 12px', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: '600' }} />
              <input type="number" step="any" placeholder="Start Qty" value={quickAddForm.qty} onChange={e => setQuickAddForm({...quickAddForm, qty: e.target.value})} style={{ width: '90px', padding: '10px 12px', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: '600' }} />
              <button onClick={handleQuickAdd} style={{ padding: '10px 20px', background: '#166534', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800' }}>+ Add</button>
            </div>

            <div style={{ background: sheetTheme.headerGreenBg, color: sheetTheme.headerGreenText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
              Setup Opening Stock Balances
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f1f5f9', borderBottom: `1px solid ${sheetTheme.border}` }}>
                <tr>
                  <th style={{ padding: '14px 16px', textAlign: 'center', width: '50px' }}>S.No</th>
                  <th style={{ padding: '14px 16px', textAlign: 'left' }}>Finished Item (Portion Name)</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', width: '100px' }}>UOM</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right', width: '120px' }}>Opening Qty</th>
                </tr>
              </thead>
              <tbody>
                {recipesDb.length === 0 ? (
                  <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>Please create recipes in the Setup tab first.</td></tr>
                ) : (
                  recipesDb.map((item, idx) => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', color: '#64748b' }}>{idx + 1}</td>
                      <td style={{ padding: '16px', textAlign: 'left', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.portionName || item.name}</td>
                      <td style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{item.finishedUom || 'Portions'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <input 
                          type="number" step="any" 
                          value={localOpeningStock[item.id] === 0 ? '' : localOpeningStock[item.id]} 
                          onChange={e => setLocalOpeningStock(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="0"
                          style={{ width: '100%', padding: '10px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', fontWeight: '800', fontSize: '14px' }}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div style={{ padding: '20px 24px', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${sheetTheme.border}` }}>
              <button 
                onClick={handleSaveOpeningStock} disabled={isSavingStock}
                style={{ padding: '12px 32px', background: '#166534', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: isSavingStock ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Save size={18} /> {isSavingStock ? 'Saving...' : 'Save Opening Stock to Cloud'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}