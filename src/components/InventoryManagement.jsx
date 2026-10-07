import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase'; 
import { collection, addDoc, getDocs, doc, deleteDoc, writeBatch } from "firebase/firestore";
import { LayoutDashboard, Save, ChefHat, Trash2, Download, Printer, BarChart3, Settings } from 'lucide-react';
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
  border: '#d1d5db', font: '"Arial", "Calibri", sans-serif',
  headerBlueBg: '#e0f2fe', headerBlueText: '#0369a1',
  headerGreenBg: '#dcfce7', headerGreenText: '#166534',
  headerOrangeBg: '#fff7ed', headerOrangeText: '#c2410c',
  headerPurpleBg: '#f3e8ff', headerPurpleText: '#7e22ce'
};

export default function InventoryManagement() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Databases
  const [recipesDb, setRecipesDb] = useState([]);
  const [productionDb, setProductionDb] = useState([]);
  const [salesDb, setSalesDb] = useState([]);
  
  // Forms & Modals
  const [setupForm, setSetupForm] = useState({ name: '', batchCost: '', defaultYield: '' });
  const [reportDates, setReportDates] = useState({ startDate: getFirstDayOfMonth(), endDate: getToday() });
  
  const [showProductionModal, setShowProductionModal] = useState(false);
  const [prodLog, setProdLog] = useState({ date: getToday(), recipe: null, actualYield: '' });

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [recipeSnap, prodSnap, salesSnap] = await Promise.all([
          getDocs(collection(db, "erp_recipes")),
          getDocs(collection(db, "erp_production_logs")),
          getDocs(collection(db, "erp_sales_db"))
        ]);
        
        setRecipesDb(recipeSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name)));
        setProductionDb(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setSalesDb(salesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Failed to load inventory data", err);
      }
    };
    loadData();
  }, []);

  // --- CORE ENGINE: WEIGHTED AVERAGE COST & CURRENT STOCK ---
  const finishedGoodsStock = useMemo(() => {
    const stockMap = {};
    recipesDb.forEach(rec => {
      stockMap[rec.id] = { ...rec, totalProduced: 0, totalCostSpent: 0, totalSold: 0 };
    });

    productionDb.forEach(prod => {
      if (stockMap[prod.recipeId]) {
        stockMap[prod.recipeId].totalProduced += Number(prod.portionsMade) || 0;
        stockMap[prod.recipeId].totalCostSpent += Number(prod.totalBatchCost) || 0;
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
      // Weighted Average Cost Formula
      const avgCost = item.totalProduced > 0 ? (item.totalCostSpent / item.totalProduced) : 0;
      const currentQty = item.totalProduced - item.totalSold;
      return {
        ...item,
        avgPortionCost: avgCost,
        currentQty: currentQty,
        totalValue: currentQty * avgCost
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
            const stockItem = finishedGoodsStock.find(r => r.id === p.recipeId);
            if (stockItem) {
              dailyMap[sDate].cogs += (Number(p.qtySold) * stockItem.avgPortionCost);
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
  }, [salesDb, finishedGoodsStock, reportDates]);

  // --- CRUD HANDLERS ---
  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!setupForm.name.trim() || !setupForm.batchCost || !setupForm.defaultYield) return alert("Please fill all fields.");

    const newTemplate = { 
      name: setupForm.name.trim(), 
      batchCost: Number(setupForm.batchCost), 
      defaultYield: Number(setupForm.defaultYield) 
    };

    try {
      const docRef = await addDoc(collection(db, "erp_recipes"), newTemplate);
      setRecipesDb(prev => [...prev, { id: docRef.id, ...newTemplate }].sort((a,b) => a.name.localeCompare(b.name)));
      alert("✅ Batch Template Saved Successfully!");
      setSetupForm({ name: '', batchCost: '', defaultYield: '' });
    } catch (err) { alert("Error saving template."); }
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm("Delete this batch template? This will not delete past production logs, but it will remove the button from the kitchen screen.")) return;
    try {
      await deleteDoc(doc(db, "erp_recipes", id));
      setRecipesDb(prev => prev.filter(r => r.id !== id));
    } catch (err) { alert("Error deleting template."); }
  };

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
      alert("✅ Batch Logged! Portions added to fridge stock.");
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
    csvStr += `Finished Goods Stock\nItem Name,Current Portions,Avg Cost/Portion(£),Total Value(£)\n`;
    finishedGoodsStock.forEach(item => {
      csvStr += `"${item.name}",${item.currentQty},${item.avgPortionCost},${item.totalValue}\n`;
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

      {/* PRODUCTION MODAL (1-CLICK LOGGER) */}
      {showProductionModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.8)', zIndex: 1010, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', width: '400px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '16px 20px', background: sheetTheme.headerOrangeBg, color: sheetTheme.headerOrangeText, fontWeight: '800', fontSize: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Log Production Batch</span>
              <button onClick={() => setShowProductionModal(false)} style={{ background: 'none', border: 'none', color: '#c2410c', cursor: 'pointer', fontSize: '20px' }}>&times;</button>
            </div>
            <form onSubmit={handleLogProduction} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Cooking:</div>
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
                <p style={{ fontSize: '11px', color: '#94a3b8', margin: '6px 0 0 0', textAlign: 'center' }}>Adjust this number if the batch was slightly larger or smaller than usual.</p>
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
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b', fontWeight: '500' }}>Periodic stock tracking, automated COGS, and 1-click batch logging.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}><Download size={16} /> Export CSV</button>
            <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}><Printer size={16} /> Print Report</button>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="no-print" style={{ display: 'flex', background: '#fff', border: `1px solid ${sheetTheme.border}`, marginBottom: '32px', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'dashboard' ? sheetTheme.headerBlueBg : 'transparent', color: activeTab === 'dashboard' ? sheetTheme.headerBlueText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}><LayoutDashboard size={18} /> Live Dashboard</button>
          <button onClick={() => setActiveTab('production')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'production' ? sheetTheme.headerOrangeBg : 'transparent', color: activeTab === 'production' ? sheetTheme.headerOrangeText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}><ChefHat size={18} /> Kitchen Production</button>
          <button onClick={() => setActiveTab('reports')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'reports' ? sheetTheme.headerPurpleBg : 'transparent', color: activeTab === 'reports' ? sheetTheme.headerPurpleText : '#64748b', border: 'none', borderRight: `1px solid ${sheetTheme.border}`, fontSize: '13px', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}><BarChart3 size={18} /> COGS Analytics</button>
          <button onClick={() => setActiveTab('setup')} style={{ flex: 1, padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: activeTab === 'setup' ? '#f1f5f9' : 'transparent', color: activeTab === 'setup' ? '#0f172a' : '#64748b', border: 'none', fontSize: '13px', fontWeight: '800', cursor: 'pointer', transition: 'all 0.2s' }}><Settings size={18} /> Master Setup</button>
        </div>

        {/* TAB 1: DASHBOARD (LIVE STOCK) */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                <div style={{ background: sheetTheme.headerBlueBg, color: sheetTheme.headerBlueText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Finished Goods Stock (Fridge & Freezer)</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', background: '#fff', padding: '4px 12px', borderRadius: '20px', color: '#0284c7' }}>Total Valuation: £ {fmtMoney(finishedGoodsStock.reduce((sum, item) => sum + Math.max(0, item.totalValue), 0))}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `2px solid ${sheetTheme.border}` }}>
                    <tr>
                    <th style={{ padding: '14px 24px' }}>Prepared Item (Batch Template)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Current Portions in Stock</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Weighted Avg Cost / Portion</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Total Asset Value</th>
                    </tr>
                </thead>
                <tbody>
                    {finishedGoodsStock.length === 0 ? (
                    <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>No items in stock. Go to Kitchen Production to log cooked batches.</td></tr>
                    ) : (
                    finishedGoodsStock.map(item => (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}`, background: item.currentQty < 0 ? '#fef2f2' : '#fff' }}>
                        <td style={{ padding: '16px 24px', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.name}</td>
                        <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: '900', fontSize: '16px', color: item.currentQty < 0 ? '#dc2626' : (item.currentQty === 0 ? '#94a3b8' : '#059669') }}>{fmtQty(item.currentQty)}</td>
                        <td style={{ padding: '16px 24px', textAlign: 'right', fontSize: '14px', fontWeight: '600', color: '#475569' }}>£ {fmtMoney(item.avgPortionCost)}</td>
                        <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>£ {fmtMoney(Math.max(0, item.totalValue))}</td>
                        </tr>
                    ))
                    )}
                </tbody>
                </table>
            </div>
          </div>
        )}

        {/* TAB 2: KITCHEN PRODUCTION (1-CLICK LOGGING) */}
        {activeTab === 'production' && (
          <div>
            <div style={{ background: '#fff', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ marginBottom: '20px', borderBottom: `1px solid ${sheetTheme.border}`, paddingBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '8px' }}><ChefHat size={20} /> 1-Click Production Logger</h2>
                <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#64748b' }}>Tap a batch below when it finishes cooking to automatically add it to stock.</p>
              </div>

              {recipesDb.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px', border: `1px dashed ${sheetTheme.border}` }}>
                  <p style={{ margin: 0, fontWeight: '700' }}>No Batch Templates setup.</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>Go to "Master Setup" to create your first pot/batch.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                  {recipesDb.map(recipe => (
                    <button key={recipe.id} onClick={() => openProductionModal(recipe)} style={{ background: '#fff', border: `2px solid ${sheetTheme.border}`, borderRadius: '8px', padding: '20px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

            <div style={{ marginTop: '24px', background: '#fff', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                <div style={{ background: '#f8fafc', padding: '16px 24px', fontWeight: '800', fontSize: '14px', borderBottom: `1px solid ${sheetTheme.border}`, color: '#0f172a' }}>Recent Production Logs (History)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                        <tr>
                            <th style={{ padding: '12px 24px' }}>Date</th>
                            <th style={{ padding: '12px 24px' }}>Batch Name</th>
                            <th style={{ padding: '12px 24px', textAlign: 'right' }}>Actual Portions Packed</th>
                            <th style={{ padding: '12px 24px', textAlign: 'right' }}>Calculated Cost/Portion</th>
                        </tr>
                    </thead>
                    <tbody>
                        {productionDb.length === 0 ? <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>No production logged yet.</td></tr> : 
                        [...productionDb].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10).map(log => {
                            const recipe = recipesDb.find(r => r.id === log.recipeId);
                            const cp = (Number(log.totalBatchCost) || 0) / (Number(log.portionsMade) || 1);
                            return (
                                <tr key={log.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                                    <td style={{ padding: '12px 24px', fontSize: '13px', color: '#475569', fontWeight: '600' }}>{log.date}</td>
                                    <td style={{ padding: '12px 24px', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{recipe ? recipe.name : 'Deleted Template'}</td>
                                    <td style={{ padding: '12px 24px', textAlign: 'right', fontWeight: '900', color: '#059669', fontSize: '15px' }}>{log.portionsMade}</td>
                                    <td style={{ padding: '12px 24px', textAlign: 'right', fontSize: '14px', fontWeight: '700', color: '#475569' }}>£ {fmtMoney(cp)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
          </div>
        )}

        {/* TAB 3: REPORTS (COGS) */}
        {activeTab === 'reports' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="no-print" style={{ display: 'flex', gap: '16px', background: '#fff', padding: '20px', borderRadius: '12px', border: `1px solid ${sheetTheme.border}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Report Start Date</label>
                <input type="date" value={reportDates.startDate} onChange={e => setReportDates({...reportDates, startDate: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', fontWeight: '700' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Report End Date</label>
                <input type="date" value={reportDates.endDate} onChange={e => setReportDates({...reportDates, endDate: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', fontWeight: '700' }} />
              </div>
            </div>

            <div style={{ border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ background: sheetTheme.headerPurpleBg, color: sheetTheme.headerPurpleText, padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                Daily Revenue vs. Cost of Goods Sold (COGS)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `2px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '14px 24px' }}>Date</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Net Revenue (£)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>COGS (Food Cost £)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Gross Profit (£)</th>
                    <th style={{ padding: '14px 24px', textAlign: 'right' }}>Actual Food Cost %</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyReportsData.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>No sales data logged in this date range.</td></tr>
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

        {/* TAB 4: MASTER SETUP */}
        {activeTab === 'setup' && (
          <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="no-print" style={{ flex: '1 1 350px', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ background: '#f1f5f9', color: '#0f172a', padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>
                ➕ Create New Batch Template
              </div>
              <form onSubmit={handleSaveTemplate} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Recipe / Batch Name</label>
                  <input type="text" value={setupForm.name} onChange={e => setSetupForm({...setupForm, name: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', boxSizing: 'border-box' }} required placeholder="e.g. 10kg Biryani Pot" />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Fixed Cost per Batch (£)</label>
                  <input type="number" step="any" value={setupForm.batchCost} onChange={e => setSetupForm({...setupForm, batchCost: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', boxSizing: 'border-box' }} required placeholder="e.g. 35.00" />
                  <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>Calculate the raw ingredients for one pot on paper, and enter the final financial cost here.</p>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '800', color: '#475569', display: 'block', marginBottom: '6px' }}>Default Portions Yield</label>
                  <input type="number" step="any" value={setupForm.defaultYield} onChange={e => setSetupForm({...setupForm, defaultYield: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${sheetTheme.border}`, borderRadius: '6px', boxSizing: 'border-box' }} required placeholder="e.g. 40" />
                </div>
                <button type="submit" style={{ padding: '12px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '14px', marginTop: '4px' }}>
                  Save to Master List
                </button>
              </form>
            </div>

            <div style={{ flex: '2 1 500px', border: `1px solid ${sheetTheme.border}`, borderRadius: '12px', overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ background: '#f8fafc', padding: '18px 24px', fontWeight: '900', fontSize: '15px', borderBottom: `1px solid ${sheetTheme.border}` }}>Master Batch Templates</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', borderBottom: `1px solid ${sheetTheme.border}` }}>
                  <tr>
                    <th style={{ padding: '12px 24px' }}>Batch Name</th>
                    <th style={{ padding: '12px 24px', textAlign: 'right' }}>Static Cost (£)</th>
                    <th style={{ padding: '12px 24px', textAlign: 'right' }}>Default Yield</th>
                    <th className="no-print" style={{ padding: '12px 24px', textAlign: 'center' }}>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {recipesDb.length === 0 ? <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontWeight: '500' }}>No templates saved. Create one to the left.</td></tr> : 
                  recipesDb.map(item => (
                    <tr key={item.id} style={{ borderBottom: `1px solid ${sheetTheme.border}` }}>
                      <td style={{ padding: '14px 24px', fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{item.name}</td>
                      <td style={{ padding: '14px 24px', textAlign: 'right', fontSize: '14px', fontWeight: '700', color: '#475569' }}>£ {fmtMoney(item.batchCost)}</td>
                      <td style={{ padding: '14px 24px', textAlign: 'right', fontSize: '14px', fontWeight: '800', color: '#ea580c' }}>{item.defaultYield}</td>
                      <td className="no-print" style={{ padding: '14px 24px', textAlign: 'center' }}>
                        <button onClick={() => handleDeleteTemplate(item.id)} title="Delete Template" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={16} /></button>
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