import React, { useState, useMemo } from 'react';
import { Calendar, ChevronDown, ChevronUp, Landmark, Edit2, Trash2, Search, TrendingUp, TrendingDown, Store, FileText, Calculator, Wallet, Truck, Bell } from 'lucide-react';
import { Chart } from 'react-google-charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const normalizeDate = (d) => {
  if (!d) return '';
  let nd = String(d).replace(/\//g, '-');
  const parts = nd.split('-');
  if (parts.length === 3) {
    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  return nd;
};

const fmtMoney = (n) => {
  const num = Number(n) || 0;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Dashboard({ db = [], accountsDb = [], receiptsDb = [], deliveryDb = [], purchasesDb = [], onEditRecord = null, onDeleteRecord = null }) {

  const [financeDate, setFinanceDate] = useState(getToday());
  const [salesStartDate, setSalesStartDate] = useState(getToday());
  const [salesEndDate, setSalesEndDate] = useState(getToday());

  const [searchDate, setSearchDate] = useState('');

  const [showCardDetails, setShowCardDetails] = useState(false);
  const [showDelDetails, setShowDelDetails] = useState(false);
  const [showPendingSafe, setShowPendingSafe] = useState(false);
  const [showBankDetails, setShowBankDetails] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const rDb = receiptsDb && receiptsDb.length > 0 ? receiptsDb : JSON.parse(localStorage.getItem('erp_receipts') || '[]');
  const dDb = deliveryDb && deliveryDb.length > 0 ? deliveryDb : JSON.parse(localStorage.getItem('erp_delivery') || '[]');
  const pDb = purchasesDb && purchasesDb.length > 0 ? purchasesDb : JSON.parse(localStorage.getItem('erp_purchases') || '[]');

  const val = (n) => Number(n) || 0;

  const prevDateRange = useMemo(() => {
    const d1 = new Date(salesStartDate);
    const d2 = new Date(salesEndDate);
    const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    const pTo = new Date(d1); pTo.setDate(pTo.getDate() - 1);
    const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - (diffDays - 1));
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: fmt(pFrom), to: fmt(pTo), label: diffDays === 1 ? 'Yesterday' : `Prev ${diffDays} Days` };
  }, [salesStartDate, salesEndDate]);

  const calculatePeriod = (start, end) => {
    return db.filter(d => {
      const nd = normalizeDate(d.date);
      return nd >= start && nd <= end;
    }).reduce((acc, curr) => {
      acc.cash += val(curr.cashGross) - val(curr.cashRefund);
      acc.cardM1 += val(curr.m1Gross) - val(curr.m1Refund);
      acc.cardM2 += val(curr.m2Gross) - val(curr.m2Refund);
      acc.cardM3 += val(curr.m3Gross) - val(curr.m3Refund);
      acc.delUber += val(curr.uber);
      acc.delDeliv += val(curr.deliveroo);
      acc.delJust += val(curr.justEat);
      acc.delApp4 += val(curr.app4);
      acc.delOther += val(curr.otherDel);
      acc.totalVat += val(curr.vatAmount) || val(curr.totalVat) || val(curr.vatCollected) || val(curr.vat);
      acc.totalCard = acc.cardM1 + acc.cardM2 + acc.cardM3;
      acc.totalDelivery = acc.delUber + acc.delDeliv + acc.delJust + acc.delApp4 + acc.delOther;
      acc.grandTotal = acc.cash + acc.totalCard + acc.totalDelivery;
      acc.grandTotalExclVat = acc.grandTotal - acc.totalVat;
      return acc;
    }, { cash: 0, cardM1: 0, cardM2: 0, cardM3: 0, delUber: 0, delDeliv: 0, delJust: 0, delApp4: 0, delOther: 0, totalCard: 0, totalDelivery: 0, grandTotal: 0, totalVat: 0, grandTotalExclVat: 0 });
  };

  const currStats = calculatePeriod(salesStartDate, salesEndDate);
  const prevStats = calculatePeriod(prevDateRange.from, prevDateRange.to);

  const vatStats = useMemo(() => {
    let salesVat = 0, purchVat = 0, platVat = 0;
    db.forEach(s => { const nd = normalizeDate(s.date); if (nd >= salesStartDate && nd <= salesEndDate) salesVat += (Number(s.vatAmount) || Number(s.totalVat) || Number(s.vatCollected) || Number(s.vat) || 0); });
    pDb.forEach(p => { const nd = normalizeDate(p.date); if (nd >= salesStartDate && nd <= salesEndDate) purchVat += (Number(p.totalVat) || 0); });
    dDb.forEach(d => { const nd = normalizeDate(d.payoutDate || d.dateTo || d.dateFrom || getToday()); if (nd >= salesStartDate && nd <= salesEndDate) platVat += (Number(d.vatOnCommission) || 0) + (Number(d.vatOnAdvertisement) || 0); });
    return { salesVat, purchVat, platVat, net: salesVat - purchVat - platVat };
  }, [db, pDb, dDb, salesStartDate, salesEndDate]);

  const pendingSafeBoxList = db.filter(d => {
    const amt = Number(d.safeBox) || 0;
    if (amt <= 0) return false;
    const rawDate = d.safeBoxDate || d.safeBoxColDate;
    if (!rawDate || String(rawDate).trim() === '') return true;
    if (normalizeDate(rawDate) > financeDate) return true;
    return false;
  });

  const getLiveBankBalance = (accountName, maxDate) => {
    let bal = 0;
    const acc = accountsDb.find(a => a.name === accountName);
    if (acc) bal += Number(acc.balance) || 0;

    rDb.forEach(r => {
      if (normalizeDate(r.date) > maxDate) return;
      if (r.type === 'Transfer') {
        if (r.toBank === accountName) bal += Number(r.amount);
        if (r.fromBank === accountName) bal -= Number(r.amount);
      } else if (r.mode === 'Bank' && r.bankName === accountName) {
        bal += r.type === 'Receipt' ? Number(r.amount) : -Number(r.amount);
      }
    });

    db.forEach(s => {
      if (normalizeDate(s.date) > maxDate) return;
      if (accountName === 'Memon Services Ltd') bal += Math.max(0, (Number(s.m1Gross) || 0) - (Number(s.m1Refund) || 0));
      if (accountName === 'Khanani Management') bal += Math.max(0, (Number(s.m2Gross) || 0) - (Number(s.m2Refund) || 0));
      if (accountName === 'LK Associates') bal += Math.max(0, (Number(s.m3Gross) || 0) - (Number(s.m3Refund) || 0));
    });

    if (accountName === 'Memon Services Ltd') {
      dDb.forEach(d => { if (normalizeDate(d.payoutDate || d.dateTo || d.dateFrom || getToday()) <= maxDate) bal += Number(d.actualPayout) || 0; });
    }

    return bal;
  };

  const getLiveCashBalance = (maxDate) => {
    let bal = 0;
    const cashAccounts = accountsDb.filter(a => a.name === 'Cash in Hand' || a.name === 'Safe Box (Main Cash)' || a.category === 'Safe Box (Main Cash)');
    cashAccounts.forEach(a => bal += Number(a.balance) || 0);

    rDb.forEach(r => {
      if (normalizeDate(r.date) > maxDate) return;
      if (r.type !== 'Transfer') {
        if (r.mode === 'Cash') {
          bal += r.type === 'Receipt' ? Number(r.amount) : -Number(r.amount);
        }
      } else {
        if (!String(r.description).includes('Auto-Collected')) {
          if (r.toBank === 'Cash in Hand' || r.toBank === 'Safe Box (Main Cash)') bal += Number(r.amount);
          if (r.fromBank === 'Cash in Hand' || r.fromBank === 'Safe Box (Main Cash)') bal -= Number(r.amount);
        }
      }
    });

    db.forEach(s => {
      const cDateRaw = s.safeBoxDate || s.safeBoxColDate;
      if (cDateRaw && String(cDateRaw).trim() !== '') {
        if (normalizeDate(cDateRaw) <= maxDate) {
          bal += Number(s.safeBox) || 0;
        }
      }
    });

    return bal;
  };

  const safeBoxBal = pendingSafeBoxList.reduce((sum, item) => sum + (Number(item.safeBox) || 0), 0);
  const cashInHandBal = getLiveCashBalance(financeDate);
  const bankM1 = getLiveBankBalance('Memon Services Ltd', financeDate);
  const bankM2 = getLiveBankBalance('Khanani Management', financeDate);
  const bankM3 = getLiveBankBalance('LK Associates', financeDate);
  const totalBank = bankM1 + bankM2 + bankM3;
  const totalAvailableBalance = cashInHandBal + totalBank;

  const sortedDb = [...db].sort((a, b) => new Date(normalizeDate(b.date)) - new Date(normalizeDate(a.date)));
  const endRecord = sortedDb.find(r => normalizeDate(r.date) <= financeDate);
  const physicalTillBalance = endRecord ? Number(endRecord.physicalTill) || 0 : 0;

  const formatDateToDDMMYYYY = (dateStr) => {
    if (!dateStr) return ''; const parts = normalizeDate(dateStr).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
  };

  const displayedHistory = searchDate
    ? [...db].filter(d => (d.date && d.date.includes(searchDate)) || formatDateToDDMMYYYY(d.date).includes(searchDate) || normalizeDate(d.date).includes(searchDate))
    : [...db].sort((a, b) => new Date(normalizeDate(b.date)) - new Date(normalizeDate(a.date))).slice(0, 5);

  const COLORS_SALES = ['#6366f1', '#f59e0b', '#10b981'];
  const COLORS_DEL = ['#64748b', '#14b8a6', '#f97316', '#f43f5e', '#8b5cf6'];

  const salesTotal = currStats.cash + currStats.totalCard + currStats.totalDelivery;
  const salesBreakdownData = [['Channel', 'Amount'], ['Cash', currStats.cash], ['Card', currStats.totalCard], ['Delivery', currStats.totalDelivery]];

  const deliveryRawData = [['Platform', 'Amount'], ['Uber Eats', currStats.delUber], ['Deliveroo', currStats.delDeliv], ['Just Eat', currStats.delJust], ['App4', currStats.delApp4], ['Other', currStats.delOther]];
  const deliveryTotal = currStats.delUber + currStats.delDeliv + currStats.delJust + currStats.delApp4 + currStats.delOther;
  const deliveryBreakdownData = [deliveryRawData[0], ...deliveryRawData.slice(1).filter(item => item[1] > 0)];

  const chartOptions3D = {
    is3D: true,
    backgroundColor: 'transparent',
    legend: { position: 'none' },
    pieSliceText: 'none',
    colors: COLORS_SALES,
    chartArea: { width: '95%', height: '95%', top: 10, bottom: 10 }
  };

  const deliveryChartOptions3D = {
    ...chartOptions3D,
    colors: COLORS_DEL
  };

  const trendData = displayedHistory.slice().reverse().map(d => {
    return {
      date: formatDateToDDMMYYYY(d.date).substring(0, 5),
      Cash: (val(d.cashGross) - val(d.cashRefund)),
      Card: (val(d.m1Gross) - val(d.m1Refund)) + (val(d.m2Gross) - val(d.m2Refund)) + (val(d.m3Gross) - val(d.m3Refund)),
      Delivery: val(d.uber) + val(d.deliveroo) + val(d.justEat) + val(d.app4) + val(d.otherDel)
    };
  });

  const handleEdit = (date) => { if (onEditRecord) onEditRecord(date); else alert("Go to Daily Sales tab to edit."); };

  // EXPORT TO PDF LOGIC - PERFECTLY SCALED, CENTERED, AND 1-PAGE
  const handleExportPDF = async () => {
    setIsExporting(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    const element = document.getElementById('dashboard-export-target');
    if (!element) { setIsExporting(false); return; }

    try {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#f8fafc', useCORS: true });
      const imgData = canvas.toDataURL('image/png');

      // Standard A4 Paper Size in millimeters
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const margins = 10;
      const availableWidth = pageWidth - (margins * 2);
      const availableHeight = pageHeight - 30; // Reserving 30mm for the header

      // Calculate aspect ratio to fit the image perfectly without stretching
      const imgRatio = canvas.width / canvas.height;
      let finalWidth = availableWidth;
      let finalHeight = finalWidth / imgRatio;

      // If the scaled height pushes it off the page, scale down by height instead to force 1 page
      if (finalHeight > availableHeight) {
        finalHeight = availableHeight;
        finalWidth = finalHeight * imgRatio;
      }

      // Calculate the X offset to place it dead-center horizontally
      const xOffset = (pageWidth - finalWidth) / 2;
      const yOffset = 25; // Render the image below the header text

      // Header for context (Perfectly Centered)
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text("Naanstaap Tooting - Dashboard Snapshot", pageWidth / 2, 15, { align: 'center' });

      pdf.addImage(imgData, 'PNG', xOffset, yOffset, finalWidth, finalHeight);
      pdf.save(`Dashboard_Export_${getToday()}.pdf`);
    } catch (error) {
      alert('Failed to generate PDF.');
    }
    setIsExporting(false);
  };

  const theme = { bg: '#f8fafc', card: '#ffffff', text: '#1e293b', muted: '#64748b', border: '#e2e8f0', primary: '#4f46e5' };

  const cardStyle = {
    background: theme.card,
    borderRadius: '10px',
    padding: '16px',
    border: `1px solid ${theme.border}`,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box'
  };

  const TrendIndicator = ({ curr, prev }) => {
    const diff = curr - prev; const isUp = diff >= 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: isUp ? '#059669' : '#dc2626', fontWeight: '600', marginTop: '6px' }}>
        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        <span>{isUp ? '+' : '-'} £{fmtMoney(Math.abs(diff))}</span>
      </div>
    );
  };

  const DropdownRow = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #e2e8f0', fontSize: '11px' }}>
      <span style={{ color: '#475569', fontWeight: '600' }}>{label}</span>
      <span style={{ fontWeight: '700', color: theme.text }}>£ {fmtMoney(value)}</span>
    </div>
  );

  return (
    <div style={{ padding: '24px', background: theme.bg, width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>

      {/* HEADER WITH EXPORT BUTTON */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: theme.text, letterSpacing: '-0.5px' }}>Dashboard Overview</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: theme.muted }}>Financial position, sales performance, and VAT summary.</p>
        </div>
        <button
          onClick={handleExportPDF}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '12px', boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)', transition: 'all 0.2s' }}
        >
          <FileText size={14} color="#fff" /> Export Dashboard to PDF
        </button>
      </div>

      {/* PDF EXPORT WRAPPER - This target div explicitly stops BEFORE the Sales Ledger table */}
      <div id="dashboard-export-target" style={{ background: theme.bg, paddingBottom: '16px', boxSizing: 'border-box' }}>

        {/* SECTION 1: FINANCIAL POSITION */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '800', color: theme.text, margin: 0 }}>Financial Position</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: '600' }}>
            <span style={{ color: theme.muted }}>As of:</span>
            {isExporting ? (
              <span style={{ fontWeight: '700', color: theme.text }}>{financeDate}</span>
            ) : (
              <input type="date" value={financeDate} onChange={e => setFinanceDate(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontWeight: '700', color: theme.text }} />
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px', alignItems: 'flex-start', boxSizing: 'border-box' }}>

          <div style={{ ...cardStyle, background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)', color: '#fff', border: 'none' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#e0e7ff', marginBottom: '4px' }}>Total Available Balance</div>
            <div style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.5px' }}>£{fmtMoney(totalAvailableBalance)}</div>
            <div style={{ fontSize: '10px', color: '#e0e7ff', marginTop: '6px', fontWeight: '500' }}>Cash + Total Bank</div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '11px', fontWeight: '700', color: theme.muted }}>
              <div style={{ background: '#fee2e2', padding: '4px', borderRadius: '4px' }}><Store size={12} color="#dc2626" /></div> Physical Till
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: theme.text }}>£{fmtMoney(physicalTillBalance)}</div>
            <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '6px', fontWeight: '600' }}>* Excluded from total</div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '11px', fontWeight: '700', color: theme.muted }}>
              <div style={{ background: '#dcfce7', padding: '4px', borderRadius: '4px' }}><Wallet size={12} color="#16a34a" /></div> Cash In Hand
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: theme.text }}>£{fmtMoney(cashInHandBal)}</div>
            <div style={{ fontSize: '10px', color: theme.muted, marginTop: '6px', fontWeight: '500' }}>Safe Drops & Receipts</div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '11px', fontWeight: '700', color: theme.muted }}>
                <div style={{ background: '#fef9c3', padding: '4px', borderRadius: '4px' }}><Truck size={12} color="#ca8a04" /></div> Safe Pending
              </div>
              <button onClick={() => setShowPendingSafe(!showPendingSafe)} style={{ background: '#f8fafc', border: `1px solid ${theme.border}`, cursor: 'pointer', padding: '2px', borderRadius: '4px' }}>
                {showPendingSafe ? <ChevronUp size={12} color={theme.muted} /> : <ChevronDown size={12} color={theme.muted} />}
              </button>
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: theme.text }}>£{fmtMoney(safeBoxBal)}</div>
            <div style={{ fontSize: '10px', color: theme.muted, marginTop: '6px', fontWeight: '500' }}>{pendingSafeBoxList.length} collections pending</div>

            {showPendingSafe && pendingSafeBoxList.length > 0 && (
              <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: `1px solid ${theme.border}` }}>
                {pendingSafeBoxList.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '10px' }}>
                    <span style={{ color: theme.muted, fontWeight: '600' }}>{formatDateToDDMMYYYY(item.date)}</span>
                    <span style={{ fontWeight: '800', color: '#a16207' }}>£ {fmtMoney(val(item.safeBox))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '11px', fontWeight: '700', color: theme.muted }}>
                <div style={{ background: '#dbeafe', padding: '4px', borderRadius: '4px' }}><Landmark size={12} color="#2563eb" /></div> Total Bank
              </div>
              <button onClick={() => setShowBankDetails(!showBankDetails)} style={{ background: '#f8fafc', border: `1px solid ${theme.border}`, cursor: 'pointer', padding: '2px', borderRadius: '4px' }}>
                {showBankDetails ? <ChevronUp size={12} color={theme.muted} /> : <ChevronDown size={12} color={theme.muted} />}
              </button>
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: theme.text }}>£{fmtMoney(totalBank)}</div>
            <div style={{ fontSize: '10px', color: theme.muted, marginTop: '6px', fontWeight: '500' }}>M1, M2 & M3 combined</div>

            {showBankDetails && (
              <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: `1px solid ${theme.border}` }}>
                <DropdownRow label="Memon M1" value={bankM1} />
                <DropdownRow label="Khanani M2" value={bankM2} />
                <DropdownRow label="LK Assoc." value={bankM3} />
              </div>
            )}
          </div>

        </div>

        <hr style={{ border: 'none', borderTop: `1px dashed ${theme.border}`, margin: '0 0 24px 0' }} />

        {/* SECTION 2: REVENUE & SALES DASHBOARD */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: '800', color: theme.text, margin: 0 }}>Revenue & Sales Performance</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: '600' }}>
            <Calendar size={12} color={theme.muted} />
            {isExporting ? (
              <span style={{ fontWeight: '700', color: theme.text }}>{salesStartDate}</span>
            ) : (
              <input type="date" value={salesStartDate} onChange={e => setSalesStartDate(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontWeight: '700', color: theme.text }} />
            )}
            <span style={{ color: theme.muted }}>-</span>
            {isExporting ? (
              <span style={{ fontWeight: '700', color: theme.text }}>{salesEndDate}</span>
            ) : (
              <input type="date" value={salesEndDate} onChange={e => setSalesEndDate(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontWeight: '700', color: theme.text }} />
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '16px', alignItems: 'flex-start', boxSizing: 'border-box' }}>

          <div style={cardStyle}>
            <div style={{ fontSize: '11px', color: theme.muted, fontWeight: '700', marginBottom: '4px' }}>Net Cash Sales</div>
            <div style={{ fontSize: '15px', fontWeight: '800' }}>£{fmtMoney(currStats.cash)}</div>
            <TrendIndicator curr={currStats.cash} prev={prevStats.cash} />
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{ fontSize: '11px', color: theme.muted, fontWeight: '700' }}>Net Card Sales</div>
              <button onClick={() => setShowCardDetails(!showCardDetails)} style={{ background: '#f8fafc', border: `1px solid ${theme.border}`, cursor: 'pointer', padding: '2px', borderRadius: '4px' }}>{showCardDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800' }}>£{fmtMoney(currStats.totalCard)}</div>
            <TrendIndicator curr={currStats.totalCard} prev={prevStats.totalCard} />
            {showCardDetails && (<div style={{ marginTop: '10px', paddingTop: '6px', borderTop: `1px solid ${theme.border}` }}><DropdownRow label="Memon" value={currStats.cardM1} /><DropdownRow label="Khanani" value={currStats.cardM2} /><DropdownRow label="LK Assoc." value={currStats.cardM3} /></div>)}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{ fontSize: '11px', color: theme.muted, fontWeight: '700' }}>Net Delivery</div>
              <button onClick={() => setShowDelDetails(!showDelDetails)} style={{ background: '#f8fafc', border: `1px solid ${theme.border}`, cursor: 'pointer', padding: '2px', borderRadius: '4px' }}>{showDelDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800' }}>£{fmtMoney(currStats.totalDelivery)}</div>
            <TrendIndicator curr={currStats.totalDelivery} prev={prevStats.totalDelivery} />
            {showDelDetails && (<div style={{ marginTop: '10px', paddingTop: '6px', borderTop: `1px solid ${theme.border}` }}><DropdownRow label="Uber Eats" value={currStats.delUber} /><DropdownRow label="Deliveroo" value={currStats.delDeliv} /><DropdownRow label="Just Eat" value={currStats.delJust} /></div>)}
          </div>

          <div style={{ ...cardStyle, background: '#f0f9ff', borderColor: '#bae6fd' }}>
            <div style={{ fontSize: '11px', color: '#0369a1', fontWeight: '700', marginBottom: '4px' }}>Total Sales (Inc. VAT)</div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: '#0284c7' }}>£{fmtMoney(currStats.grandTotal)}</div>
            <TrendIndicator curr={currStats.grandTotal} prev={prevStats.grandTotal} />
          </div>

          <div style={{ ...cardStyle, background: '#f8fafc' }}>
            <div style={{ fontSize: '11px', color: theme.text, fontWeight: '800', marginBottom: '4px' }}>Total Sales (Excl. VAT)</div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: theme.primary }}>£{fmtMoney(currStats.grandTotalExclVat)}</div>
            <TrendIndicator curr={currStats.grandTotalExclVat} prev={prevStats.grandTotalExclVat} />
          </div>
        </div>

        {/* CHARTS ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '12px', marginBottom: '16px', alignItems: 'flex-start', boxSizing: 'border-box' }}>

          <div style={cardStyle}>
            <h3 style={{ fontSize: '12px', fontWeight: '800', margin: '0 0 12px 0', color: theme.text }}>Sales Channels</h3>
            <div style={{ width: '100%', height: '120px', marginBottom: '8px' }}>
              {salesTotal > 0 ? (
                <Chart chartType="PieChart" width="100%" height="100%" data={salesBreakdownData} options={chartOptions3D} />
              ) : (<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.muted, fontSize: '10px' }}>No Data</div>)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px', flexWrap: 'wrap', gap: '4px' }}>
              {salesBreakdownData.slice(1).map((d, i) => (
                <div key={d[0]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: theme.muted, fontWeight: '700' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: COLORS_SALES[i] }}></div> {d[0]}
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: '800', color: theme.text }}>£{fmtMoney(d[1])}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: '12px', fontWeight: '800', margin: '0 0 12px 0', color: theme.text }}>Delivery Platforms</h3>
            <div style={{ width: '100%', height: '120px', marginBottom: '8px' }}>
              {deliveryTotal > 0 ? (
                <Chart chartType="PieChart" width="100%" height="100%" data={deliveryBreakdownData} options={deliveryChartOptions3D} />
              ) : (<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.muted, fontSize: '10px' }}>No Data</div>)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-around', padding: '0 2px', flexWrap: 'wrap', gap: '4px' }}>
              {deliveryBreakdownData.slice(1).slice(0, 3).map((d, i) => (
                <div key={d[0]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: theme.muted, fontWeight: '700' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: COLORS_DEL[i] }}></div> {d[0].substring(0, 6)}
                  </div>
                  <span style={{ fontSize: '10px', fontWeight: '800', color: theme.text }}>£{fmtMoney(d[1])}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ fontSize: '12px', fontWeight: '800', margin: '0 0 12px 0', color: theme.text }}>Revenue Trend</h3>
            <div style={{ width: '100%', height: '150px' }}>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: theme.muted }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: theme.muted }} tickFormatter={(val) => `£${val}`} />
                    <RechartsTooltip cursor={{ fill: '#f8fafc' }} formatter={(value) => `£${fmtMoney(value)}`} contentStyle={{ borderRadius: '6px', border: `1px solid ${theme.border}`, boxShadow: '0 2px 4px rgba(0,0,0,0.05)', fontSize: '10px', padding: '8px' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '9px', paddingTop: '5px' }} />
                    <Bar dataKey="Cash" stackId="a" fill={COLORS_SALES[0]} maxBarSize={20} />
                    <Bar dataKey="Card" stackId="a" fill={COLORS_SALES[1]} maxBarSize={20} />
                    <Bar dataKey="Delivery" stackId="a" fill={COLORS_SALES[2]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.muted, fontSize: '10px' }}>No recent data</div>)}
            </div>
          </div>

        </div>

        {/* SECTION 3: VAT SUMMARY */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', boxSizing: 'border-box' }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Calculator size={14} color={theme.muted} /><h3 style={{ margin: 0, fontSize: '13px', fontWeight: '800', color: theme.text }}>VAT Summary</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div><div style={{ fontSize: '10px', fontWeight: '700', color: '#16a34a', marginBottom: '4px' }}>Collected (Sales)</div><div style={{ fontSize: '16px', fontWeight: '800', color: theme.text }}>£ {fmtMoney(vatStats.salesVat)}</div></div>
              <div><div style={{ fontSize: '10px', fontWeight: '700', color: '#ea580c', marginBottom: '4px' }}>Paid (Purchases)</div><div style={{ fontSize: '16px', fontWeight: '800', color: theme.text }}>£ {fmtMoney(vatStats.purchVat)}</div></div>
              <div><div style={{ fontSize: '10px', fontWeight: '700', color: '#7e22ce', marginBottom: '4px' }}>Deducted (Platforms)</div><div style={{ fontSize: '16px', fontWeight: '800', color: theme.text }}>£ {fmtMoney(vatStats.platVat)}</div></div>
              <div style={{ paddingLeft: '12px', borderLeft: `1px solid ${theme.border}` }}><div style={{ fontSize: '10px', fontWeight: '800', color: vatStats.net > 0 ? '#dc2626' : '#2563eb', marginBottom: '4px', textTransform: 'uppercase' }}>{vatStats.net > 0 ? 'Net Payable' : 'Net Receivable'}</div><div style={{ fontSize: '18px', fontWeight: '900', color: vatStats.net > 0 ? '#dc2626' : '#2563eb' }}>£ {fmtMoney(Math.abs(vatStats.net))}</div></div>
            </div>
          </div>
        </div>

      </div>
      {/* END OF PDF EXPORT TARGET - TABLE IS OUTSIDE THIS DIV */}

      {/* TABLES ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', boxSizing: 'border-box' }}>
        <div style={{ ...cardStyle, padding: '0' }}>
          <div style={{ padding: '12px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', borderRadius: '10px 10px 0 0' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '800', margin: 0, color: theme.text }}>Recent Sales Ledgers</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${theme.border}`, padding: '4px 10px', borderRadius: '4px', background: '#fff' }}>
              <Search size={12} color={theme.muted} />
              <input type="text" placeholder="Search..." value={searchDate} onChange={e => setSearchDate(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '11px', width: '120px' }} />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ fontSize: '10px', color: theme.muted, textTransform: 'uppercase', background: '#fff' }}>
                <tr>
                  <th style={{ padding: '12px 20px', fontWeight: '800' }}>Date</th>
                  <th style={{ padding: '12px 20px', fontWeight: '800' }}>Net Sale</th>
                  <th style={{ padding: '12px 20px', fontWeight: '800' }}>Safe Box</th>
                  <th style={{ padding: '12px 20px', fontWeight: '800' }}>Status</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '800' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedHistory.length === 0 ? (
                  <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: theme.muted, fontSize: '11px' }}>No records found.</td></tr>
                ) : (
                  displayedHistory.map((row, index) => {
                    const dailyNet = (val(row.cashGross) - val(row.cashRefund)) + (val(row.m1Gross) - val(row.m1Refund)) + (val(row.m2Gross) - val(row.m2Refund)) + (val(row.m3Gross) - val(row.m3Refund)) + val(row.uber) + val(row.deliveroo) + val(row.justEat) + val(row.app4) + val(row.otherDel);
                    const cDateRaw = row.safeBoxDate || row.safeBoxColDate;
                    const isPending = val(row.safeBox) > 0 && (!cDateRaw || String(cDateRaw).trim() === '');

                    return (
                      <tr key={index} style={{ borderTop: `1px solid ${theme.border}` }}>
                        <td style={{ padding: '12px 20px', fontWeight: '700', color: theme.text, fontSize: '11px' }}>{formatDateToDDMMYYYY(row.date)}</td>
                        <td style={{ padding: '12px 20px', fontWeight: '800', color: theme.text, fontSize: '11px' }}>£{fmtMoney(dailyNet)}</td>
                        <td style={{ padding: '12px 20px', color: theme.muted, fontSize: '11px', fontWeight: '600' }}>£{fmtMoney(val(row.safeBox))}</td>
                        <td style={{ padding: '12px 20px' }}>
                          {val(row.safeBox) === 0 ? <span style={{ color: theme.muted }}>—</span> :
                            isPending ? <span style={{ color: '#ea580c', background: '#fefce8', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700' }}>Pending</span>
                              : <span style={{ color: '#16a34a', background: '#dcfce7', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700' }}>Collected</span>}
                        </td>
                        <td style={{ padding: '12px 20px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button onClick={() => handleEdit(row.date)} style={{ background: '#f8fafc', color: theme.primary, border: `1px solid ${theme.border}`, padding: '4px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>Edit</button>
                          {onDeleteRecord && (
                            <button onClick={() => onDeleteRecord(row.date)} style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '4px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>Delete</button>
                          )}
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