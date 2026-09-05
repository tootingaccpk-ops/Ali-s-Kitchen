import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, deleteDoc, doc } from 'firebase/firestore'; 
import { db } from './firebase'; 
import { Home, Calculator, Wallet, ShoppingCart, FileText, Users, Store, Settings, LogOut, Landmark, Truck, ChevronDown, ChevronUp, Scale } from 'lucide-react';
import PurchasesExpenses from './components/PurchasesExpenses.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import DailySales from './components/Dailysalesform.jsx';
import ReceiptsPayments from './components/ReceiptsPayments.jsx';
import BankCashBook from './components/CashBankBooks.jsx';
import DeliverySettlements from './components/DeliverySettlement.jsx';
import Reports from './components/Reports.jsx';
import FinancialStatements from './components/FinancialStatements.jsx';
import Dashboard from './components/dashboard.jsx';
import SystemSetup from './components/SystemSettings.jsx'; 

const tabIcons = {
  'Dashboard': Home,
  'Daily Sales': Calculator,
  'Receipts & Payments': Wallet,
  'Purchases & Expenses': ShoppingCart,
  'Cash & Bank Books': Landmark, 
  'Delivery Settlements': Truck, 
  'Reports': FileText,
  'Financial Statements': Scale
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [reportSubTab, setReportSubTab] = useState('Sales Summary');
  const [reportsSubMenuOpen, setReportsSubMenuOpen] = useState(false);
  
  const [salesDb, setSalesDb] = useState([]);
  const [purchasesDb, setPurchasesDb] = useState([]); 
  const [receiptsDb, setReceiptsDb] = useState([]);
  const [accountsDb, setAccountsDb] = useState([]);
  const [deliveryDb, setDeliveryDb] = useState([]);
  const [categoriesMap, setCategoriesMap] = useState({});
  const [editRecordDate, setEditRecordDate] = useState(null);

  useEffect(() => {
    const sessionActive = sessionStorage.getItem('erp_session_active');
    if (sessionActive === 'true') {
      setIsAuthenticated(true);
      setCurrentUser({
        username: sessionStorage.getItem('erp_current_user'),
        role: sessionStorage.getItem('erp_current_role'),
        permissions: JSON.parse(sessionStorage.getItem('erp_user_permissions') || '[]')
      });
    }
  }, []);

  const allTabsList = ['Dashboard', 'Daily Sales', 'Purchases & Expenses', 'Receipts & Payments', 'Cash & Bank Books', 'Delivery Settlements', 'Reports', 'Financial Statements'];
  
  const hasAccess = (tabName) => {
    if (!currentUser) return false;
    const role = (currentUser.role || '').toLowerCase();
    if (role === 'admin' || role === 'owner') return true;
    return currentUser.permissions && currentUser.permissions.includes(tabName);
  };

  const allowedNavItems = allTabsList.filter(hasAccess);

  useEffect(() => {
    if (currentUser && !hasAccess(activeTab)) {
      const firstAllowed = allowedNavItems.length > 0 ? allowedNavItems[0] : (hasAccess('System Setup') ? 'System Setup' : null);
      if (firstAllowed) setActiveTab(firstAllowed);
    }
  }, [currentUser, activeTab]);

  // AUTOMATIC CLOUD DEDUPLICATION & REAL-TIME SYNC
  useEffect(() => {
    try {
      setDeliveryDb(JSON.parse(localStorage.getItem('erp_delivery')) || []);
      setCategoriesMap(JSON.parse(localStorage.getItem('erp_categories')) || {});
    } catch (e) {
      console.error("Error loading DB from localStorage", e);
    }

    // Auto-clean duplicates from Firestore on startup
    const cleanCloudDuplicates = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "erp_accounts"));
        const seenNames = new Set();
        const deletions = [];

        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const nameKey = String(data.name || '').trim().toLowerCase();
          if (nameKey) {
            if (seenNames.has(nameKey)) {
              deletions.push(deleteDoc(doc(db, "erp_accounts", docSnap.id)));
            } else {
              seenNames.add(nameKey);
            }
          }
        });

        if (deletions.length > 0) {
          await Promise.all(deletions);
          console.log(`🧹 Automatically cleaned ${deletions.length} duplicate account entries from Firebase.`);
        }
      } catch (err) {
        console.error("Error cleaning cloud duplicates:", err);
      }
    };
    cleanCloudDuplicates();

    // Real-time listener for Chart of Accounts
    const unsubscribeAccounts = onSnapshot(collection(db, "erp_accounts"), (snapshot) => {
      const cloudAccounts = [];
      const cloudCategories = {};
      const seenNames = new Set();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const nameKey = String(data.name || '').trim().toLowerCase();
        if (data.name && !seenNames.has(nameKey)) {
          seenNames.add(nameKey);
          cloudAccounts.push({ id: doc.id, ...data });
          cloudCategories[data.name] = data.category || 'Equity';
        }
      });

      if (cloudAccounts.length > 0) {
        setAccountsDb(cloudAccounts);
        setCategoriesMap(cloudCategories);
      }
    });

    // Real-time listeners for core transaction databases
    const unsubscribeSales = onSnapshot(collection(db, "erp_sales_db"), (snapshot) => {
      const salesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (salesData.length > 0) setSalesDb(salesData);
    });

    const unsubscribeReceipts = onSnapshot(collection(db, "erp_receipts"), (snapshot) => {
      const receiptsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (receiptsData.length > 0) setReceiptsDb(receiptsData);
    });

    const unsubscribePurchases = onSnapshot(collection(db, "erp_purchases"), (snapshot) => {
      const purchasesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (purchasesData.length > 0) setPurchasesDb(purchasesData);
    });

    return () => {
      unsubscribeAccounts();
      unsubscribeSales();
      unsubscribeReceipts();
      unsubscribePurchases();
    };
  }, []);

  useEffect(() => { if (Object.keys(categoriesMap).length > 0) localStorage.setItem('erp_categories', JSON.stringify(categoriesMap)); }, [categoriesMap]);
  useEffect(() => { if (deliveryDb.length > 0) localStorage.setItem('erp_delivery', JSON.stringify(deliveryDb)); }, [deliveryDb]);

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={(user) => {
      setIsAuthenticated(true);
      setCurrentUser(user);
    }} />;
  }

  const theme = { bg: '#f4f7f9', sidebar: '#ffffff', text: '#1e293b', muted: '#64748b', border: '#e2e8f0', primary: '#4f46e5' };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden', backgroundColor: theme.bg, fontFamily: '"Inter", sans-serif', boxSizing: 'border-box' }}>
      
      {/* GLOBAL SIDEBAR */}
      <div style={{ width: '240px', background: theme.sidebar, borderRight: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, zIndex: 10, boxShadow: '2px 0 10px rgba(0,0,0,0.02)', boxSizing: 'border-box', height: '100vh' }}>
        
        <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: `1px solid ${theme.border}`, marginBottom: '16px', flexShrink: 0 }}>
          <div style={{ width: '32px', height: '32px', background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(79, 70, 229, 0.3)' }}>
            <Store size={16} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '16px', fontWeight: '900', color: theme.text, letterSpacing: '-0.3px', lineHeight: '1.2' }}>Naanstaap</h1>
            <div style={{ fontSize: '10px', color: theme.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tooting ERP</div>
          </div>
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto', overflowX: 'hidden' }}>
          {allowedNavItems.map(item => {
            const Icon = tabIcons[item] || FileText; 
            const isActive = activeTab === item;
            
            if (item === 'Reports') {
              return (
                <div key={item}>
                  <div 
                    onClick={() => {
                      setActiveTab(item);
                      setReportsSubMenuOpen(!reportsSubMenuOpen);
                    }}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      padding: '12px 20px', 
                      cursor: 'pointer', 
                      color: isActive ? theme.primary : theme.muted, 
                      background: isActive ? '#eef2ff' : 'transparent', 
                      borderRight: isActive ? `3px solid ${theme.primary}` : '3px solid transparent', 
                      fontSize: '13px', 
                      fontWeight: isActive ? '700' : '600', 
                      transition: 'all 0.2s',
                      boxSizing: 'border-box'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Icon size={16} color={isActive ? theme.primary : theme.muted} />
                      {item}
                    </div>
                    {reportsSubMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>

                  {reportsSubMenuOpen && (
                    <div style={{ background: '#f8fafc', padding: '6px 0', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: `1px solid ${theme.border}`, boxSizing: 'border-box' }}>
                      {[
                        'Sales Summary',
                        'General Ledger',
                        'Supplier Balances',
                        'VAT Summary',
                        'Delivery Settlements',
                        'Variances'
                      ].map(sub => (
                        <div 
                          key={sub}
                          onClick={() => {
                            setActiveTab('Reports');
                            setReportSubTab(sub);
                          }} 
                          style={{ 
                            fontSize: '12px', 
                            paddingLeft: '44px',
                            paddingRight: '16px',
                            paddingTop: '6px',
                            paddingBottom: '6px',
                            color: reportSubTab === sub && activeTab === 'Reports' ? theme.primary : theme.muted, 
                            fontWeight: reportSubTab === sub && activeTab === 'Reports' ? '700' : '600', 
                            cursor: 'pointer',
                            backgroundColor: reportSubTab === sub && activeTab === 'Reports' ? '#eef2ff' : 'transparent'
                          }}
                        >
                          {sub}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div 
                key={item}
                onClick={() => {
                  setActiveTab(item);
                  if (item !== 'Daily Sales') setEditRecordDate(null); 
                }}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: '12px 20px', 
                  cursor: 'pointer', 
                  color: isActive ? theme.primary : theme.muted, 
                  background: isActive ? '#eef2ff' : 'transparent', 
                  borderRight: isActive ? `3px solid ${theme.primary}` : '3px solid transparent', 
                  fontSize: '13px', 
                  fontWeight: isActive ? '700' : '600', 
                  transition: 'all 0.2s',
                  boxSizing: 'border-box'
                }}
              >
                <Icon size={16} color={isActive ? theme.primary : theme.muted} />
                {item}
              </div>
            );
          })}
        </div>
        
      </div>

      {/* MAIN CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100vh', overflow: 'hidden', boxSizing: 'border-box' }}>
        
        <nav style={{ height: '60px', backgroundColor: '#ffffff', borderBottom: `1px solid ${theme.border}`, padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {hasAccess('System Setup') && (
              <button
                onClick={() => setActiveTab('System Setup')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: activeTab === 'System Setup' ? '#eef2ff' : 'transparent',
                  color: activeTab === 'System Setup' ? theme.primary : theme.text,
                  border: `1px solid ${activeTab === 'System Setup' ? '#c7d2fe' : theme.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '700',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Settings size={14} /> System Setup
              </button>
            )}

            <div style={{ width: '1px', height: '24px', backgroundColor: theme.border }}></div>

            <button
              onClick={() => {
                sessionStorage.clear();
                setIsAuthenticated(false);
                setCurrentUser(null);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '700',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <LogOut size={14} /> Logout ({currentUser?.username})
            </button>
          </div>
        </nav>

        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
          <div style={{ width: '100%', minHeight: '100%', boxSizing: 'border-box' }}>
            
            {activeTab === 'Dashboard' && hasAccess('Dashboard') && (
              <Dashboard 
                db={salesDb} salesDb={salesDb} accountsDb={accountsDb} receiptsDb={receiptsDb} purchasesDb={purchasesDb} deliveryDb={deliveryDb}
                onEditRecord={(date) => { setEditRecordDate(date); setActiveTab('Daily Sales'); }}
                onDeleteRecord={(date) => {
                  if(window.confirm(`Are you sure you want to delete the sales record for ${date}?`)) {
                    const updatedSales = salesDb.filter(r => r.date !== date);
                    setSalesDb(updatedSales);
                    localStorage.setItem('erp_sales_db', JSON.stringify(updatedSales));
                  }
                }}
              />
            )}
            
            {activeTab === 'Daily Sales' && hasAccess('Daily Sales') && (
              <div style={{ padding: '32px', boxSizing: 'border-box' }}><DailySales db={salesDb} salesDb={salesDb} setSalesDb={setSalesDb} accountsDb={accountsDb} editDate={editRecordDate} onCancel={() => { setEditRecordDate(null); setActiveTab('Dashboard'); }} /></div>
            )}
            
            {activeTab === 'Receipts & Payments' && hasAccess('Receipts & Payments') && (
              <div style={{ padding: '32px', boxSizing: 'border-box' }}><ReceiptsPayments db={receiptsDb} setDb={setReceiptsDb} categoriesMap={categoriesMap} setCategoriesMap={setCategoriesMap} accountsDb={accountsDb} setAccountsDb={setAccountsDb} onGoBack={() => setActiveTab('Dashboard')} /></div>
            )}
            
            {activeTab === 'Purchases & Expenses' && hasAccess('Purchases & Expenses') && (
              <div style={{ padding: '32px', boxSizing: 'border-box' }}><PurchasesExpenses db={purchasesDb} setDb={setPurchasesDb} accountsDb={accountsDb} setAccountsDb={setAccountsDb} /></div>
            )}
            
            {activeTab === 'Cash & Bank Books' && hasAccess('Cash & Bank Books') && (
              <div style={{ padding: '32px', boxSizing: 'border-box' }}><BankCashBook db={accountsDb} accountsDb={accountsDb} setAccountsDb={setAccountsDb} receiptsDb={receiptsDb} setReceiptsDb={setReceiptsDb} salesDb={salesDb} /></div>
            )}
            
            {activeTab === 'Delivery Settlements' && hasAccess('Delivery Settlements') && (
              <div style={{ padding: '32px', boxSizing: 'border-box' }}>
                <DeliverySettlements 
                  db={deliveryDb} 
                  deliveryDb={deliveryDb} 
                  setDeliveryDb={setDeliveryDb} 
                  salesDb={salesDb} 
                  accountsDb={accountsDb} 
                  receiptsDb={receiptsDb}
                  setReceiptsDb={setReceiptsDb}
                />
              </div>
            )}

            {activeTab === 'Financial Statements' && hasAccess('Financial Statements') && (
              <div style={{ padding: '0px', boxSizing: 'border-box', width: '100%' }}>
                <FinancialStatements 
                  salesDb={salesDb} 
                  purchasesDb={purchasesDb} 
                  receiptsDb={receiptsDb} 
                  accountsDb={accountsDb} 
                  deliveryDb={deliveryDb} 
                  categoriesMap={categoriesMap} 
                />
              </div>
            )}
            
            {activeTab === 'Reports' && hasAccess('Reports') && (
              <div style={{ padding: '0px', boxSizing: 'border-box', width: '100%' }}>
                <Reports 
                  salesDb={salesDb} 
                  purchasesDb={purchasesDb} 
                  receiptsDb={receiptsDb} 
                  accountsDb={accountsDb} 
                  deliveryDb={deliveryDb} 
                  categoriesMap={categoriesMap} 
                  initialSubTab={reportSubTab}
                />
              </div>
            )}
            
            {activeTab === 'System Setup' && hasAccess('System Setup') && (
              <div style={{ padding: '32px', boxSizing: 'border-box' }}><SystemSetup accounts={accountsDb} setAccounts={setAccountsDb} categoriesMap={categoriesMap} setCategoriesMap={setCategoriesMap} salesDb={salesDb} setSalesDb={setSalesDb} receiptsDb={receiptsDb} setReceiptsDb={setReceiptsDb} /></div>
            )}

          </div>
        </main>

      </div>
    </div>
  );
}

export default App;