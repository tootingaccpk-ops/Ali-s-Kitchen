import React, { useState, useMemo } from 'react';
import { Search, Calendar, Landmark, FileSpreadsheet, FileText, ArrowUpRight, ArrowDownRight, Wallet } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getStartOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const normalizeDate = (d) => {
  if (!d) return '';
  let nd = String(d).replace(/\//g, '-');
  const p = nd.split('-');
  if (p.length === 3) {
    if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }
  return nd;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  let nd = normalizeDate(dateStr);
  const parts = nd.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
};

const toDateObj = (dateStr) => {
  if (!dateStr) return new Date(0);
  const nd = normalizeDate(dateStr);
  const p = nd.split('-');
  if (p.length === 3) {
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  }
  return new Date(nd);
};

const fmtMoney = (n) => {
  const num = Number(n) || 0;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getSettlementDate = (dateStr, machineType) => {
  if (!dateStr) return '';
  const nd = normalizeDate(dateStr);
  const parts = nd.split('-');
  if (parts.length !== 3) return nd;
  
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]); 
  const day = dateObj.getDay(); 
  let offset = 1; 
  if (machineType === 'm1') { if (day === 5) offset = 3; else if (day === 6) offset = 2; } 
  else { if (day === 6) offset = 2; }
  
  dateObj.setDate(dateObj.getDate() + offset);
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
};

export default function BankCashBook({ accountsDb = [], receiptsDb = [], salesDb = [] }) {
  const [dateFrom, setDateFrom] = useState(getStartOfMonth());
  const [dateTo, setDateTo] = useState(getToday());
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const bankCashAccounts = useMemo(() => {
    return accountsDb.filter(a => {
      const cat = String(a.category || '').toLowerCase();
      return cat.includes('bank') || cat.includes('cash') || cat.includes('safe') || cat.includes('till');
    });
  }, [accountsDb]);

  const ledgerData = useMemo(() => {
    if (!selectedAccountId) return null;
    const acc = bankCashAccounts.find(a => a.id === selectedAccountId);
    if (!acc) return null;

    let trans = [];
    const isCashLedger = acc.name === 'Safe Box (Main Cash)' || acc.name === 'Cash in Hand' || acc.category === 'Safe Box (Main Cash)';

    receiptsDb.forEach(r => {
      const rDate = normalizeDate(r.date);
      if (r.type === 'Transfer' && String(r.description).includes('Auto-Collected')) return;

      if (r.type !== 'Transfer') {
        if (isCashLedger && r.mode === 'Cash') {
          trans.push({ Date: rDate, Ref: `RP-${r.id.slice(-4)}`, Description: r.description || r.category, Contra: r.account, PaidIn: r.type === 'Receipt' ? Number(r.amount) : 0, PaidOut: r.type === 'Payment' ? Number(r.amount) : 0 });
        } else if (r.mode === 'Bank' && r.bankName === acc.name) {
          trans.push({ Date: rDate, Ref: `RP-${r.id.slice(-4)}`, Description: r.description || r.category, Contra: r.account, PaidIn: r.type === 'Receipt' ? Number(r.amount) : 0, PaidOut: r.type === 'Payment' ? Number(r.amount) : 0 });
        }
      } else {
        const isToCash = r.toBank === 'Safe Box (Main Cash)' || r.toBank === 'Cash in Hand';
        const isFromCash = r.fromBank === 'Safe Box (Main Cash)' || r.fromBank === 'Cash in Hand';

        if (isCashLedger && isToCash) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer In', Contra: r.fromBank, PaidIn: Number(r.amount), PaidOut: 0 });
        if (isCashLedger && isFromCash) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer Out', Contra: r.toBank, PaidIn: 0, PaidOut: Number(r.amount) });
        
        if (!isCashLedger && r.toBank === acc.name) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer In', Contra: r.fromBank, PaidIn: Number(r.amount), PaidOut: 0 });
        if (!isCashLedger && r.fromBank === acc.name) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer Out', Contra: r.toBank, PaidIn: 0, PaidOut: Number(r.amount) });
      }
    });

    salesDb.forEach(s => {
      const sDate = normalizeDate(s.date);
      const rawCDate = s.safeBoxDate || s.safeBoxColDate;
      const cDate = rawCDate ? normalizeDate(rawCDate) : null;
      const safeDrop = Number(s.safeBox) || 0;

      const m1Net = (Number(s.m1Gross) || 0) - (Number(s.m1Refund) || 0);
      const m2Net = (Number(s.m2Gross) || 0) - (Number(s.m2Refund) || 0);
      const m3Net = (Number(s.m3Gross) || 0) - (Number(s.m3Refund) || 0);
      const netCash = (Number(s.cashGross) || 0) - (Number(s.cashRefund) || 0);

      if (acc.name === 'Khanani Management' && m2Net > 0) trans.push({ Date: getSettlementDate(sDate, 'm2'), Ref: 'SETTLE', Description: `Card Sales (M2) from ${formatDate(sDate)}`, Contra: 'Sales', PaidIn: m2Net, PaidOut: 0 });
      if (acc.name === 'Memon Services Ltd' && m1Net > 0) trans.push({ Date: getSettlementDate(sDate, 'm1'), Ref: 'SETTLE', Description: `Card Sales (M1) from ${formatDate(sDate)}`, Contra: 'Sales', PaidIn: m1Net, PaidOut: 0 });
      if (acc.name === 'LK Associates' && m3Net > 0) trans.push({ Date: getSettlementDate(sDate, 'm3'), Ref: 'SETTLE', Description: `Card Sales (M3) from ${formatDate(sDate)}`, Contra: 'Sales', PaidIn: m3Net, PaidOut: 0 });

      if (acc.category === 'Physical Till Float') {
        if (netCash !== 0) trans.push({ Date: sDate, Ref: 'SALES', Description: 'Daily Net Cash Sales', Contra: 'Sales', PaidIn: netCash, PaidOut: 0 });
        if (safeDrop > 0) trans.push({ Date: sDate, Ref: 'DROP', Description: 'Safe Box Cash Drop', Contra: 'Safe Box', PaidIn: 0, PaidOut: safeDrop });
        if (Number(s.collections) > 0) trans.push({ Date: sDate, Ref: 'COLL', Description: 'Till Collection', Contra: 'Cash/Bank', PaidIn: 0, PaidOut: Number(s.collections) });
        
        const expected = (Number(s.openingTill) || 0) + netCash - (Number(s.collections) || 0) - safeDrop;
        const actual = Number(s.physicalTill) || 0;
        const variance = actual - expected;
        if (variance !== 0) trans.push({ Date: sDate, Ref: 'VAR', Description: variance > 0 ? 'Till Overage' : 'Till Shortage', Contra: 'Variance Adj', PaidIn: variance > 0 ? variance : 0, PaidOut: variance < 0 ? Math.abs(variance) : 0 });
      }

      if (isCashLedger && safeDrop > 0 && cDate && cDate.trim() !== '') {
        trans.push({ Date: cDate, Ref: 'COLL', Description: `Collected Safe Drop from ${formatDate(sDate)}`, Contra: 'Physical Till', PaidIn: safeDrop, PaidOut: 0 });
      }
    });

    const targetDateObj = toDateObj(dateFrom);
    const endTargetObj = toDateObj(dateTo);
    
    const priorTrans = trans.filter(t => toDateObj(t.Date) < targetDateObj);
    let openingBalance = Number(acc.balance) || 0;
    priorTrans.forEach(t => { openingBalance += (t.PaidIn || 0) - (t.PaidOut || 0); });

    const filteredTrans = trans.filter(t => {
      const tObj = toDateObj(t.Date);
      return tObj >= targetDateObj && tObj <= endTargetObj;
    }).sort((a, b) => toDateObj(a.Date) - toDateObj(b.Date));
    
    let currentBalance = openingBalance;
    let totalIn = 0;
    let totalOut = 0;

    const rows = filteredTrans.map(t => {
      currentBalance = currentBalance + (t.PaidIn || 0) - (t.PaidOut || 0);
      totalIn += (t.PaidIn || 0);
      totalOut += (t.PaidOut || 0);

      return {
        Date: formatDate(t.Date),
        Ref: t.Ref,
        Description: t.Description,
        Contra: t.Contra,
        PaidIn: t.PaidIn > 0 ? `${fmtMoney(t.PaidIn)}` : '-',
        PaidOut: t.PaidOut > 0 ? `${fmtMoney(t.PaidOut)}` : '-',
        Balance: `${fmtMoney(currentBalance)}`
      };
    });

    return { rows, openingBalance, closingBalance: currentBalance, totalIn, totalOut, accName: acc.name, accCategory: acc.category };

  }, [selectedAccountId, dateFrom, dateTo, receiptsDb, salesDb, bankCashAccounts]);

  const handleExport = (format) => {
    if (!ledgerData || ledgerData.rows.length === 0) return;
    const headers = ['Date', 'Ref', 'Description', 'Contra A/C', 'Paid In (£)', 'Paid Out (£)', 'Balance (£)'];
    const dataRows = [
      [formatDate(dateFrom), 'B/F', 'Opening Balance (Brought Forward)', '-', '-', '-', `£ ${fmtMoney(ledgerData.openingBalance)}`],
      ...ledgerData.rows.map(r => [r.Date, r.Ref, r.Description, r.Contra, r.PaidIn !== '-' ? `£ ${r.PaidIn}` : '-', r.PaidOut !== '-' ? `£ ${r.PaidOut}` : '-', `£ ${r.Balance}`])
    ];

    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }</style></head><body><table>`;
      html += `<tr><td colspan="7" style="font-size: 18px; font-weight: bold; border: none;">Naanstaap - Tooting</td></tr>`;
      html += `<tr><td colspan="7" style="font-size: 14px; font-weight: bold; border: none;">Cash & Bank Book: ${ledgerData.accName}</td></tr>`;
      html += `<tr><td colspan="7" style="font-size: 12px; color: #555; border: none;">Period: ${formatDate(dateFrom)} to ${formatDate(dateTo)}</td></tr><tr><td colspan="7" style="border: none;"></td></tr><tr>`;
      headers.forEach(h => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold;">${h}</th>`; });
      html += `</tr>`;
      dataRows.forEach(row => { html += `<tr>${row.map(val => `<td>${val}</td>`).join('')}</tr>`; });
      html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `CashBook_${ledgerData.accName.replace(/\s+/g, '_')}.xls`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } else {
      const doc = new jsPDF('l', 'pt', 'a4');
      doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text("Naanstaap - Tooting", 40, 40); doc.setFontSize(14); doc.text(`Cash & Bank Book: ${ledgerData.accName}`, 40, 60); doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(`Period: ${formatDate(dateFrom)} to ${formatDate(dateTo)}`, 40, 75);
      autoTable(doc, { startY: 90, head: [headers], body: dataRows, theme: 'grid', headStyles: { fillColor: [15, 23, 42], fontSize: 10, cellPadding: 6 }, styles: { fontSize: 9, cellPadding: 6 }});
      doc.save(`CashBook_${ledgerData.accName.replace(/\s+/g, '_')}.pdf`);
    }
  };

  const theme = { bg: '#ffffff', cardBg: '#ffffff', textMain: '#1e293b', textMuted: '#64748b', primary: '#0ea5e9', border: '#e2e8f0' };

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', fontFamily: '"Inter", sans-serif', color: theme.textMain }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${theme.border}`, paddingBottom: '16px', marginBottom: '20px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.5px' }}>Cash & Bank Ledgers</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: theme.textMuted }}>View complete transaction history and statement balances.</p>
          </div>
          
          {ledgerData && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => handleExport('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#0f172a', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px', transition: 'all 0.2s' }}>
                <FileSpreadsheet size={14} color="#10b981" /> Export Excel
              </button>
              <button onClick={() => handleExport('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#0f172a', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px', transition: 'all 0.2s' }}>
                <FileText size={14} color="#ef4444" /> Export PDF
              </button>
            </div>
          )}
        </div>

        {/* UNIFIED CONTROL BAR (Reduced Padding & Sizes) */}
        <div style={{ display: 'flex', gap: '16px', background: '#f8fafc', padding: '16px 20px', borderRadius: '8px', border: `1px solid ${theme.border}`, marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '220px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select Ledger Account</label>
            <div style={{ position: 'relative' }}>
              <Landmark size={16} color={theme.textMuted} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
              <select 
                value={selectedAccountId} 
                onChange={e => setSelectedAccountId(e.target.value)} 
                style={{ width: '100%', border: `1px solid ${theme.border}`, padding: '8px 12px 8px 34px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', color: theme.textMain, outline: 'none', background: '#fff', cursor: 'pointer', appearance: 'none' }}
              >
                <option value="">-- Select an account --</option>
                {bankCashAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.category})</option>)}
              </select>
            </div>
          </div>

          <div style={{ width: '1px', height: '32px', background: theme.border, alignSelf: 'flex-end', marginBottom: '2px' }}></div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date From</label>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '0 10px' }}>
              <Calendar size={14} color={theme.textMuted} />
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: 'none', outline: 'none', padding: '8px', fontWeight: '600', fontSize: '13px', color: theme.textMain, background: 'transparent' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date To</label>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '0 10px' }}>
              <Calendar size={14} color={theme.textMuted} />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: 'none', outline: 'none', padding: '8px', fontWeight: '600', fontSize: '13px', color: theme.textMain, background: 'transparent' }} />
            </div>
          </div>
        </div>

        {!selectedAccountId ? (
          <div style={{ background: '#f8fafc', borderRadius: '12px', border: `2px dashed ${theme.border}`, padding: '60px 20px', textAlign: 'center', color: theme.textMuted }}>
            <Wallet size={40} color="#cbd5e1" style={{ margin: '0 auto 12px auto', display: 'block' }} />
            <h3 style={{ margin: '0 0 8px 0', color: '#334155', fontSize: '16px', fontWeight: '700' }}>No Account Selected</h3>
            <p style={{ margin: 0, fontSize: '13px' }}>Please choose a bank or cash account from the dropdown above to generate the statement.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* KPI SUMMARY CARDS (Compact Sizing) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              
              <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase' }}>Opening Balance</div>
                  <div style={{ padding: '4px', background: '#f1f5f9', borderRadius: '6px' }}><Wallet size={14} color="#475569" /></div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#1e293b' }}>£ {fmtMoney(ledgerData?.openingBalance)}</div>
              </div>

              <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#059669', textTransform: 'uppercase' }}>Money In</div>
                  <div style={{ padding: '4px', background: '#ecfdf5', borderRadius: '6px' }}><ArrowDownRight size={14} color="#059669" /></div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#059669' }}>£ {fmtMoney(ledgerData?.totalIn)}</div>
              </div>

              <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#dc2626', textTransform: 'uppercase' }}>Money Out</div>
                  <div style={{ padding: '4px', background: '#fef2f2', borderRadius: '6px' }}><ArrowUpRight size={14} color="#dc2626" /></div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#dc2626' }}>£ {fmtMoney(ledgerData?.totalOut)}</div>
              </div>

              <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: theme.primary, textTransform: 'uppercase' }}>Closing Balance</div>
                  <div style={{ padding: '4px', background: '#f0f9ff', borderRadius: '6px' }}><Landmark size={14} color={theme.primary} /></div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: theme.primary }}>£ {fmtMoney(ledgerData?.closingBalance)}</div>
              </div>

            </div>

            {/* TABLE CARD (Responsive Width & Tighter Padding) */}
            <div style={{ background: '#fff', borderRadius: '8px', border: `1px solid ${theme.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                {/* Removed minWidth to prevent unnecessary scrolling on laptops */}
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                    <tr>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date</th>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ref</th>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</th>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contra A/C</th>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Paid In (£)</th>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Paid Out (£)</th>
                      <th style={{ padding: '12px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Balance (£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    
                    {/* BROUGHT FORWARD ROW */}
                    <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                      <td style={{ padding: '12px 14px', fontWeight: '700', fontSize: '12px', color: '#334155' }}>{formatDate(dateFrom)}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ background: '#e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '700', padding: '4px 6px', borderRadius: '4px' }}>B/F</span>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', fontWeight: '600', color: '#334155' }}>Opening Balance</td>
                      <td style={{ padding: '12px 14px' }}>-</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>-</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>-</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', textAlign: 'right', fontWeight: '800', color: '#0f172a' }}>{fmtMoney(ledgerData?.openingBalance)}</td>
                    </tr>

                    {/* TRANSACTIONS */}
                    {ledgerData?.rows.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted, fontSize: '13px' }}>No transactions found for this period.</td></tr>
                    ) : (
                      ledgerData?.rows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}`, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                          <td style={{ padding: '10px 14px', fontWeight: '600', fontSize: '12px', color: theme.textMain }}>{row.Date}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: '11px', fontWeight: '600', padding: '4px 6px', borderRadius: '4px', letterSpacing: '0.5px' }}>{row.Ref}</span>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', color: theme.textMain, lineHeight: '1.4' }}>{row.Description}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ border: `1px solid ${theme.border}`, color: '#475569', fontSize: '11px', fontWeight: '500', padding: '4px 6px', borderRadius: '4px', background: '#fff', whiteSpace: 'nowrap' }}>{row.Contra}</span>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'right', fontWeight: '700', color: '#059669' }}>{row.PaidIn !== '-' ? `${row.PaidIn}` : '-'}</td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'right', fontWeight: '700', color: '#dc2626' }}>{row.PaidOut !== '-' ? `${row.PaidOut}` : '-'}</td>
                          <td style={{ padding: '10px 14px', fontSize: '13px', textAlign: 'right', fontWeight: '700', color: '#0f172a' }}>{row.Balance}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}