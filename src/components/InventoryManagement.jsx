import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";
import { LayoutDashboard, Save, ChefHat, Trash2, Download, Printer, BarChart3, Settings, PlusCircle, PackageOpen } from 'lucide-react';

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
  
  // Databases
  const [recipesDb, setRecipesDb] = useState([]);
  const [productionDb, setProductionDb] = useState([]);
  const [salesDb, setSalesDb] = useState([]);
  
  // Forms & Modals
  const [setupForm, setSetupForm] = useState({
    name: '', defaultYield: '', spicesCost: '',
    lines: [{ id: Date.now(), ingredient: '', qty: '', rate: '' }]
  });
  
  const [reportDates, setReportDates] = useState({ startDate: getFirstDayOfMonth(), endDate: getToday() });
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [prodLog, setProdLog] = useState({ date: getToday(), recipe: null, actualYield: '' });
  
  // Opening Stock state
  const [localOpeningStock, setLocalOpeningStock] = useState({});
  const [isSavingStock, setIsSavingStock] = useState(false);

  // Load Data
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

        // Initialize local opening stock state
        const osMap = {};
        fetchedRecipes.forEach(r => { osMap[r.id] = r.openingQty || 0; });
        setLocalOpeningStock(osMap);

      } catch (err) {
        console.error("Failed to load inventory data", err);
      }
    };
    loadData();
  }, []);

  // --- CORE ENGINE: CURRENT STOCK & VALUATION ---
  const finishedGoodsStock = useMemo(() => {
    const stockMap = {};
    recipesDb.forEach(rec => {
      stockMap[rec.id] = { 
        ...rec, 
        totalProduced: 0, 
        totalSold: 0,
        openingQty: Number(rec.openingQty) || 0
      };
    });

    productionDb.forEach(prod => {
      if (stockMap[prod.recipeId]) {
        stockMap[prod.recipeId].totalProduced += Number(prod.portionsMade) || 0;
      }
    });

    salesDb.forEach(sale => {
      if (sale.pmix) {
        sale.pmix.forEach(p => {
          if (stockMap[p.recipeId]) {
            stockMap[p.recipeId].totalSold += Number(p.qtySold) || 0;
          }
        });
      }
    });

    return Object.values(stockMap).map(item => {
      const currentQty = item.openingQty + item.totalProduced - item.totalSold;
      return {
        ...item,
        currentQty: currentQty,
        totalValue: currentQty * item.costPerPortion
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [recipesDb, productionDb, salesDb]);

  // --- REPORTING ENGINE: COGS & DAILY PROFIT ---
  const dailyReportsData = useMemo(() => {
    const dailyMap = {};
    
    salesDb.forEach(sale => {
      const sDate = sale.date;
      if (sDate >= reportDates.startDate && sDate <= reportDates.endDate) {
        if (!dailyMap[sDate]) dailyMap[sDate] = { date: sDate, revenue: 0, cogs: 0 };
        
        dailyMap[sDate].revenue += Number(sale.totalNet || sale.totalGross || sale.netRevenue || 0);

        if (sale.pmix) {
          sale.pmix.forEach(p => {
            const stockItem = recipesDb.find(r => r.id === p.recipeId);
            if (stockItem) {
              dailyMap[sDate].cogs += (Number(p.qtySold) * stockItem.costPerPortion);
            }
          });
        }
      }
    });

    return Object.values(dailyMap).map(day => {
      const grossProfit = day.revenue - day.cogs;
      const foodCostPct = day.revenue > 0 ? (day.cogs / day.revenue) * 100 : 0;
      return { ...day, grossProfit, foodCostPct };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [salesDb, recipesDb, reportDates]);

  // --- RECIPE BUILDER HANDLERS ---
  const handleRecipeLineChange = (index, field, value) => {
    setSetupForm(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const addRecipeLine = () => {
    setSetupForm(prev => ({ ...prev, lines: [...prev.lines, { id: Date.now(), ingredient: '', qty: '', rate: '' }] }));
  };

  const removeRecipeLine = (index) => {
    setSetupForm(prev => {
      const newLines = [...prev.lines];
      newLines.splice(index, 1);
      if (newLines.length === 0) newLines.push({ id: Date.now(), ingredient: '', qty: '', rate: '' });
      return { ...prev, lines: newLines };
    });
  };

  const setupFormSubtotal = useMemo(() => {
    const linesTotal = setupForm.lines.reduce((sum, line) => sum + ((Number(line.qty) || 0) * (Number(line.rate) || 0)), 0);
    const spicesTotal = Number(setupForm.spicesCost) || 0;
    return linesTotal + spicesTotal;
  }, [setupForm.lines, setupForm.spicesCost]);

  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!setupForm.name.trim() || !setupForm.defaultYield) return alert("Recipe name and yield are required.");
    
    const yieldNum = Number(setupForm.defaultYield);
    if (yieldNum <= 0) return alert("Yield must be greater than zero.");

    const batchCost = setupFormSubtotal;
    const costPerPortion = batchCost / yieldNum;

    const newTemplate = { 
      name: setupForm.name.trim(), 
      batchCost: batchCost, 
      defaultYield: yieldNum,
      costPerPortion: costPerPortion,
      spicesCost: Number(setupForm.spicesCost) || 0,
      ingredients: setupForm.lines.filter(l => l.ingredient.trim() !== ''),
      openingQty: 0
    };

    try {
      const docRef = await addDoc(collection(db, "erp_recipes"), newTemplate);
      setRecipesDb(prev => [...prev, { id: docRef.id, ...newTemplate }].sort((a,b) => a.name.localeCompare(b.name)));
      setLocalOpeningStock(prev => ({ ...prev, [docRef.id]: 0 }));
      alert("✅ Recipe Detailed Template Saved Successfully!");
      setSetupForm({ name: '', defaultYield: '', spicesCost: '', lines: [{ id: Date.now(), ingredient: '', qty: '', rate: '' }] });
    } catch (err) { alert("Error saving template."); }
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm("Delete this recipe template?")) return;
    try {
      await deleteDoc(doc(db, "erp_recipes", id));
      setRecipesDb(prev => prev.filter(r => r.id !== id));
    } catch (err) { alert("Error deleting template."); }
  };

  // --- OPENING STOCK HANDLERS ---
  const handleSaveOpeningStock = async () => {
    setIsSavingStock(true);
    try {
      for (const recipe of recipesDb) {
        const newQty = Number(localOpeningStock[recipe.id]) || 0;
        if (newQty !== recipe.openingQty) {
          await updateDoc(doc(db, "erp_recipes", recipe.id), { openingQty: newQty });
        }
      }
      setRecipesDb(prev => prev.map(r => ({ ...r, openingQty: Number(localOpeningStock[r.id]) || 0 })));
      alert("✅ Opening Stock Updated Successfully!");
    } catch (error) {
      alert("Error saving opening stock");
    } finally {
      setIsSavingStock(false);
    }
  };

  // --- PRODUCTION LOGGING ---
  const openProductionModal = (recipe) => {
    setProdLog({ date: getToday(), recipe: recipe, actualYield: recipe.defaultYield });
    setShowProductionModal(true);
  };

  const handleLogProduction = async (e) => {
    e.preventDefault();
    if (!prodLog.recipe || !prodLog.actualYield) return;
    
    const prodId = "PROD-" + Date.now();
    const prodRecord = { 
      id: prodId, 
      date: prodLog.date, 
      recipeId: prodLog.recipe.id, 
      portionsMade: Number(prodLog.actualYield), 
      totalBatchCost: Number(prodLog.recipe.batchCost) 
    };

    try {
      await addDoc(collection(db, "erp_production_logs"), prodRecord);
      setProductionDb(prev => [...prev, prodRecord]);
      setShowProductionModal(false);
      alert("✅ Batch Logged! Portions added to stock.");
      setActiveTab('dashboard');
    } catch (err) { alert("Error logging production."); }
  };

  // --- EXPORT FUNCTIONS ---
  const downloadCSV = (csvContent, filename) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = filename; link.style.visibility = 'hidden';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    let csvStr = `Inventory Valuation Report (${getToday()})\n\n`;
    csvStr += `Finished Goods Stock\nItem Name,Current Portions,Static Cost/Portion(£),Total Asset Value(£)\n`;
    finishedGoodsStock.forEach(item => {
      csvStr += `"${item.name}",${item.currentQty},${item.costPerPortion},${item.totalValue}\n`;
    });

    if (activeTab === 'reports') {
      csvStr += `\nDaily Revenue & COGS Report (${reportDates.startDate} to ${reportDates.endDate})\n`;
      csvStr += `Date,Net Revenue(£),COGS(£),Gross Profit(£),Food Cost(%)\n`;
      dailyReportsData.forEach(day => { csvStr += `${day.date},${day.revenue},${day.cogs},${day.grossProfit},${day.foodCostPct}\n`; });
    }
    downloadCSV(csvStr, `Inventory_Reports_${getToday()}.csv`);
  };

  return (
    <div style={{ padding: '24px', fontFamily: sheetTheme.font, background: '#f8fafc', minHeight: '100vh', color: '#0f172a' }}>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } }`}</style>

      {/* PRODUCTION MODAL */}
      {showProductionModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.8)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
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
                <input type="date" value={prodLog.date} onChange={e => setProdLog({...prodLog, date: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', boxSizing: 'border-box' }} required />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: '800', color: '#c2410c', display: 'block', marginBottom: '6px' }}>Actual Portions Packed (Yield)</label>
                <input type="number" step="any" value={prodLog.actualYield} onChange={e => setProdLog({...prodLog, actualYield: e.target.value})} style={{ width: '100%', padding: '14px', border: `2px solid #fdba74`, borderRadius: '6px', background: '#fffbeb', fontWeight: '900', fontSize: '18px', textAlign: 'center', boxSizing: 'border-box' }} required />
              </div>

              <button type="submit" style={{ padding: '14px', background: '#ea580c', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '900', fontSize: '16px', cursor: 'pointer', marginTop: '8px', boxShadow: '0 4px 6px -1px rgba(234, 88, 12, 0.2)' }}>
                Confirm & Log Batch
              </button>
            </form>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* HEADER */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${sheetTheme.border}`, paddingBottom: '16px', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '900', color: '#0f172a', letterSpacing: '-0.5px' }}>Finished Goods Inventory</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b', fontWeight: '500' }}>Recipe costing, 1-click batch logging, and automated COGS.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}><Download size={16} /> Export CSV</button>
            <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}><Printer size={16} /> Print Report</button>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="no-print" style={{ display: 'flex', background: '#fff', border: `1px solid ${sheetTheme.border}`, marginBottom: '32px', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'dashboard' ? sheetTheme.headerBlueBg : 'transparent', color: activeTab === 'dashboard' ? sheetTheme.headerBlueText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><LayoutDashboard size={18} /> Live Stock</button>
          <button onClick={() => setActiveTab('production')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'production' ? sheetTheme.headerOrangeBg : 'transparent', color: activeTab === 'production' ? sheetTheme.headerOrangeText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><ChefHat size={18} /> Cook Batches</button>
          <button onClick={() => setActiveTab('reports')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'reports' ? sheetTheme.headerPurpleBg : 'transparent', color: activeTab === 'reports' ? sheetTheme.headerPurpleText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><BarChart3 size={18} /> COGS Analytics</button>
          <button onClick={() => setActiveTab('setup')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'setup' ? '#f1f5f9' : 'transparent', color: activeTab === 'setup' ? '#0f172a' : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><Settings size={18} /> Recipe Setup</button>
          <button onClick={() => setActiveTab('opening')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'opening' ? sheetTheme.headerGreenBg : 'transparent', color: activeTab === 'opening' ? sheetTheme.headerGreenText : '#64748b', border: 'none', fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}><PackageOpen size={18} /> Opening Stock</button>
        </div>

        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Finished Goods Stock (Fridge & Freezer)</span>
              <span style={{ fontSize: '13px', fontWeight: '700', background: '#fff', padding: '4px 12px', borderRadius: '20px', color: '#0284c7' }}>Total Valuation: £ {fmtMoney(finishedGoodsStock.reduce((sum, item) => sum + Math.max(0, item.totalValue), 0))}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `2px solid ${sheetTheme.border}` }}>
                <tr>
                  <th style={{ padding: '14px 24px' }}>Prepared Item</th>
                  <th style={{ padding: '14px 24px', textAlign: 'right' }}>Current Portions</th>
                  <th style={{ padding: '14px 24px', textAlign: 'right' }}>Static Cost / Portion</th>
                  <th style={{ padding: '14px 24px', textAlign: 'right' }}>Total Asset Value</th>
                </tr>
              </thead>
              <tbody>
                {finishedGoodsStock.length === 0 ? (
                  <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>No items in stock. Set opening balances or log batches.</td></tr>
                ) : (
                  finishedGoodsStock.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '16px 24px', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.name}</td>
                      <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: '900', fontSize: '16px', color: item.currentQty < 0 ? '#dc2626' : (item.currentQty === 0 ? '#94a3b8' : '#059669') }}>{fmtQty(item.currentQty)}</td>
                      <td style={{ padding: '16px 24px', textAlign: 'right', fontSize: '14px', fontWeight: '600', color: '#475569' }}>£ {fmtMoney(item.costPerPortion)}</td>
                      <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>£ {fmtMoney(Math.max(0, item.totalValue))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: KITCHEN PRODUCTION */}
        {activeTab === 'production' && (
          <div style={{ background: '#fff', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ marginBottom: '20px', borderBottom: `1px solid ${sheetTheme.border}`, paddingBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '8px' }}><ChefHat size={20} /> 1-Click Production Logger</h2>
              <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#64748b' }}>Tap a batch below when it finishes cooking to automatically add the portions to stock.</p>
            </div>
            {recipesDb.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px', border: `1px dashed ${sheetTheme.border}` }}>
                <p style={{ margin: 0, fontWeight: '700' }}>No Recipe Templates setup.</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Go to "Recipe Setup" to create your first pot/batch.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                {recipesDb.map(recipe => (
                  <button key={recipe.id} onClick={() => openProductionModal(recipe)} style={{ background: '#fff', border: `2px solid ${sheetTheme.border}`, borderRadius: '8px', padding: '20px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>{recipe.name}</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px' }}>Cost: £{fmtMoney(recipe.batchCost)}</span>
                      <span style={{ fontSize: '12px', fontWeight: '800', color: '#ea580c', background: '#fff7ed', padding: '4px 8px', borderRadius: '4px' }}>Yield: {recipe.defaultYield}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: REPORTS */}
        {activeTab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="no-print" style={{ display: 'flex', gap: '16px', background: '#fff', padding: '20px', borderRadius: '12px', border: `1px solid ${sheetTheme.border}` }}>
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
                    <th style={{ padding: '14px 24px' }}>Date</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Net Revenue (£)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>COGS (£)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Gross Profit (£)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Food Cost %</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyReportsData.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>No sales data logged in this range.</td></tr>
                  ) : (
                    dailyReportsData.map((day, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '14px 24px', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{day.date}</td>
                        <td style={{ padding: '14px 24px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#059669' }}>£ {fmtMoney(day.revenue)}</td>
                        <td style={{ padding: '14px 24px', textAlign: 'right', fontWeight: '700', fontSize: '14px', color: '#dc2626' }}>£ {fmtMoney(day.cogs)}</td>
                        <td style={{ padding: '14px 24px', textAlign: 'right', fontWeight: '900', fontSize: '15px', color: '#0369a1' }}>£ {fmtMoney(day.grossProfit)}</td>
                        <td style={{ padding: '14px 24px', textAlign: 'right', fontWeight: '900', fontSize: '15px', color: day.foodCostPct > 35 ? '#dc2626' : '#059669' }}>{fmtPct(day.foodCostPct)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: RECIPE SETUP (DYNAMIC COSTING) */}
        {activeTab === 'setup' && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            
            {/* BUILDER FORM */}
            <div className="no-print" style={{ flex: '1 1 450px', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: '#f1f5f9', color: '#0f172a', padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                ➕ Build Recipe Cost Calculator
              </div>
              <form onSubmit={handleSaveTemplate} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Recipe Name</label>
                  <input type="text" value={setupForm.name} onChange={e => setSetupForm({...setupForm, name: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} required placeholder="e.g. 10kg Biryani Pot" />
                </div>
                
                {/* DYNAMIC INGREDIENT ROWS */}
                <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#f8fafc', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>
                      <tr>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: `1px solid ${sheetTheme.border}` }}>Raw Ingredient</th>
                        <th style={{ padding: '8px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Qty</th>
                        <th style={{ padding: '8px', textAlign: 'right', borderBottom: `1px solid ${sheetTheme.border}` }}>Rate(£)</th>
                        <th style={{ padding: '8px', textAlign: 'center', borderBottom: `1px solid ${sheetTheme.border}` }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {setupForm.lines.map((line, idx) => (
                        <tr key={line.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                          <td style={{ padding: '6px' }}>
                            <input type="text" value={line.ingredient} onChange={e => handleRecipeLineChange(idx, 'ingredient', e.target.value)} placeholder="e.g. Chicken" style={{ width: '100%', padding: '6px', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px' }}>
                            <input type="number" step="any" value={line.qty} onChange={e => handleRecipeLineChange(idx, 'qty', e.target.value)} placeholder="0" style={{ width: '100%', padding: '6px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px' }}>
                            <input type="number" step="any" value={line.rate} onChange={e => handleRecipeLineChange(idx, 'rate', e.target.value)} placeholder="0.00" style={{ width: '100%', padding: '6px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '4px' }} />
                          </td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            <button type="button" onClick={() => removeRecipeLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan="4" style={{ padding: '10px', background: '#f8fafc' }}>
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
                    <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Portions Yield</label>
                    <input type="number" step="any" value={setupForm.defaultYield} onChange={e => setSetupForm({...setupForm, defaultYield: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px' }} required placeholder="e.g. 40" />
                  </div>
                </div>

                <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '8px', border: `1px solid #bbf7d0` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#166534' }}>Calculated Batch Cost:</span>
                    <span style={{ fontSize: '14px', fontWeight: '900', color: '#14532d' }}>£{fmtMoney(setupFormSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#166534' }}>Cost Per Portion:</span>
                    <span style={{ fontSize: '14px', fontWeight: '900', color: '#14532d' }}>
                      £{setupForm.defaultYield ? fmtMoney(setupFormSubtotal / Number(setupForm.defaultYield)) : '0.00'}
                    </span>
                  </div>
                </div>

                <button type="submit" style={{ padding: '12px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>Save Recipe Template</button>
              </form>
            </div>

            {/* MASTER LIST */}
            <div style={{ flex: '1 1 450px', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ background: '#f8fafc', padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>Saved Recipes</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '12px 24px' }}>Recipe Details</th>
                    <th style={{ padding: '12px 24px', textAlign: 'right' }}>Cost / Portion</th>
                    <th className="no-print" style={{ padding: '12px 24px', textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {recipesDb.length === 0 ? <tr><td colSpan="3" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>No templates saved.</td></tr> : 
                  recipesDb.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '14px 24px' }}>
                        <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Total Cost: £{fmtMoney(item.batchCost)} | Yield: {item.defaultYield}</div>
                      </td>
                      <td style={{ padding: '14px 24px', textAlign: 'right', fontSize: '14px', fontWeight: '800', color: '#059669' }}>£ {fmtMoney(item.costPerPortion)}</td>
                      <td className="no-print" style={{ padding: '14px 24px', textAlign: 'center' }}>
                        <button onClick={() => handleDeleteTemplate(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: OPENING STOCK (CoA Style) */}
        {activeTab === 'opening' && (
          <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <div style={{ background: sheetTheme.headerGreenBg, color: sheetTheme.headerGreenText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
              Setup Opening Stock Balances
            </div>
            <div style={{ padding: '16px 24px', background: '#f8fafc', fontSize: '13px', color: '#475569', borderBottom: `1px solid ${sheetTheme.border}` }}>
              Enter the physical amount of prepared portions you currently have in the freezer. This acts as the starting balance before new batches are cooked or sales are deducted.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f1f5f9', borderBottom: `1px solid ${sheetTheme.border}` }}>
                <tr>
                  <th style={{ padding: '14px 24px' }}>Finished Good (Recipe)</th>
                  <th style={{ padding: '14px 24px', textAlign: 'right' }}>Static Cost/Portion</th>
                  <th style={{ padding: '14px 24px', textAlign: 'right', width: '200px' }}>Opening Qty (Portions)</th>
                  <th style={{ padding: '14px 24px', textAlign: 'right' }}>Calculated Opening Value</th>
                </tr>
              </thead>
              <tbody>
                {recipesDb.length === 0 ? (
                  <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>Please create recipes in the Setup tab first.</td></tr>
                ) : (
                  recipesDb.map(item => {
                    const currentInput = Number(localOpeningStock[item.id]) || 0;
                    const calculatedValue = currentInput * item.costPerPortion;
                    return (
                      <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <td style={{ padding: '12px 24px', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.name}</td>
                        <td style={{ padding: '12px 24px', textAlign: 'right', fontSize: '13px', color: '#64748b' }}>£ {fmtMoney(item.costPerPortion)}</td>
                        <td style={{ padding: '12px 24px', textAlign: 'right' }}>
                          <input 
                            type="number" 
                            step="any" 
                            value={localOpeningStock[item.id] === 0 ? '' : localOpeningStock[item.id]} 
                            onChange={e => setLocalOpeningStock(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="0"
                            style={{ width: '100%', padding: '10px', textAlign: 'right', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', fontWeight: '800', fontSize: '14px' }}
                          />
                        </td>
                        <td style={{ padding: '12px 24px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>£ {fmtMoney(calculatedValue)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <div style={{ padding: '20px 24px', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', borderTop: `1px solid ${sheetTheme.border}` }}>
              <button 
                onClick={handleSaveOpeningStock} 
                disabled={isSavingStock}
                style={{ padding: '12px 32px', background: '#166534', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: isSavingStock ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Save size={18} /> {isSavingStock ? 'Saving...' : 'Save Opening Stock to Cloud'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}