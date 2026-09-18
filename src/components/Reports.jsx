import React, { useState, useMemo, useEffect } from 'react';
import { BarChart3, Calendar, Users, Calculator, FileSpreadsheet, BookOpen, FileText, ArrowRightLeft, Truck, ShoppingBag, Landmark, ArrowUpRight, ArrowDownRight, Wallet } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const getToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const getStartOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

const normalizeDate = (d) => {
  if (!d) return ''; let nd = String(d).replace(/\//g, '-'); const p = nd.split('-');
  if (p.length === 3) {
    if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }
  return nd;
};

const formatDate = (dateStr) => {
  if (!dateStr) return ''; const parts = normalizeDate(dateStr).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
};

const toDateObj = (dateStr) => {
  if (!dateStr) return new Date(0); const nd = normalizeDate(dateStr); const p = nd.split('-');
  if (p.length === 3) return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  return new Date(nd);
};

const getMondayBefore = (dateStr) => { const d = new Date(normalizeDate(dateStr)); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); const monday = new Date(d.setDate(diff)); return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`; };
const getSundayAfter = (dateStr) => { const d = new Date(normalizeDate(dateStr)); const day = d.getDay(); const diff = d.getDate() + (day === 0 ? 0 : 7 - day); const sunday = new Date(d.setDate(diff)); return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`; };
const getSettlementDate = (dateStr, machineType) => { const nd = normalizeDate(dateStr); const parts = nd.split('-'); if (parts.length !== 3) return nd; const dateObj = new Date(parts[0], parts[1] - 1, parts[2]); const day = dateObj.getDay(); let offset = 1; if (machineType === 'm1') { if (day === 5) offset = 3; else if (day === 6) offset = 2; } else { if (day === 6) offset = 2; } dateObj.setDate(dateObj.getDate() + offset); return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`; };
const fmtMoney = (n) => { const num = Number(n) || 0; return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

const VarBadge = ({ value, text }) => {
  const v = Number(value);
  if (Math.abs(v) < 0.01 || String(text).includes('EXACT MATCH') || String(text) === '£ 0.00') return <span style={{ fontWeight: '800', color: '#059669', fontSize: '11px' }}>✓ EXACT MATCH</span>;
  if (v > 0 || String(text).includes('+')) return <span style={{ background: '#fde047', color: '#000000', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', display: 'inline-block', minWidth: '70px', textAlign: 'center' }}>{text}</span>;
  return <span style={{ background: '#ef4444', color: '#ffffff', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800', display: 'inline-block', minWidth: '70px', textAlign: 'center' }}>{text}</span>;
};

export default function Reports({ salesDb = [], purchasesDb = [], receiptsDb = [], accountsDb = [], deliveryDb = [], categoriesMap = {}, initialSubTab = 'Sales Summary' }) {
  const [activeReport, setActiveReport] = useState('sales');
  const [salesSubTab, setSalesSubTab] = useState('overall'); 
  const [selectedCardMachine, setSelectedCardMachine] = useState('All'); 
  const [selectedSalesPlatform, setSelectedSalesPlatform] = useState('All'); 
  const [activeVarianceTab, setActiveVarianceTab] = useState('till'); 
  const [selectedPlatform, setSelectedPlatform] = useState('All');
  const [selectedVatPlatform, setSelectedVatPlatform] = useState('All'); 
  const [dateFrom, setDateFrom] = useState(getStartOfMonth());
  const [dateTo, setDateTo] = useState(getToday());
  const [selectedLedgerId, setSelectedLedgerId] = useState('');

  useEffect(() => {
    const reportMap = {
      'Sales Summary': 'sales', 'Profit & Loss': 'pnl', 'General Ledger': 'ledger',
      'Supplier Balances': 'suppliers', 'VAT Summary': 'vat', 'Delivery Settlements': 'delivery', 'Variances': 'variance'
    };
    if (reportMap[initialSubTab]) { setActiveReport(reportMap[initialSubTab]); }
  }, [initialSubTab]);

  const actualDeliveryDb = useMemo(() => { try { return deliveryDb.length > 0 ? deliveryDb : JSON.parse(localStorage.getItem('erp_delivery') || '[]'); } catch (e) { return []; } }, [deliveryDb]);
  const sortedAccountsDb = useMemo(() => { return [...accountsDb].sort((a, b) => (a.name || '').localeCompare(b.name || '')); }, [accountsDb]);
  
  // Get active account name for General Ledger PDF/Excel headers
  const selectedAccountObj = useMemo(() => sortedAccountsDb.find(a => a.id === selectedLedgerId), [sortedAccountsDb, selectedLedgerId]);
  const selectedAccountName = selectedAccountObj ? selectedAccountObj.name : 'All Accounts';

  const deliveryPlatformsList = useMemo(() => { 
    const plats = Array.from(new Set(['Deliveroo', 'Uber Eats', 'Just Eat', 'App4', ...actualDeliveryDb.map(d => d.platform).filter(Boolean)]));
    plats.sort((a, b) => a.localeCompare(b)); return ['All', ...plats]; 
  }, [actualDeliveryDb]);

  const handleExport = (format, reportTitle, headers, dataRows, totalsRow = null, orientation = 'p') => {
    if (!dataRows || dataRows.length === 0) return alert("No data available to export for this date range.");
    const businessName = "Ali's Kitchen"; const period = `Period: ${formatDate(dateFrom)} to ${formatDate(dateTo)}`; const filename = `${reportTitle.replace(/\s+/g, '_')}_${dateFrom}`;
    const isTextCol = (h, i) => ['Date', 'Account', 'Supplier Name', 'Supplier / Ref', 'Source', 'Platform', 'Period', 'Payout Date', 'Notes / Reason', 'Expense Category', 'Ref', 'Description', 'Contra A/C', 'Reasons', 'Notes', 'Supplier'].includes(h) || i === 0;

    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; width: max-content; white-space: nowrap; } th, td { border: 1px solid #cbd5e1; padding: 8px; }</style></head><body><table><tr><td colspan="${headers.length}" style="font-size: 18px; font-weight: bold; border: none; text-align: left;">${businessName}</td></tr><tr><td colspan="${headers.length}" style="font-size: 14px; font-weight: bold; border: none; text-align: left;">${reportTitle}</td></tr><tr><td colspan="${headers.length}" style="font-size: 12px; color: #555; border: none; text-align: left;">${period}</td></tr><tr><td colspan="${headers.length}" style="border: none;"></td></tr><tr>`;
      headers.forEach((h, i) => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold; text-align: ${isTextCol(h, i) ? 'left' : 'right'};">${h}</th>`; }); html += `</tr>`;
      dataRows.forEach(row => { html += `<tr>`; headers.forEach((h, i) => { const val = row[h] !== undefined && row[h] !== null ? row[h] : ''; html += `<td style="text-align: ${isTextCol(h, i) ? 'left' : 'right'};">${val}</td>`; }); html += `</tr>`; });
      if (totalsRow) { html += `<tr>`; headers.forEach((h, i) => { const val = totalsRow[h] !== undefined && totalsRow[h] !== null ? totalsRow[h] : ''; html += `<td style="background-color: #f1f5f9; font-weight: bold; text-align: ${isTextCol(h, i) ? 'left' : 'right'};">${val}</td>`; }); html += `</tr>`; } html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${filename}.xls`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } else if (format === 'pdf') {
      try {
        const doc = new jsPDF(orientation, 'pt', 'a4'); doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text(businessName, orientation === 'l' ? 15 : 40, 40); doc.setFontSize(14); doc.text(reportTitle, orientation === 'l' ? 15 : 40, 60); doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(period, orientation === 'l' ? 15 : 40, 75);
        const tableData = dataRows.map(row => headers.map(h => row[h] !== undefined && row[h] !== null ? row[h] : '')); if (totalsRow) tableData.push(headers.map(h => totalsRow[h] !== undefined && totalsRow[h] !== null ? totalsRow[h] : ''));
        autoTable(doc, { startY: 90, head: [headers], body: tableData, theme: 'grid', margin: { left: orientation === 'l' ? 15 : 40, right: orientation === 'l' ? 15 : 40 }, headStyles: { fillColor: [15, 23, 42], fontSize: orientation === 'l' ? 6.5 : 10, cellPadding: orientation === 'l' ? 3 : 6 }, styles: { fontSize: orientation === 'l' ? 6.5 : 9, cellPadding: orientation === 'l' ? 3 : 6, overflow: 'linebreak' }, didParseCell: (data) => { const header = headers[data.column.index] || ''; const isText = isTextCol(header, data.column.index); data.cell.styles.halign = isText ? 'left' : 'right'; const isFooter = totalsRow && data.row.index === tableData.length - 1; if (isFooter) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [241, 245, 249]; data.cell.styles.textColor = [15, 23, 42]; } } }); doc.save(`${filename}.pdf`);
      } catch (err) { alert("PDF Generation Failed."); }
    }
  };

  const salesSummaryRawData = useMemo(() => {
    return salesDb.filter(s => toDateObj(s.date) >= toDateObj(dateFrom) && toDateObj(s.date) <= toDateObj(dateTo)).sort((a, b) => toDateObj(a.date) - toDateObj(b.date)).map(s => {
        const cashGross = Number(s.cashGross) || 0; const cashRefund = Number(s.cashRefund) || 0; const cashNet = cashGross - cashRefund;
        const m1Gross = Number(s.m1Gross) || 0; const m1Refund = Number(s.m1Refund) || 0; const m1Net = m1Gross - m1Refund;
        const m2Gross = Number(s.m2Gross) || 0; const m2Refund = Number(s.m2Refund) || 0; const m2Net = m2Gross - m2Refund;
        const m3Gross = Number(s.m3Gross) || 0; const m3Refund = Number(s.m3Refund) || 0; const m3Net = m3Gross - m3Refund;
        const totalCardNet = m1Net + m2Net + m3Net;
        const uber = Number(s.uber) || 0; const del = Number(s.deliveroo) || 0; const je = Number(s.justEat) || 0; const app4 = Number(s.app4) || 0; const totalPlatform = uber + del + je + app4;
        const totalNetSales = cashNet + totalCardNet + totalPlatform;
        return { Date: formatDate(s.date), cashGross, cashRefund, cashNet, m1Gross, m1Refund, m1Net, m2Gross, m2Refund, m2Net, m3Gross, m3Refund, m3Net, totalCardNet, uber, del, je, app4, totalPlatform, totalNetSales };
      });
  }, [salesDb, dateFrom, dateTo]);

  const salesSummaryTotals = useMemo(() => {
    return salesSummaryRawData.reduce((acc, row) => ({
      cashGross: acc.cashGross + row.cashGross, cashRefund: acc.cashRefund + row.cashRefund, cashNet: acc.cashNet + row.cashNet, m1Gross: acc.m1Gross + row.m1Gross, m1Refund: acc.m1Refund + row.m1Refund, m1Net: acc.m1Net + row.m1Net, m2Gross: acc.m2Gross + row.m2Gross, m2Refund: acc.m2Refund + row.m2Refund, m2Net: acc.m2Net + row.m2Net, m3Gross: acc.m3Gross + row.m3Gross, m3Refund: acc.m3Refund + row.m3Refund, m3Net: acc.m3Net + row.m3Net, totalCardNet: acc.totalCardNet + row.totalCardNet, uber: acc.uber + row.uber, del: acc.del + row.del, je: acc.je + row.je, app4: acc.app4 + row.app4, totalPlatform: acc.totalPlatform + row.totalPlatform, totalNetSales: acc.totalNetSales + row.totalNetSales
    }), { cashGross: 0, cashRefund: 0, cashNet: 0, m1Gross: 0, m1Refund: 0, m1Net: 0, m2Gross: 0, m2Refund: 0, m2Net: 0, m3Gross: 0, m3Refund: 0, m3Net: 0, totalCardNet: 0, uber: 0, del: 0, je: 0, app4: 0, totalPlatform: 0, totalNetSales: 0 });
  }, [salesSummaryRawData]);

  const handleExportSalesSummary = (format) => {
    let title = ""; let headers = []; let rows = []; let totalsRow = null;
    if (salesSubTab === 'overall') {
      title = "Sales Summary Overall Breakdown"; headers = ['Date', 'Net Cash (£)', 'Net Card (£)', 'Uber Eats (£)', 'Deliveroo (£)', 'Just Eat (£)', 'App4 (£)', 'Total (£)'];
      rows = salesSummaryRawData.map(r => ({ 'Date': r.Date, 'Net Cash (£)': fmtMoney(r.cashNet), 'Net Card (£)': fmtMoney(r.totalCardNet), 'Uber Eats (£)': fmtMoney(r.uber), 'Deliveroo (£)': fmtMoney(r.del), 'Just Eat (£)': fmtMoney(r.je), 'App4 (£)': fmtMoney(r.app4), 'Total (£)': fmtMoney(r.totalNetSales) }));
      totalsRow = { 'Date': 'TOTAL', 'Net Cash (£)': fmtMoney(salesSummaryTotals.cashNet), 'Net Card (£)': fmtMoney(salesSummaryTotals.totalCardNet), 'Uber Eats (£)': fmtMoney(salesSummaryTotals.uber), 'Deliveroo (£)': fmtMoney(salesSummaryTotals.del), 'Just Eat (£)': fmtMoney(salesSummaryTotals.je), 'App4 (£)': fmtMoney(salesSummaryTotals.app4), 'Total (£)': fmtMoney(salesSummaryTotals.totalNetSales) };
    } else if (salesSubTab === 'cash') {
      title = "Cash Sales Breakdown"; headers = ['Date', 'Gross Cash Sales (£)', 'Cash Refunds (£)', 'Net Cash Sales (£)'];
      rows = salesSummaryRawData.map(r => ({ 'Date': r.Date, 'Gross Cash Sales (£)': fmtMoney(r.cashGross), 'Cash Refunds (£)': fmtMoney(r.cashRefund), 'Net Cash Sales (£)': fmtMoney(r.cashNet) }));
      totalsRow = { 'Date': 'TOTAL', 'Gross Cash Sales (£)': fmtMoney(salesSummaryTotals.cashGross), 'Cash Refunds (£)': fmtMoney(salesSummaryTotals.cashRefund), 'Net Cash Sales (£)': fmtMoney(salesSummaryTotals.cashNet) };
    } else if (salesSubTab === 'card') {
      if (selectedCardMachine === 'All') {
        title = "Card Sales Breakdown (All Machines)"; headers = ['Date', 'Memon Services M1 (£)', 'Khanani Mgt M2 (£)', 'LK Associates M3 (£)', 'Total Card Net (£)'];
        rows = salesSummaryRawData.map(r => ({ 'Date': r.Date, 'Memon Services M1 (£)': fmtMoney(r.m1Net), 'Khanani Mgt M2 (£)': fmtMoney(r.m2Net), 'LK Associates M3 (£)': fmtMoney(r.m3Net), 'Total Card Net (£)': fmtMoney(r.totalCardNet) }));
        totalsRow = { 'Date': 'TOTAL', 'Memon Services M1 (£)': fmtMoney(salesSummaryTotals.m1Net), 'Khanani Mgt M2 (£)': fmtMoney(salesSummaryTotals.m2Net), 'LK Associates M3 (£)': fmtMoney(salesSummaryTotals.m3Net), 'Total Card Net (£)': fmtMoney(salesSummaryTotals.totalCardNet) };
      } else {
        const mName = selectedCardMachine === 'm1' ? 'Memon Services Ltd (M1)' : selectedCardMachine === 'm2' ? 'Khanani Management (M2)' : 'LK Associates (M3)';
        title = `Card Sales Breakdown - ${mName}`; headers = ['Date', 'Gross Sales (£)', 'Refunds (£)', 'Net Sales (£)'];
        rows = salesSummaryRawData.map(r => { const g = selectedCardMachine === 'm1' ? r.m1Gross : selectedCardMachine === 'm2' ? r.m2Gross : r.m3Gross; const ref = selectedCardMachine === 'm1' ? r.m1Refund : selectedCardMachine === 'm2' ? r.m2Refund : r.m3Refund; const n = selectedCardMachine === 'm1' ? r.m1Net : selectedCardMachine === 'm2' ? r.m2Net : r.m3Net; return { 'Date': r.Date, 'Gross Sales (£)': fmtMoney(g), 'Refunds (£)': fmtMoney(ref), 'Net Sales (£)': fmtMoney(n) }; });
        const tg = selectedCardMachine === 'm1' ? salesSummaryTotals.m1Gross : selectedCardMachine === 'm2' ? salesSummaryTotals.m2Gross : salesSummaryTotals.m3Gross; const tr = selectedCardMachine === 'm1' ? salesSummaryTotals.m1Refund : selectedCardMachine === 'm2' ? salesSummaryTotals.m2Refund : salesSummaryTotals.m3Refund; const tn = selectedCardMachine === 'm1' ? salesSummaryTotals.m1Net : selectedCardMachine === 'm2' ? salesSummaryTotals.m2Net : salesSummaryTotals.m3Net;
        totalsRow = { 'Date': 'TOTAL', 'Gross Sales (£)': fmtMoney(tg), 'Refunds (£)': fmtMoney(tr), 'Net Sales (£)': fmtMoney(tn) };
      }
    } else if (salesSubTab === 'platform') {
      if (selectedSalesPlatform === 'All') {
        title = "Delivery Platforms Daily Sales (All Platforms)"; headers = ['Date', 'Uber Eats (£)', 'Deliveroo (£)', 'Just Eat (£)', 'App4 (£)', 'Total Platform Sales (£)'];
        rows = salesSummaryRawData.map(r => ({ 'Date': r.Date, 'Uber Eats (£)': fmtMoney(r.uber), 'Deliveroo (£)': fmtMoney(r.del), 'Just Eat (£)': fmtMoney(r.je), 'App4 (£)': fmtMoney(r.app4), 'Total Platform Sales (£)': fmtMoney(r.totalPlatform) }));
        totalsRow = { 'Date': 'TOTAL', 'Uber Eats (£)': fmtMoney(salesSummaryTotals.uber), 'Deliveroo (£)': fmtMoney(salesSummaryTotals.del), 'Just Eat (£)': fmtMoney(salesSummaryTotals.je), 'App4 (£)': fmtMoney(salesSummaryTotals.app4), 'Total Platform Sales (£)': fmtMoney(salesSummaryTotals.totalPlatform) };
      } else {
        title = `Delivery Platform Sales - ${selectedSalesPlatform}`; headers = ['Date', 'Platform', 'Sales Amount (£)'];
        rows = salesSummaryRawData.map(r => { let val = 0; if (selectedSalesPlatform === 'Uber Eats') val = r.uber; if (selectedSalesPlatform === 'Deliveroo') val = r.del; if (selectedSalesPlatform === 'Just Eat') val = r.je; if (selectedSalesPlatform === 'App4') val = r.app4; return { 'Date': r.Date, 'Platform': selectedSalesPlatform, 'Sales Amount (£)': fmtMoney(val) }; });
        let totVal = 0; if (selectedSalesPlatform === 'Uber Eats') totVal = salesSummaryTotals.uber; if (selectedSalesPlatform === 'Deliveroo') totVal = salesSummaryTotals.del; if (selectedSalesPlatform === 'Just Eat') totVal = salesSummaryTotals.je; if (selectedSalesPlatform === 'App4') totVal = salesSummaryTotals.app4;
        totalsRow = { 'Date': 'TOTAL', 'Platform': selectedSalesPlatform, 'Sales Amount (£)': fmtMoney(totVal) };
      }
    }
    handleExport(format, title, headers, rows, totalsRow);
  };

  const ledgerData = useMemo(() => {
    if (!selectedLedgerId) return [];
    const acc = accountsDb.find(a => a.id === selectedLedgerId);
    if (!acc) return [];
    let trans = [];
    
    const accName = (acc.name || '').trim();
    const isCashLedger = accName === 'Safe Box (Main Cash)' || accName === 'Cash in Hand' || acc.category === 'Safe Box (Main Cash)';

    if (accName === 'VAT Output (Sales)') {
        salesDb.forEach(s => {
            const vatVal = Number(s.vatAmount) || Number(s.totalVat) || Number(s.vatCollected) || Number(s.vat) || 0;
            if (vatVal > 0) trans.push({ Date: normalizeDate(s.date), Ref: 'VAT', Description: 'VAT Collected on Sales', Contra: 'Sales', Debit: 0, Credit: vatVal });
        });
    }

    if (accName === 'VAT Input (Purchases)') {
        purchasesDb.forEach(p => {
            const vatVal = Number(p.totalVat) || 0;
            if (vatVal > 0) trans.push({ Date: normalizeDate(p.date), Ref: p.refNo || `INV-${(p.id||'').slice(-4)}`, Description: 'VAT Paid on Purchases', Contra: p.supplier || 'Supplier', Debit: vatVal, Credit: 0 });
        });
    }

    if (accName === 'VAT Input (Delivery Platforms)') {
        actualDeliveryDb.forEach(d => {
            const settleDate = normalizeDate(d.payoutDate || d.dateTo || d.dateFrom || getToday());
            const vatComm = Number(d.vatOnCommission) || 0;
            const vatAdv = Number(d.vatOnAdvertisement) || 0;
            const vatServ = Number(d.vatOnServiceCharges) || 0;
            const totalVat = vatComm + vatAdv + vatServ;
            if (totalVat > 0) trans.push({ Date: settleDate, Ref: 'VAT', Description: `Platform VAT (${d.platform})`, Contra: d.platform, Debit: totalVat, Credit: 0 });
        });
    }

    receiptsDb.forEach(r => {
      const rDate = normalizeDate(r.date);
      if (r.type === 'Transfer' && String(r.description).includes('Auto-Collected')) return;

      if (r.type === 'Journal' || r.type === 'JV') {
        if (r.lines && r.lines.length > 0) {
          r.lines.forEach(line => {
            if ((line.account || '').trim() === accName) {
              const d = Number(line.debit) || 0;
              const c = Number(line.credit) || 0;
              const contraAcc = r.lines.length === 2 ? (r.lines.find(l => (l.account||'').trim() !== accName)?.account || 'Multiple') : 'Multiple';
              if (d > 0) trans.push({ Date: rDate, Ref: `JV-${(r.id||'').slice(-4)}`, Description: line.description || r.description || 'Journal Voucher', Contra: contraAcc, Debit: d, Credit: 0 });
              if (c > 0) trans.push({ Date: rDate, Ref: `JV-${(r.id||'').slice(-4)}`, Description: line.description || r.description || 'Journal Voucher', Contra: contraAcc, Debit: 0, Credit: c });
            }
          });
        } else {
          if ((r.debitAccount || '').trim() === accName) trans.push({ Date: rDate, Ref: `JV-${(r.id||'').slice(-4)}`, Description: r.description || 'Journal Voucher', Contra: r.creditAccount, Debit: Number(r.amount), Credit: 0 });
          if ((r.creditAccount || '').trim() === accName) trans.push({ Date: rDate, Ref: `JV-${(r.id||'').slice(-4)}`, Description: r.description || 'Journal Voucher', Contra: r.debitAccount, Debit: 0, Credit: Number(r.amount) });
        }
        return; 
      }

      if (r.type !== 'Transfer') {
        if (isCashLedger && r.mode === 'Cash') {
          trans.push({ Date: rDate, Ref: `RP-${r.id.slice(-4)}`, Description: r.description || r.category, Contra: r.account, Debit: r.type === 'Receipt' ? Number(r.amount) : 0, Credit: r.type === 'Payment' ? Number(r.amount) : 0 });
        } else if (r.mode === 'Bank' && (r.bankName || '').trim() === accName) {
          trans.push({ Date: rDate, Ref: `RP-${r.id.slice(-4)}`, Description: r.description || r.category, Contra: r.account, Debit: r.type === 'Receipt' ? Number(r.amount) : 0, Credit: r.type === 'Payment' ? Number(r.amount) : 0 });
        }
        if ((r.account || '').trim() === accName) {
          trans.push({ Date: rDate, Ref: `RP-${r.id.slice(-4)}`, Description: r.description || 'Payment/Receipt', Contra: r.mode === 'Bank' ? r.bankName : 'Cash', Debit: r.type === 'Payment' ? Number(r.amount) : 0, Credit: r.type === 'Receipt' ? Number(r.amount) : 0 });
        }
      } else {
        const isToCash = (r.toBank || '').trim() === 'Safe Box (Main Cash)' || (r.toBank || '').trim() === 'Cash in Hand';
        const isFromCash = (r.fromBank || '').trim() === 'Safe Box (Main Cash)' || (r.fromBank || '').trim() === 'Cash in Hand';

        if (isCashLedger && isToCash) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer In', Contra: r.fromBank, Debit: Number(r.amount), Credit: 0 });
        if (isCashLedger && isFromCash) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer Out', Contra: r.toBank, Debit: 0, Credit: Number(r.amount) });
        
        if (!isCashLedger && (r.toBank || '').trim() === accName) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer In', Contra: r.fromBank, Debit: Number(r.amount), Credit: 0 });
        if (!isCashLedger && (r.fromBank || '').trim() === accName) trans.push({ Date: rDate, Ref: `TRF-${r.id.slice(-4)}`, Description: r.description || 'Transfer Out', Contra: r.toBank, Debit: 0, Credit: Number(r.amount) });
      }
    });

    purchasesDb.forEach(p => {
      const pDate = normalizeDate(p.date);
      if ((p.supplier || '').trim() === accName) trans.push({ Date: pDate, Ref: p.refNo || `INV-${(p.id||'').slice(-4)}`, Description: p.description || 'Invoice Received', Contra: 'Multiple Categories', Debit: 0, Credit: Number(p.totalGross) });
      p.lines?.forEach(line => { 
        if ((line.account || '').trim() === accName) {
            trans.push({ Date: pDate, Ref: p.refNo || `INV-${(p.id||'').slice(-4)}`, Description: p.description || 'Expense Line', Contra: p.supplier || 'Supplier', Debit: (Number(line.gross) || 0) - (Number(line.vat) || 0), Credit: 0 }); 
        }
      });
    });

    if (categoriesMap[acc.category] === 'Income') {
      salesDb.forEach(s => {
        const erpTotalGross = (Number(s.cashGross) || 0) + (Number(s.m1Gross) || 0) + (Number(s.m2Gross) || 0) + (Number(s.m3Gross) || 0) + (Number(s.uber) || 0) + (Number(s.deliveroo) || 0) + (Number(s.justEat) || 0) + (Number(s.app4) || 0) + (Number(s.otherDel) || 0);
        const erpTotalRefund = (Number(s.cashRefund) || 0) + (Number(s.m1Refund) || 0) + (Number(s.m2Refund) || 0) + (Number(s.m3Refund) || 0);
        const actualIncome = (erpTotalGross - erpTotalRefund) - (Number(s.vatAmount) || Number(s.totalVat) || Number(s.vatCollected) || Number(s.vat) || 0);
        if (actualIncome !== 0) trans.push({ Date: normalizeDate(s.date), Ref: 'SALES', Description: 'Daily Net Sales (Excl. VAT)', Contra: 'Multiple', Debit: actualIncome < 0 ? Math.abs(actualIncome) : 0, Credit: actualIncome > 0 ? actualIncome : 0 });
      });
      actualDeliveryDb.forEach(d => { if (Number(d.adjustmentPositive) > 0) trans.push({ Date: normalizeDate(d.payoutDate || d.dateTo || d.dateFrom || getToday()), Ref: 'ADJ+', Description: `Platform Adj: ${d.adjustmentPositiveReason || 'Positive Adj'}`, Contra: d.platform, Debit: 0, Credit: Number(d.adjustmentPositive) }); });
    }
    
    salesDb.forEach(s => {
      const sDate = normalizeDate(s.date);
      const rawCDate = s.safeBoxDate || s.safeBoxColDate;
      const cDate = rawCDate ? normalizeDate(rawCDate) : null;
      
      const m1Net = (Number(s.m1Gross) || 0) - (Number(s.m1Refund) || 0); const m2Net = (Number(s.m2Gross) || 0) - (Number(s.m2Refund) || 0); const m3Net = (Number(s.m3Gross) || 0) - (Number(s.m3Refund) || 0);
      if (accName === 'Khanani Management' && m2Net > 0) trans.push({ Date: getSettlementDate(sDate, 'm2'), Ref: 'SETTLEMENT', Description: `Card Sales (M2) from ${formatDate(sDate)}`, Contra: 'Sales', Debit: m2Net, Credit: 0 });
      if (accName === 'Memon Services Ltd' && m1Net > 0) trans.push({ Date: getSettlementDate(sDate, 'm1'), Ref: 'SETTLEMENT', Description: `Card Sales (M1) from ${formatDate(sDate)}`, Contra: 'Sales', Debit: m1Net, Credit: 0 });
      if (accName === 'LK Associates' && m3Net > 0) trans.push({ Date: getSettlementDate(sDate, 'm3'), Ref: 'SETTLEMENT', Description: `Card Sales (M3) from ${formatDate(sDate)}`, Contra: 'Sales', Debit: m3Net, Credit: 0 });
      
      const uName = accName.toLowerCase().replace(/\s+/g, '');
      if (uName.includes('uber')) { if (Number(s.uber) > 0) trans.push({ Date: sDate, Ref: 'SALES', Description: 'Daily Platform Sales', Contra: 'Sales', Debit: Number(s.uber), Credit: 0 }); }
      if (uName.includes('deliveroo')) { if (Number(s.deliveroo) > 0) trans.push({ Date: sDate, Ref: 'SALES', Description: 'Daily Platform Sales', Contra: 'Sales', Debit: Number(s.deliveroo), Credit: 0 }); }
      if (uName.includes('justeat')) { if (Number(s.justEat) > 0) trans.push({ Date: sDate, Ref: 'SALES', Description: 'Daily Platform Sales', Contra: 'Sales', Debit: Number(s.justEat), Credit: 0 }); }
      if (uName.includes('app4')) { if (Number(s.app4) > 0) trans.push({ Date: sDate, Ref: 'SALES', Description: 'Daily Platform Sales', Contra: 'Sales', Debit: Number(s.app4), Credit: 0 }); }

      if (acc.category === 'Physical Till Float') {
        const netCash = (Number(s.cashGross) || 0) - (Number(s.cashRefund) || 0);
        if (netCash !== 0) trans.push({ Date: sDate, Ref: 'SALES', Description: 'Daily Net Cash Sales', Contra: 'Sales', Debit: netCash, Credit: 0 });
        if (Number(s.safeBox) > 0) trans.push({ Date: sDate, Ref: 'DROP', Description: 'Safe Box Cash Drop', Contra: 'Safe Box', Debit: 0, Credit: Number(s.safeBox) });
        if (Number(s.collections) > 0) trans.push({ Date: sDate, Ref: 'COLL', Description: 'Daily Petty Cash Expenses', Contra: 'Daily Petty Cash Expenses', Debit: 0, Credit: Number(s.collections) });
        
        const expected = (Number(s.openingTill) || 0) + netCash - (Number(s.collections) || 0) - (Number(s.safeBox) || 0); const actual = Number(s.physicalTill) || 0; const variance = actual - expected;
        if (variance !== 0) trans.push({ Date: sDate, Ref: 'VAR', Description: variance > 0 ? 'Till Overage' : 'Till Shortage', Contra: 'Variance Adjustment', Debit: variance > 0 ? variance : 0, Credit: variance < 0 ? Math.abs(variance) : 0 });
      }

      if (accName === 'Daily Petty Cash Expenses') {
        if (Number(s.collections) > 0) trans.push({ Date: sDate, Ref: 'PETTY CASH', Description: 'Daily Till Collection (Used for Petty Cash)', Contra: 'Physical Till Drawer', Debit: Number(s.collections), Credit: 0 });
      }
      
      const safeDrop = Number(s.safeBox) || 0;
      if (safeDrop > 0 && cDate && cDate.trim() !== '') {
        if (isCashLedger) trans.push({ Date: cDate, Ref: 'COLL', Description: `Collected Safe Drop from ${formatDate(sDate)}`, Contra: 'Physical Till', Debit: safeDrop, Credit: 0 });
      }
    });

    actualDeliveryDb.forEach(d => {
      if (!d.platform) return;
      if (accName.includes('VAT Input')) return; 
      
      if (d.platform.toLowerCase().replace(/\s+/g, '').includes(accName.toLowerCase().replace(/\s+/g, ''))) {
        const settleDate = normalizeDate(d.payoutDate || d.dateTo || d.dateFrom || getToday());
        if (Number(d.commission) > 0) trans.push({ Date: settleDate, Ref: 'COMM', Description: 'Platform Commission', Contra: 'Expenses', Debit: 0, Credit: Number(d.commission) });
        if (Number(d.advertisement) > 0) trans.push({ Date: settleDate, Ref: 'ADV', Description: 'Advertisement Fees', Contra: 'Expenses', Debit: 0, Credit: Number(d.advertisement) });
        if (Number(d.serviceCharges) > 0) trans.push({ Date: settleDate, Ref: 'SERV', Description: 'Service Charges', Contra: 'Expenses', Debit: 0, Credit: Number(d.serviceCharges) });
        if (Number(d.refunds) > 0) trans.push({ Date: settleDate, Ref: 'REF', Description: 'Customer Refunds', Contra: 'Sales', Debit: 0, Credit: Number(d.refunds) });
        if (Number(d.adjustmentPositive) > 0) trans.push({ Date: settleDate, Ref: 'ADJ+', Description: d.adjustmentPositiveReason || 'Positive Adjustment', Contra: 'Sales / Income', Debit: Number(d.adjustmentPositive), Credit: 0 });
        if (Number(d.adjustmentNegative) > 0) trans.push({ Date: settleDate, Ref: 'ADJ-', Description: d.adjustmentNegativeReason || 'Negative Adjustment', Contra: 'Expense', Debit: 0, Credit: Number(d.adjustmentNegative) });
        if (Number(d.actualPayout) > 0) trans.push({ Date: normalizeDate(d.payoutDate || settleDate), Ref: 'PAYOUT', Description: `Payout to Bank`, Contra: 'Bank', Debit: 0, Credit: Number(d.actualPayout) });
      }
    });

    const targetDateObj = toDateObj(dateFrom);
    let openingBalance = (!String(acc.category).toLowerCase().includes('expense') && !String(acc.category).toLowerCase().includes('income')) ? (Number(acc.balance) || 0) : 0;
    trans.filter(t => toDateObj(t.Date) < targetDateObj).forEach(t => { openingBalance += (t.Debit || 0) - (t.Credit || 0); });
    
    let currentBalance = openingBalance;
    const rows = trans.filter(t => toDateObj(t.Date) >= targetDateObj && toDateObj(t.Date) <= toDateObj(dateTo)).sort((a, b) => toDateObj(a.Date) - toDateObj(b.Date)).map(t => {
      currentBalance = currentBalance + (t.Debit || 0) - (t.Credit || 0);
      return { Date: formatDate(t.Date), Ref: t.Ref, Description: t.Description, Contra: t.Contra, Debit: t.Debit > 0 ? `${fmtMoney(t.Debit)}` : '-', Credit: t.Credit > 0 ? `${fmtMoney(t.Credit)}` : '-', Balance: `${fmtMoney(currentBalance)}` };
    });

    rows.unshift({ Date: formatDate(dateFrom), Ref: 'B/F', Description: 'Opening Balance (Brought Forward)', Contra: '-', Debit: '-', Credit: '-', Balance: `${fmtMoney(openingBalance)}` });
    return rows;
  }, [selectedLedgerId, dateFrom, dateTo, receiptsDb, purchasesDb, accountsDb, salesDb, actualDeliveryDb, categoriesMap]);

  const supplierData = useMemo(() => {
    return sortedAccountsDb.filter(acc => String(acc.category).includes('Payable') || String(acc.category).includes('Supplier')).map(sup => {
      const openingBal = Number(sup.balance) || 0;
      
      const billedPurchases = purchasesDb.filter(p => (p.supplier || '').trim() === (sup.name || '').trim() && toDateObj(p.date) <= toDateObj(dateTo)).reduce((sum, p) => sum + (Number(p.totalGross) || 0), 0);
      const billedJv = receiptsDb.filter(r => (r.type === 'Journal' || r.type === 'JV') && toDateObj(r.date) <= toDateObj(dateTo)).reduce((sum, r) => {
        if (r.lines && r.lines.length > 0) {
          const lineMatch = r.lines.find(l => (l.account || '').trim() === (sup.name || '').trim());
          return sum + (lineMatch ? (Number(lineMatch.credit) || 0) : 0);
        }
        return sum + ((r.creditAccount || '').trim() === (sup.name || '').trim() ? (Number(r.amount) || 0) : 0);
      }, 0);
      const billed = billedPurchases + billedJv;

      const paidReceipts = receiptsDb.filter(r => r.type === 'Payment' && (r.account || '').trim() === (sup.name || '').trim() && toDateObj(r.date) <= toDateObj(dateTo)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const paidJv = receiptsDb.filter(r => (r.type === 'Journal' || r.type === 'JV') && toDateObj(r.date) <= toDateObj(dateTo)).reduce((sum, r) => {
        if (r.lines && r.lines.length > 0) {
          const lineMatch = r.lines.find(l => (l.account || '').trim() === (sup.name || '').trim());
          return sum + (lineMatch ? (Number(lineMatch.debit) || 0) : 0);
        }
        return sum + ((r.debitAccount || '').trim() === (sup.name || '').trim() ? (Number(r.amount) || 0) : 0);
      }, 0);
      const paid = paidReceipts + paidJv;

      return { Supplier: sup.name, Opening: `${fmtMoney(openingBal)}`, Billed: `${fmtMoney(billed)}`, Paid: `${fmtMoney(paid)}`, Balance: `${fmtMoney(openingBal + billed - paid)}`, _bal: openingBal + billed - paid, _billed: billed, _paid: paid, _open: openingBal };
    }).filter(s => Math.abs(s._bal) > 0.009); // Hide completely settled zero-balance accounts
  }, [sortedAccountsDb, purchasesDb, receiptsDb, dateTo]);

  const vatData = useMemo(() => {
    return purchasesDb.filter(p => toDateObj(p.date) >= toDateObj(dateFrom) && toDateObj(p.date) <= toDateObj(dateTo) && Number(p.totalVat) > 0).sort((a, b) => toDateObj(a.date) - toDateObj(b.date)).map(p => ({ Date: formatDate(p.date), Supplier: p.supplier || 'Unassigned', Ref: p.refNo || '-', Gross: `${fmtMoney(p.totalGross)}`, Net: `${fmtMoney(p.totalNet)}`, VAT: `${fmtMoney(p.totalVat)}`, _vatVal: Number(p.totalVat) || 0 }));
  }, [purchasesDb, dateFrom, dateTo]);

  const vatSalesData = useMemo(() => {
    return salesDb.filter(s => toDateObj(s.date) >= toDateObj(dateFrom) && toDateObj(s.date) <= toDateObj(dateTo)).sort((a, b) => toDateObj(a.date) - toDateObj(b.date)).map(s => {
      const erpTotalGross = (Number(s.cashGross) || 0) + (Number(s.m1Gross) || 0) + (Number(s.m2Gross) || 0) + (Number(s.m3Gross) || 0) + (Number(s.uber) || 0) + (Number(s.deliveroo) || 0) + (Number(s.justEat) || 0) + (Number(s.app4) || 0) + (Number(s.otherDel) || 0);
      const erpTotalRefund = (Number(s.cashRefund) || 0) + (Number(s.m1Refund) || 0) + (Number(s.m2Refund) || 0) + (Number(s.m3Refund) || 0);
      const netSales = erpTotalGross - erpTotalRefund;
      const vatVal = Number(s.vatAmount) || Number(s.totalVat) || Number(s.vatCollected) || Number(s.vat) || 0; 
      if (vatVal === 0 && netSales === 0) return null;
      return { Date: formatDate(s.date), Source: 'Daily Sales', Gross: `${fmtMoney(netSales)}`, Net: `${fmtMoney(netSales - vatVal)}`, VAT: `${fmtMoney(vatVal)}`, _vatVal: vatVal };
    }).filter(Boolean);
  }, [salesDb, dateFrom, dateTo]);

  const tillVarianceData = useMemo(() => {
    return salesDb.filter(s => toDateObj(s.date) >= toDateObj(dateFrom) && toDateObj(s.date) <= toDateObj(dateTo)).sort((a, b) => toDateObj(a.date) - toDateObj(b.date)).map(s => {
      const netCash = (Number(s.cashGross) || 0) - (Number(s.cashRefund) || 0);
      const expected = (Number(s.openingTill) || 0) + netCash - (Number(s.collections) || 0) - (Number(s.safeBox) || 0);
      const actual = Number(s.physicalTill) || 0; const variance = actual - expected;
      return { Date: formatDate(s.date), Expected: `${fmtMoney(expected)}`, Actual: `${fmtMoney(actual)}`, Variance: `${variance > 0 ? '+ ' : variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(variance))}`, Reason: s.tillVarReason || s.notes || '-', _varVal: variance };
    });
  }, [salesDb, dateFrom, dateTo]);

  const cardVarianceData = useMemo(() => {
    return salesDb.filter(s => toDateObj(s.date) >= toDateObj(dateFrom) && toDateObj(s.date) <= toDateObj(dateTo)).sort((a, b) => toDateObj(a.date) - toDateObj(b.date)).map(s => {
      const erpCardNet = ((Number(s.m1Gross) || 0) - (Number(s.m1Refund) || 0)) + ((Number(s.m2Gross) || 0) - (Number(s.m2Refund) || 0)) + ((Number(s.m3Gross) || 0) - (Number(s.m3Refund) || 0));
      const tillCardNet = (Number(s.tillCardGross) || erpCardNet) - (Number(s.tillCardRefund) || 0);
      const variance = erpCardNet - tillCardNet;
      return { Date: formatDate(s.date), AsPerERP: `${fmtMoney(erpCardNet)}`, AsPerTill: `${fmtMoney(tillCardNet)}`, Variance: `${variance > 0 ? '+ ' : variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(variance))}`, Notes: s.cardVarReason || s.notes || '-', _varVal: variance };
    });
  }, [salesDb, dateFrom, dateTo]);

  const salesVarianceData = useMemo(() => {
    return salesDb.filter(s => toDateObj(s.date) >= toDateObj(dateFrom) && toDateObj(s.date) <= toDateObj(dateTo)).sort((a, b) => toDateObj(a.date) - toDateObj(b.date)).map(s => {
      const erpTotalGross = (Number(s.cashGross) || 0) + (Number(s.m1Gross) || 0) + (Number(s.m2Gross) || 0) + (Number(s.m3Gross) || 0) + (Number(s.uber) || 0) + (Number(s.deliveroo) || 0) + (Number(s.justEat) || 0) + (Number(s.app4) || 0) + (Number(s.otherDel) || 0);
      const erpTotalRefund = (Number(s.cashRefund) || 0) + (Number(s.m1Refund) || 0) + (Number(s.m2Refund) || 0) + (Number(s.m3Refund) || 0);
      const erpTotalNet = erpTotalGross - erpTotalRefund;
      const tillTotalNet = (Number(s.tillSalesGross) || 0) - (Number(s.tillSalesRefund) || 0);
      const variance = tillTotalNet > 0 ? (erpTotalNet - tillTotalNet) : 0;
      return { Date: formatDate(s.date), AsPerERP: `${fmtMoney(erpTotalNet)}`, AsPerTill: `${fmtMoney(tillTotalNet)}`, Variance: `${variance > 0 ? '+ ' : variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(variance))}`, Notes: s.salesVarReason || s.varianceReason || s.notes || '-', _varVal: variance };
    });
  }, [salesDb, dateFrom, dateTo]);

  const baseDeliveryWeeklyData = useMemo(() => {
    const startMon = getMondayBefore(dateFrom); const endSun = getSundayAfter(dateTo);
    const filteredRecords = actualDeliveryDb.filter(d => { const sDate = normalizeDate(d.dateFrom || d.startDate || d.date); return !sDate || (toDateObj(sDate) >= toDateObj(startMon) && toDateObj(sDate) <= toDateObj(endSun)); });
    let weeks = [], currStart = new Date(toDateObj(startMon)), finalEnd = new Date(toDateObj(endSun));
    while (currStart <= finalEnd) {
      let wStart = new Date(currStart), wEnd = new Date(currStart); wEnd.setDate(wEnd.getDate() + 6);
      weeks.push({ start: `${wStart.getFullYear()}-${String(wStart.getMonth() + 1).padStart(2, '0')}-${String(wStart.getDate()).padStart(2, '0')}`, end: `${wEnd.getFullYear()}-${String(wEnd.getMonth() + 1).padStart(2, '0')}-${String(wEnd.getDate()).padStart(2, '0')}`, label: `${formatDate(`${wStart.getFullYear()}-${String(wStart.getMonth() + 1).padStart(2, '0')}-${String(wStart.getDate()).padStart(2, '0')}`)} - ${formatDate(`${wEnd.getFullYear()}-${String(wEnd.getMonth() + 1).padStart(2, '0')}-${String(wEnd.getDate()).padStart(2, '0')}`)}` });
      currStart.setDate(currStart.getDate() + 7);
    }
    let reportRows = [];
    weeks.forEach(week => {
      const matchedWeekRecords = filteredRecords.filter(d => { const dDate = normalizeDate(d.dateFrom || d.startDate || d.date || getToday()); return toDateObj(dDate) >= toDateObj(week.start) && toDateObj(dDate) <= toDateObj(week.end); });
      if (matchedWeekRecords.length === 0) return;
      Array.from(new Set(matchedWeekRecords.map(r => r.platform || 'Unknown'))).forEach(plat => {
        let gross = 0, platGross = 0, comm = 0, vatComm = 0, adv = 0, vatAdv = 0, serv = 0, ref = 0, adjPos = 0, adjNeg = 0, exp = 0, act = 0, posReasons = [], negReasons = [], varReasons = [], payoutDates = new Set();
        matchedWeekRecords.filter(r => (r.platform || 'Unknown') === plat).forEach(d => {
          gross += Number(d.grossSales) || 0; platGross += Number(d.platformGross) || 0; comm += Number(d.commission) || 0; vatComm += Number(d.vatOnCommission) || 0; adv += Number(d.advertisement || d.adsPromo) || 0; vatAdv += Number(d.vatOnAdvertisement) || 0; serv += Number(d.serviceCharges) || 0; ref += Number(d.refunds) || 0;
          const ap = Number(d.adjustmentPositive) || 0; if (ap > 0) { adjPos += ap; if (d.adjustmentPositiveReason) posReasons.push(d.adjustmentPositiveReason); }
          const an = Number(d.adjustmentNegative) || 0; if (an > 0) { adjNeg += an; if (d.adjustmentNegativeReason) negReasons.push(d.adjustmentNegativeReason); }
          exp += Number(d.expectedPayout) || 0; act += Number(d.actualPayout) || 0;
          if (d.payoutDate) payoutDates.add(formatDate(d.payoutDate));
          if (d.varianceReason && d.varianceReason !== 'Exact Match') varReasons.push(d.varianceReason);
        });
        const variance = act - exp;
        reportRows.push({ Period: week.label, Platform: plat, GrossSales: `${fmtMoney(gross)}`, PlatformGross: `${fmtMoney(platGross)}`, Commission: `${fmtMoney(comm)}`, VatOnCommission: `${fmtMoney(vatComm)}`, Advertisement: `${fmtMoney(adv)}`, VatOnAdvertisement: `${fmtMoney(vatAdv)}`, ServiceCharges: `${fmtMoney(serv)}`, Refunds: `${fmtMoney(ref)}`, AdjustmentPos: `${fmtMoney(adjPos)}`, _posReason: posReasons.join(', ') || '-', AdjustmentNeg: `${fmtMoney(adjNeg)}`, _negReason: negReasons.join(', ') || '-', ExpectedPayout: `${fmtMoney(exp)}`, ActualPayout: act > 0 ? `${fmtMoney(act)}` : '-', PayoutDate: Array.from(payoutDates).join(', ') || '-', VarianceVal: variance, Variance: `${variance > 0 ? '+ ' : variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(variance))}`, VarianceReasons: varReasons.join(', ') || '-' });
      });
    });
    return reportRows.filter(w => w.GrossSales !== '0.00' || w.ActualPayout !== '-');
  }, [actualDeliveryDb, dateFrom, dateTo]);

  const deliveryWeeklyData = useMemo(() => { if (selectedPlatform === 'All') return baseDeliveryWeeklyData; const filterPlat = selectedPlatform.toLowerCase().replace(/\s+/g, ''); return baseDeliveryWeeklyData.filter(d => { const recordPlat = String(d.Platform || '').toLowerCase().replace(/\s+/g, ''); return recordPlat === filterPlat || recordPlat.includes(filterPlat) || filterPlat.includes(recordPlat); }); }, [baseDeliveryWeeklyData, selectedPlatform]);
  
  const vatDeliveryData = useMemo(() => {
    return baseDeliveryWeeklyData.map(d => {
      const vatComm = parseFloat(String(d.VatOnCommission).replace(/[^0-9.-]/g, '')) || 0; const vatAdv = parseFloat(String(d.VatOnAdvertisement).replace(/[^0-9.-]/g, '')) || 0; const totalPlatformVat = vatComm + vatAdv;
      if (totalPlatformVat === 0) return null;
      return { Date: d.PayoutDate, Platform: d.Platform, Period: d.Period, GrossSales: d.GrossSales, NetPayout: d.ActualPayout !== '-' ? d.ActualPayout : d.ExpectedPayout, VAT_Total: fmtMoney(totalPlatformVat), _vatVal: totalPlatformVat };
    }).filter(Boolean);
  }, [baseDeliveryWeeklyData]);

  const deliveryTotals = useMemo(() => {
    return deliveryWeeklyData.reduce((acc, row) => ({
      GrossSales: acc.GrossSales + (parseFloat(String(row.GrossSales).replace(/[^0-9.-]/g, '')) || 0), PlatformGross: acc.PlatformGross + (parseFloat(String(row.PlatformGross).replace(/[^0-9.-]/g, '')) || 0), Commission: acc.Commission + (parseFloat(String(row.Commission).replace(/[^0-9.-]/g, '')) || 0), VatOnCommission: acc.VatOnCommission + (parseFloat(String(row.VatOnCommission).replace(/[^0-9.-]/g, '')) || 0), Advertisement: acc.Advertisement + (parseFloat(String(row.Advertisement).replace(/[^0-9.-]/g, '')) || 0), VatOnAdvertisement: acc.VatOnAdvertisement + (parseFloat(String(row.VatOnAdvertisement).replace(/[^0-9.-]/g, '')) || 0), ServiceCharges: acc.ServiceCharges + (parseFloat(String(row.ServiceCharges).replace(/[^0-9.-]/g, '')) || 0), Refunds: acc.Refunds + (parseFloat(String(row.Refunds).replace(/[^0-9.-]/g, '')) || 0), AdjustmentPos: acc.AdjustmentPos + (parseFloat(String(row.AdjustmentPos).replace(/[^0-9.-]/g, '')) || 0), AdjustmentNeg: acc.AdjustmentNeg + (parseFloat(String(row.AdjustmentNeg).replace(/[^0-9.-]/g, '')) || 0), ExpectedPayout: acc.ExpectedPayout + (parseFloat(String(row.ExpectedPayout).replace(/[^0-9.-]/g, '')) || 0), ActualPayout: acc.ActualPayout + (row.ActualPayout !== '-' ? (parseFloat(String(row.ActualPayout).replace(/[^0-9.-]/g, '')) || 0) : 0), Variance: acc.Variance + Number(row.VarianceVal || 0)
    }), { GrossSales: 0, PlatformGross: 0, Commission: 0, VatOnCommission: 0, Advertisement: 0, VatOnAdvertisement: 0, ServiceCharges: 0, Refunds: 0, AdjustmentPos: 0, AdjustmentNeg: 0, ExpectedPayout: 0, ActualPayout: 0, Variance: 0 });
  }, [deliveryWeeklyData]);

  const deliveryPayoutVarianceData = useMemo(() => {
    return deliveryWeeklyData.map(d => {
      const erpGross = parseFloat(String(d.GrossSales).replace(/[^0-9.-]/g, '')) || 0; const platGross = parseFloat(String(d.PlatformGross).replace(/[^0-9.-]/g, '')) || 0;
      let expectedComm = 0, expectedVat = 0;
      if (d.Platform === 'Uber Eats') { expectedComm = erpGross * 0.26; expectedVat = expectedComm * 0.20; } else if (d.Platform === 'Deliveroo') { expectedComm = erpGross * 0.25; expectedVat = expectedComm * 0.20; } else if (d.Platform === 'Just Eat') { expectedComm = erpGross * 0.30; expectedVat = expectedComm * 0.20; } else if (d.Platform === 'App4') { expectedComm = erpGross * 0.04; expectedVat = expectedComm * 0.20; }
      const autoCommVat = expectedComm + expectedVat;
      const fixedDeductions = (parseFloat(String(d.Advertisement).replace(/[^0-9.-]/g, '')) || 0) + (parseFloat(String(d.VatOnAdvertisement).replace(/[^0-9.-]/g, '')) || 0) + (d.Platform === 'Just Eat' ? 0 : (parseFloat(String(d.ServiceCharges).replace(/[^0-9.-]/g, '')) || 0)) + (parseFloat(String(d.Refunds).replace(/[^0-9.-]/g, '')) || 0) + (parseFloat(String(d.AdjustmentNeg).replace(/[^0-9.-]/g, '')) || 0) - (parseFloat(String(d.AdjustmentPos).replace(/[^0-9.-]/g, '')) || 0);
      const expectedPayout = erpGross - autoCommVat - fixedDeductions; const actualPayout = d.ActualPayout !== '-' ? parseFloat(String(d.ActualPayout).replace(/[^0-9.-]/g, '')) : 0; const variance = actualPayout - expectedPayout; const grossVariance = platGross - erpGross;
      return { Period: d.Period, Platform: d.Platform, ERPGross: `£ ${fmtMoney(erpGross)}`, PlatGross: `£ ${fmtMoney(platGross)}`, GrossVarianceVal: grossVariance, GrossVariance: `${grossVariance > 0 ? '+ ' : grossVariance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(grossVariance))}`, AutoCommVat: `£ ${fmtMoney(autoCommVat)}`, FixedDed: `£ ${fmtMoney(fixedDeductions)}`, Expected: `£ ${fmtMoney(expectedPayout)}`, Actual: `£ ${fmtMoney(actualPayout)}`, VarianceVal: variance, Variance: `${variance > 0 ? '+ ' : variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(variance))}` };
    });
  }, [deliveryWeeklyData]);

  const dpvTotals = useMemo(() => { return deliveryPayoutVarianceData.reduce((acc, r) => { acc.ERPGross += parseFloat(r.ERPGross.replace(/[^0-9.-]+/g, '')) || 0; acc.PlatGross += parseFloat(r.PlatGross.replace(/[^0-9.-]+/g, '')) || 0; acc.GrossVariance += r.GrossVarianceVal || 0; acc.AutoCommVat += parseFloat(r.AutoCommVat.replace(/[^0-9.-]+/g, '')) || 0; acc.FixedDed += parseFloat(r.FixedDed.replace(/[^0-9.-]+/g, '')) || 0; acc.Expected += parseFloat(r.Expected.replace(/[^0-9.-]+/g, '')) || 0; acc.Actual += parseFloat(r.Actual.replace(/[^0-9.-]+/g, '')) || 0; acc.Variance += r.VarianceVal || 0; return acc; }, { ERPGross: 0, PlatGross: 0, GrossVariance: 0, AutoCommVat: 0, FixedDed: 0, Expected: 0, Actual: 0, Variance: 0 }); }, [deliveryPayoutVarianceData]);
  const deliveryExportTotals = { 'Period': 'TOTAL', 'Platform': '', 'ERP Gross (£)': fmtMoney(deliveryTotals.GrossSales), 'Comm. (£)': fmtMoney(deliveryTotals.Commission), 'VAT on Comm. (£)': fmtMoney(deliveryTotals.VatOnCommission), 'Adv. (£)': fmtMoney(deliveryTotals.Advertisement), 'VAT on Adv. (£)': fmtMoney(deliveryTotals.VatOnAdvertisement), 'Serv. Chg. (£)': fmtMoney(deliveryTotals.ServiceCharges), 'Refunds (£)': fmtMoney(deliveryTotals.Refunds), 'Adj (+) (£)': fmtMoney(deliveryTotals.AdjustmentPos), 'Adj (-) (£)': fmtMoney(deliveryTotals.AdjustmentNeg), 'Expected (£)': fmtMoney(deliveryTotals.ExpectedPayout), 'Actual (£)': fmtMoney(deliveryTotals.ActualPayout), 'Payout Date': '', 'Variance (£)': fmtMoney(deliveryTotals.Variance), 'Variance Reasons': '' };
  
  const totalSalesVat = vatSalesData.reduce((sum, row) => sum + row._vatVal, 0); 
  const totalPurchasesVat = vatData.reduce((sum, row) => sum + row._vatVal, 0); 
  const filteredVatDeliveryData = selectedVatPlatform === 'All' ? vatDeliveryData : vatDeliveryData.filter(row => row.Platform === selectedVatPlatform); 
  const filteredPlatformVat = filteredVatDeliveryData.reduce((sum, row) => sum + row._vatVal, 0); 
  const totalPlatformVatAll = vatDeliveryData.reduce((sum, row) => sum + row._vatVal, 0); 
  const netVat = totalSalesVat - totalPurchasesVat - totalPlatformVatAll; 

  // Export handlers for VAT Summary
  const handleExportVatSummary = (format) => {
    const title = "VAT Summary Report";
    const headers = ['Category', 'Description / Details', 'Amount (£)'];
    const rows = [
      { 'Category': 'VAT Collected', 'Description / Details': 'Total VAT Collected on Sales', 'Amount (£)': fmtMoney(totalSalesVat) },
      { 'Category': 'VAT Paid', 'Description / Details': 'Total VAT Paid on Purchases & Expenses', 'Amount (£)': fmtMoney(totalPurchasesVat) },
      { 'Category': 'VAT Deducted', 'Description / Details': `Total VAT Deducted by Delivery Platforms (${selectedVatPlatform})`, 'Amount (£)': fmtMoney(filteredPlatformVat) },
      { 'Category': 'Net VAT', 'Description / Details': netVat > 0 ? 'Net VAT Payable' : 'Net VAT Receivable', 'Amount (£)': fmtMoney(Math.abs(netVat)) }
    ];
    handleExport(format, title, headers, rows);
  };

  const theme = { bg: '#ffffff', cardBg: '#ffffff', textMain: '#1e293b', textMuted: '#64748b', primary: '#0ea5e9', border: '#e2e8f0' };

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', fontFamily: '"Inter", sans-serif', color: theme.textMain, width: '100%', boxSizing: 'border-box' }}>
      
      {/* Print styles injected to hide sidebars/buttons during print/save PDF */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-vat-area, #printable-vat-area * { visibility: visible; }
          #printable-vat-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div style={{ padding: '24px', overflowX: 'hidden', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '16px', background: '#fff', padding: '16px 24px', borderRadius: '12px', border: `1px solid ${theme.border}`, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
            <Calendar size={24} color={theme.textMuted} style={{ alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><label style={{ fontSize: '11px', fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase' }}>From Date</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: 'none', outline: 'none', fontWeight: '700', fontSize: '14px', color: theme.textMain }} /></div>
            <div style={{ width: '1px', background: theme.border, margin: '0 8px' }}></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><label style={{ fontSize: '11px', fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase' }}>To Date</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: 'none', outline: 'none', fontWeight: '700', fontSize: '14px', color: theme.textMain }} /></div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {activeReport === 'sales' && (
              <>
                <button onClick={() => handleExportSalesSummary('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExportSalesSummary('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'ledger' && selectedLedgerId && (
              <>
                <button onClick={() => handleExport('excel', `General Ledger - ${selectedAccountName}`, ['Date', 'Ref', 'Description', 'Contra', 'Debit', 'Credit', 'Balance'], ledgerData)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', `General Ledger - ${selectedAccountName}`, ['Date', 'Ref', 'Description', 'Contra', 'Debit', 'Credit', 'Balance'], ledgerData)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'suppliers' && (
              <>
                <button onClick={() => handleExport('excel', 'Supplier Balances', ['Supplier', 'Opening', 'Billed', 'Paid', 'Balance'], supplierData)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', 'Supplier Balances', ['Supplier', 'Opening', 'Billed', 'Paid', 'Balance'], supplierData)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'vat' && (
              <>
                <button onClick={() => handleExportVatSummary('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExportVatSummary('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
                <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> Print</button>
              </>
            )}
            {activeReport === 'delivery' && (
              <>
                <button onClick={() => handleExport('excel', `Delivery Settlements: ${selectedPlatform}`, ['Period', 'Platform', 'ERP Gross (£)', 'Comm. (£)', 'VAT on Comm. (£)', 'Adv. (£)', 'VAT on Adv. (£)', 'Serv. Chg. (£)', 'Refunds (£)', 'Adj (+) (£)', 'Adj (-) (£)', 'Expected (£)', 'Actual (£)', 'Payout Date', 'Variance (£)', 'Variance Reasons'], deliveryWeeklyData.map(d => ({'Period': d.Period, 'Platform': d.Platform, 'ERP Gross (£)': d.GrossSales, 'Comm. (£)': d.Commission, 'VAT on Comm. (£)': d.VatOnCommission, 'Adv. (£)': d.Advertisement, 'VAT on Adv. (£)': d.VatOnAdvertisement, 'Serv. Chg. (£)': d.ServiceCharges, 'Refunds (£)': d.Refunds, 'Adj (+) (£)': d.AdjustmentPos, 'Adj (-) (£)': d.AdjustmentNeg, 'Expected (£)': d.ExpectedPayout, 'Actual (£)': d.ActualPayout, 'Payout Date': d.PayoutDate, 'Variance (£)': d.Variance, 'Variance Reasons': d.VarianceReasons })), deliveryExportTotals)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', `Delivery Settlements: ${selectedPlatform}`, ['Period', 'Platform', 'ERP Gross (£)', 'Comm. (£)', 'VAT on Comm. (£)', 'Adv. (£)', 'VAT on Adv. (£)', 'Serv. Chg. (£)', 'Refunds (£)', 'Adj (+) (£)', 'Adj (-) (£)', 'Expected (£)', 'Actual (£)', 'Payout Date', 'Variance (£)', 'Variance Reasons'], deliveryWeeklyData.map(d => ({'Period': d.Period, 'Platform': d.Platform, 'ERP Gross (£)': d.GrossSales, 'Comm. (£)': d.Commission, 'VAT on Comm. (£)': d.VatOnCommission, 'Adv. (£)': d.Advertisement, 'VAT on Adv. (£)': d.VatOnAdvertisement, 'Serv. Chg. (£)': d.ServiceCharges, 'Refunds (£)': d.Refunds, 'Adj (+) (£)': d.AdjustmentPos, 'Adj (-) (£)': d.AdjustmentNeg, 'Expected (£)': d.ExpectedPayout, 'Actual (£)': d.ActualPayout, 'Payout Date': d.PayoutDate, 'Variance (£)': d.Variance, 'Variance Reasons': d.VarianceReasons })), deliveryExportTotals, 'l')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'variance' && activeVarianceTab === 'till' && (
              <>
                <button onClick={() => handleExport('excel', 'Till Variances', ['Date', 'Expected', 'Actual', 'Variance', 'Reason'], tillVarianceData, { Date: 'TOTAL', Expected: fmtMoney(tillVarianceData.reduce((s, r) => s + parseFloat(r.Expected.replace(/[^0-9.-]/g, '')), 0)), Actual: fmtMoney(tillVarianceData.reduce((s, r) => s + parseFloat(r.Actual.replace(/[^0-9.-]/g, '')), 0)), Variance: `${tillVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(tillVarianceData.reduce((s, r) => s + r._varVal, 0)))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', 'Till Variances', ['Date', 'Expected', 'Actual', 'Variance', 'Reason'], tillVarianceData, { Date: 'TOTAL', Expected: fmtMoney(tillVarianceData.reduce((s, r) => s + parseFloat(r.Expected.replace(/[^0-9.-]/g, '')), 0)), Actual: fmtMoney(tillVarianceData.reduce((s, r) => s + parseFloat(r.Actual.replace(/[^0-9.-]/g, '')), 0)), Variance: `${tillVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(tillVarianceData.reduce((s, r) => s + r._varVal, 0)))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'variance' && activeVarianceTab === 'card' && (
              <>
                <button onClick={() => handleExport('excel', 'Card Variances', ['Date', 'AsPerERP', 'AsPerTill', 'Variance', 'Notes'], cardVarianceData, { Date: 'TOTAL', AsPerERP: fmtMoney(cardVarianceData.reduce((s, r) => s + parseFloat(r.AsPerERP.replace(/[^0-9.-]/g, '')), 0)), AsPerTill: fmtMoney(cardVarianceData.reduce((s, r) => s + parseFloat(r.AsPerTill.replace(/[^0-9.-]/g, '')), 0)), Variance: `${cardVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(cardVarianceData.reduce((s, r) => s + r._varVal, 0)))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', 'Card Variances', ['Date', 'AsPerERP', 'AsPerTill', 'Variance', 'Notes'], cardVarianceData, { Date: 'TOTAL', AsPerERP: fmtMoney(cardVarianceData.reduce((s, r) => s + parseFloat(r.AsPerERP.replace(/[^0-9.-]/g, '')), 0)), AsPerTill: fmtMoney(cardVarianceData.reduce((s, r) => s + parseFloat(r.AsPerTill.replace(/[^0-9.-]/g, '')), 0)), Variance: `${cardVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(cardVarianceData.reduce((s, r) => s + r._varVal, 0)))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'variance' && activeVarianceTab === 'sales' && (
              <>
                <button onClick={() => handleExport('excel', 'Sales Variances', ['Date', 'AsPerERP', 'AsPerTill', 'Variance', 'Notes'], salesVarianceData, { Date: 'TOTAL', AsPerERP: fmtMoney(salesVarianceData.reduce((s, r) => s + parseFloat(r.AsPerERP.replace(/[^0-9.-]/g, '')), 0)), AsPerTill: fmtMoney(salesVarianceData.reduce((s, r) => s + parseFloat(r.AsPerTill.replace(/[^0-9.-]/g, '')), 0)), Variance: `${salesVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(salesVarianceData.reduce((s, r) => s + r._varVal, 0)))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', 'Sales Variances', ['Date', 'AsPerERP', 'AsPerTill', 'Variance', 'Notes'], salesVarianceData, { Date: 'TOTAL', AsPerERP: fmtMoney(salesVarianceData.reduce((s, r) => s + parseFloat(r.AsPerERP.replace(/[^0-9.-]/g, '')), 0)), AsPerTill: fmtMoney(salesVarianceData.reduce((s, r) => s + parseFloat(r.AsPerTill.replace(/[^0-9.-]/g, '')), 0)), Variance: `${salesVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(salesVarianceData.reduce((s, r) => s + r._varVal, 0)))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
            {activeReport === 'variance' && activeVarianceTab === 'delivery' && (
              <>
                <button onClick={() => handleExport('excel', 'Delivery Payout Variances', ['Period', 'Platform', 'ERP Gross', 'Plat. Gross', 'Gross Variance', 'Auto Comm+VAT', 'Fixed Deductions', 'ERP Expected', 'Actual Bank', 'Variance'], deliveryPayoutVarianceData.map(r=>({'Period': r.Period, 'Platform': r.Platform, 'ERP Gross': r.ERPGross, 'Plat. Gross': r.PlatGross, 'Gross Variance': r.GrossVariance, 'Auto Comm+VAT': r.AutoCommVat, 'Fixed Deductions': r.FixedDed, 'ERP Expected': r.Expected, 'Actual Bank': r.Actual, 'Variance': r.Variance})), { 'Platform': 'TOTALS:', 'ERP Gross': `£ ${fmtMoney(dpvTotals.ERPGross)}`, 'Plat. Gross': `£ ${fmtMoney(dpvTotals.PlatGross)}`, 'Gross Variance': `${dpvTotals.GrossVariance > 0 ? '+ ' : dpvTotals.GrossVariance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(dpvTotals.GrossVariance))}`, 'Auto Comm+VAT': `£ ${fmtMoney(dpvTotals.AutoCommVat)}`, 'Fixed Deductions': `£ ${fmtMoney(dpvTotals.FixedDed)}`, 'ERP Expected': `£ ${fmtMoney(dpvTotals.Expected)}`, 'Actual Bank': `£ ${fmtMoney(dpvTotals.Actual)}`, 'Variance': `${dpvTotals.Variance > 0 ? '+ ' : dpvTotals.Variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(dpvTotals.Variance))}` })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileSpreadsheet size={16} /> Excel</button>
                <button onClick={() => handleExport('pdf', 'Delivery Payout Variances', ['Period', 'Platform', 'ERP Gross', 'Plat. Gross', 'Gross Variance', 'Auto Comm+VAT', 'Fixed Deductions', 'ERP Expected', 'Actual Bank', 'Variance'], deliveryPayoutVarianceData.map(r=>({'Period': r.Period, 'Platform': r.Platform, 'ERP Gross': r.ERPGross, 'Plat. Gross': r.PlatGross, 'Gross Variance': r.GrossVariance, 'Auto Comm+VAT': r.AutoCommVat, 'Fixed Deductions': r.FixedDed, 'ERP Expected': r.Expected, 'Actual Bank': r.Actual, 'Variance': r.Variance})), { 'Platform': 'TOTALS:', 'ERP Gross': `£ ${fmtMoney(dpvTotals.ERPGross)}`, 'Plat. Gross': `£ ${fmtMoney(dpvTotals.PlatGross)}`, 'Gross Variance': `${dpvTotals.GrossVariance > 0 ? '+ ' : dpvTotals.GrossVariance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(dpvTotals.GrossVariance))}`, 'Auto Comm+VAT': `£ ${fmtMoney(dpvTotals.AutoCommVat)}`, 'Fixed Deductions': `£ ${fmtMoney(dpvTotals.FixedDed)}`, 'ERP Expected': `£ ${fmtMoney(dpvTotals.Expected)}`, 'Actual Bank': `£ ${fmtMoney(dpvTotals.Actual)}`, 'Variance': `${dpvTotals.Variance > 0 ? '+ ' : dpvTotals.Variance < 0 ? '- ' : ''}£ ${fmtMoney(Math.abs(dpvTotals.Variance))}` }, 'l')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}><FileText size={16} /> PDF</button>
              </>
            )}
          </div>
        </div>

        <div style={{ background: theme.cardBg, borderRadius: '16px', border: `1px solid ${theme.border}`, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          
          {activeReport === 'sales' && (
            <div>
              <div style={{ display: 'flex', gap: '10px', padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, background: '#f8fafc', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => setSalesSubTab('overall')} style={{ padding: '8px 16px', background: salesSubTab === 'overall' ? theme.textMain : 'transparent', color: salesSubTab === 'overall' ? '#fff' : theme.textMuted, border: `1px solid ${salesSubTab === 'overall' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>Overall Summary</button>
                <button onClick={() => setSalesSubTab('cash')} style={{ padding: '8px 16px', background: salesSubTab === 'cash' ? theme.textMain : 'transparent', color: salesSubTab === 'cash' ? '#fff' : theme.textMuted, border: `1px solid ${salesSubTab === 'cash' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>Cash Breakdown</button>
                <button onClick={() => setSalesSubTab('card')} style={{ padding: '8px 16px', background: salesSubTab === 'card' ? theme.textMain : 'transparent', color: salesSubTab === 'card' ? '#fff' : theme.textMuted, border: `1px solid ${salesSubTab === 'card' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>Card Breakdown</button>
                <button onClick={() => setSalesSubTab('platform')} style={{ padding: '8px 16px', background: salesSubTab === 'platform' ? theme.textMain : 'transparent', color: salesSubTab === 'platform' ? '#fff' : theme.textMuted, border: `1px solid ${salesSubTab === 'platform' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>Platform Breakdown</button>
                {salesSubTab === 'card' && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '12px', fontWeight: '700', color: theme.textMuted }}>Machine:</span><select value={selectedCardMachine} onChange={e => setSelectedCardMachine(e.target.value)} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, fontSize: '13px', fontWeight: '700', outline: 'none', background: '#fff' }}><option value="All">All Card Machines</option><option value="m1">Memon Services</option><option value="m2">Khanani Management</option><option value="m3">LK Associates</option></select></div>
                )}
                {salesSubTab === 'platform' && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '12px', fontWeight: '700', color: theme.textMuted }}>Platform:</span><select value={selectedSalesPlatform} onChange={e => setSelectedSalesPlatform(e.target.value)} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, fontSize: '13px', fontWeight: '700', outline: 'none', background: '#fff' }}><option value="All">All Platforms</option><option value="Uber Eats">Uber Eats</option><option value="Deliveroo">Deliveroo</option><option value="Just Eat">Just Eat</option><option value="App4">App4</option></select></div>
                )}
              </div>
              {salesSubTab === 'overall' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', padding: '24px', background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                    <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px', border: '1px solid #bbf7d0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#166534', textTransform: 'uppercase', marginBottom: '8px' }}>Total Cash Sales</div><div style={{ fontSize: '20px', fontWeight: '900', color: '#15803d', textAlign: 'right' }}>£ {fmtMoney(salesSummaryTotals.cashNet)}</div></div>
                    <div style={{ background: '#eff6ff', padding: '16px', borderRadius: '8px', border: '1px solid #bfdbfe', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#1e40af', textTransform: 'uppercase', marginBottom: '8px' }}>Total Card Sales</div><div style={{ fontSize: '20px', fontWeight: '900', color: '#1d4ed8', textAlign: 'right' }}>£ {fmtMoney(salesSummaryTotals.totalCardNet)}</div></div>
                    <div style={{ background: '#fdf4ff', padding: '16px', borderRadius: '8px', border: '1px solid #e9d5ff', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#6b21a8', textTransform: 'uppercase', marginBottom: '8px' }}>Total Platform Sales</div><div style={{ fontSize: '20px', fontWeight: '900', color: '#7e22ce', textAlign: 'right' }}>£ {fmtMoney(salesSummaryTotals.totalPlatform)}</div></div>
                    <div style={{ background: '#2563eb', padding: '16px', borderRadius: '8px', border: '1px solid #1d4ed8', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#bfdbfe', textTransform: 'uppercase', marginBottom: '8px' }}>Total Net Sales</div><div style={{ fontSize: '24px', fontWeight: '900', color: '#ffffff', textAlign: 'right' }}>£ {fmtMoney(salesSummaryTotals.totalNetSales)}</div></div>
                  </div>
                  <div style={{ padding: '24px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net Cash (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net Card (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Uber Eats (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Deliveroo (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Just Eat (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>App4 (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Total (£)</th></tr></thead>
                      <tbody>
                        {salesSummaryRawData.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}>
                            <td style={{ padding: '10px 12px', fontWeight: '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.cashNet)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.totalCardNet)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#64748b' }}>{fmtMoney(row.uber)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#64748b' }}>{fmtMoney(row.del)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#64748b' }}>{fmtMoney(row.je)}</td><td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'center', color: '#64748b' }}>{fmtMoney(row.app4)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: theme.primary }}>{fmtMoney(row.totalNetSales)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: '#f8fafc' }}>
                          <td style={{ padding: '10px 12px', fontWeight: '800', fontSize: '12px', textAlign: 'left' }}>TOTAL:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800' }}>{fmtMoney(salesSummaryTotals.cashNet)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800' }}>{fmtMoney(salesSummaryTotals.totalCardNet)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#475569' }}>{fmtMoney(salesSummaryTotals.uber)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#475569' }}>{fmtMoney(salesSummaryTotals.del)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#475569' }}>{fmtMoney(salesSummaryTotals.je)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#475569' }}>{fmtMoney(salesSummaryTotals.app4)}</td><td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'center', fontWeight: '900', color: theme.primary }}>{fmtMoney(salesSummaryTotals.totalNetSales)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {salesSubTab === 'cash' && (
                <div style={{ padding: '24px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Gross Cash Sales (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Cash Refunds (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net Cash Sales (£)</th></tr></thead>
                    <tbody>
                      {salesSummaryRawData.map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontWeight: '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.cashGross)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(row.cashRefund)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#059669' }}>{fmtMoney(row.cashNet)}</td></tr>
                      ))}
                      <tr style={{ background: '#f8fafc', fontWeight: '800' }}><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL CASH SALES:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.cashGross)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(salesSummaryTotals.cashRefund)}</td><td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'center', color: '#059669' }}>{fmtMoney(salesSummaryTotals.cashNet)}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
              {salesSubTab === 'card' && (
                <div style={{ padding: '24px', overflowX: 'auto' }}>
                  {selectedCardMachine === 'All' ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Memon Services (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Khanani Management (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>LK Associates (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Total Card Net (£)</th></tr></thead>
                      <tbody>
                        {salesSummaryRawData.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontWeight: '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.m1Net)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.m2Net)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.m3Net)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: theme.primary }}>{fmtMoney(row.totalCardNet)}</td></tr>
                        ))}
                        <tr style={{ background: '#f8fafc', fontWeight: '800' }}><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL CARD SALES:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.m1Net)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.m2Net)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.m3Net)}</td><td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'center', color: theme.primary }}>{fmtMoney(salesSummaryTotals.totalCardNet)}</td></tr>
                      </tbody>
                    </table>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Gross Sales (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Refunds (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net Sales (£)</th></tr></thead>
                      <tbody>
                        {salesSummaryRawData.map((row, i) => { const g = selectedCardMachine === 'm1' ? row.m1Gross : selectedCardMachine === 'm2' ? row.m2Gross : row.m3Gross; const r = selectedCardMachine === 'm1' ? row.m1Refund : selectedCardMachine === 'm2' ? row.m2Refund : row.m3Refund; const n = selectedCardMachine === 'm1' ? row.m1Net : selectedCardMachine === 'm2' ? row.m2Net : row.m3Net; return ( <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontWeight: '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(g)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(r)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#059669' }}>{fmtMoney(n)}</td></tr> ); })}
                        <tr style={{ background: '#f8fafc', fontWeight: '800' }}><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL MACHINE SALES:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(selectedCardMachine === 'm1' ? salesSummaryTotals.m1Gross : selectedCardMachine === 'm2' ? salesSummaryTotals.m2Gross : salesSummaryTotals.m3Gross)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(selectedCardMachine === 'm1' ? salesSummaryTotals.m1Refund : selectedCardMachine === 'm2' ? salesSummaryTotals.m2Refund : salesSummaryTotals.m3Refund)}</td><td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'center', color: '#059669' }}>{fmtMoney(selectedCardMachine === 'm1' ? salesSummaryTotals.m1Net : selectedCardMachine === 'm2' ? salesSummaryTotals.m2Net : salesSummaryTotals.m3Net)}</td></tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {salesSubTab === 'platform' && (
                <div style={{ padding: '24px', overflowX: 'auto' }}>
                  {selectedSalesPlatform === 'All' ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Uber Eats (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Deliveroo (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Just Eat (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>App4 (£)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Total Platforms (£)</th></tr></thead>
                      <tbody>
                        {salesSummaryRawData.map((row, i) => ( <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontWeight: '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.uber)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.del)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.je)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(row.app4)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: theme.primary }}>{fmtMoney(row.totalPlatform)}</td></tr> ))}
                        <tr style={{ background: '#f8fafc', fontWeight: '800' }}><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL PLATFORM SALES:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.uber)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.del)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.je)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesSummaryTotals.app4)}</td><td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'center', color: theme.primary }}>{fmtMoney(salesSummaryTotals.totalPlatform)}</td></tr>
                      </tbody>
                    </table>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Platform</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Sales Amount (£)</th></tr></thead>
                      <tbody>
                        {salesSummaryRawData.map((row, i) => { let val = 0; if (selectedSalesPlatform === 'Uber Eats') val = row.uber; if (selectedSalesPlatform === 'Deliveroo') val = row.del; if (selectedSalesPlatform === 'Just Eat') val = row.je; if (selectedSalesPlatform === 'App4') val = row.app4; return ( <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontWeight: '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', color: theme.primary, fontSize: '12px', fontWeight: '700', textAlign: 'left' }}>{selectedSalesPlatform}</td><td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '800', color: '#059669' }}>{fmtMoney(val)}</td></tr> ); })}
                        <tr style={{ background: '#f8fafc', fontWeight: '800' }}><td colSpan="2" style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'right' }}>TOTAL {selectedSalesPlatform.toUpperCase()} SALES:</td><td style={{ padding: '10px 12px', fontSize: '13px', textAlign: 'center', color: '#059669' }}>{fmtMoney(selectedSalesPlatform === 'Uber Eats' ? salesSummaryTotals.uber : selectedSalesPlatform === 'Deliveroo' ? salesSummaryTotals.del : selectedSalesPlatform === 'Just Eat' ? salesSummaryTotals.je : salesSummaryTotals.app4)}</td></tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* GENERAL LEDGER VIEW */}
          {activeReport === 'ledger' && (
            <div>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, background: '#f8fafc', display: 'flex', gap: '20px', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '800' }}>Select Account:</h3>
                <select value={selectedLedgerId} onChange={e => setSelectedLedgerId(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, fontSize: '13px', fontWeight: '700', minWidth: '250px', outline: 'none' }}><option value="">-- Choose any account --</option>{sortedAccountsDb.map(a => <option key={a.id} value={a.id}>{a.name} ({a.category})</option>)}</select>
                {selectedLedgerId && ledgerData.length > 0 && (<div style={{ marginLeft: 'auto', fontSize: '14px', fontWeight: '800', color: '#0f172a', background: '#e2e8f0', padding: '6px 12px', borderRadius: '6px' }}>Closing Balance: £ {ledgerData[ledgerData.length - 1].Balance}</div>)}
              </div>
              <div style={{ padding: '24px', overflowX: 'auto' }}>
                {!selectedLedgerId ? (<div style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>Please select an account from the dropdown above.</div>) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Ref</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Description</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Contra A/C</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Debit (In)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Credit (Out)</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Balance</th></tr></thead>
                    <tbody>
                      {ledgerData.length === 0 ? (<tr><td colSpan="7" style={{ padding: '30px', textAlign: 'center', color: theme.textMuted }}>No transactions found for this period.</td></tr>) : (
                        ledgerData.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${theme.border}`, background: row.Ref === 'B/F' ? '#f1f5f9' : 'transparent' }}>
                            <td style={{ padding: '10px 12px', fontWeight: row.Ref === 'B/F' ? '800' : '600', fontSize: '12px', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '11px', color: theme.textMuted, textAlign: 'left', fontWeight: row.Ref === 'B/F' ? '800' : '400' }}>{row.Ref}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left', fontWeight: row.Ref === 'B/F' ? '800' : '400', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '300px' }}>{row.Description}</td><td style={{ padding: '10px 12px', fontSize: '11px', color: '#475569', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '150px' }}>{row.Contra}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '700', color: '#059669' }}>{row.Debit !== '-' ? `£ ${row.Debit}` : '-'}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '700', color: '#dc2626' }}>{row.Credit !== '-' ? `£ ${row.Credit}` : '-'}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800' }}>£ {row.Balance}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* SUPPLIER BALANCES VIEW */}
          {activeReport === 'suppliers' && (
            <div style={{ padding: '24px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Supplier Name</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Opening Balance</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Total Billed</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Total Paid</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Outstanding Balance</th></tr></thead>
                <tbody>
                  {supplierData.length === 0 ? (<tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No supplier activity found.</td></tr>) : (
                    supplierData.map(sup => (
                      <tr key={sup.Supplier} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '700', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '200px' }}>{sup.Supplier}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '600', color: '#475569' }}>£ {sup.Opening}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '600', color: '#475569' }}>£ {sup.Billed}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '600', color: '#059669' }}>£ {sup.Paid}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: sup._bal > 0 ? '#dc2626' : '#0f172a' }}>£ {sup.Balance}</td></tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* VAT SUMMARY DASHBOARD VIEW */}
          {activeReport === 'vat' && (
            <div id="printable-vat-area">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', padding: '24px', background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '10px', border: '1px solid #bbf7d0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#166534', textTransform: 'uppercase', marginBottom: '8px' }}>VAT Collected (on Sales)</div><div style={{ fontSize: '24px', fontWeight: '900', color: '#15803d', textAlign: 'right' }}>£ {fmtMoney(totalSalesVat)}</div></div>
                <div style={{ background: '#fff7ed', padding: '16px', borderRadius: '10px', border: `1px solid #fdba74`, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#ea580c', textTransform: 'uppercase', marginBottom: '8px' }}>VAT Paid (on Purchases)</div><div style={{ fontSize: '24px', fontWeight: '900', color: '#c2410c', textAlign: 'right' }}>£ {fmtMoney(totalPurchasesVat)}</div></div>
                <div style={{ background: '#fdf4ff', padding: '16px', borderRadius: '10px', border: '1px solid #e9d5ff', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', flexDirection: 'column', gap: '6px' }}><div style={{ fontSize: '11px', fontWeight: '800', color: '#6b21a8', textTransform: 'uppercase' }}>VAT Deducted (Platforms)</div><select value={selectedVatPlatform} onChange={e => setSelectedVatPlatform(e.target.value)} style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #d8b4fe', outline: 'none', background: '#fff', color: '#6b21a8', fontWeight: '700', width: '100%' }}><option value="All">All Platforms (Total)</option>{Array.from(new Set(vatDeliveryData.map(d => d.Platform))).sort((a, b) => a.localeCompare(b)).map(p => (<option key={p} value={p}>{p}</option>))}</select></div><div style={{ fontSize: '24px', fontWeight: '900', color: '#7e22ce', textAlign: 'right' }}>£ {fmtMoney(filteredPlatformVat)}</div></div>
                <div style={{ background: netVat > 0 ? '#fef2f2' : netVat < 0 ? '#fffbeb' : '#eff6ff', padding: '16px', borderRadius: '10px', border: netVat > 0 ? '1px solid #fecaca' : netVat < 0 ? '1px solid #fde68a' : '1px solid #bfdbfe', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}><div style={{ fontSize: '11px', fontWeight: '800', color: netVat > 0 ? '#991b1b' : netVat < 0 ? '#b45309' : '#1e40af', textTransform: 'uppercase', marginBottom: '8px' }}>{netVat > 0 ? 'Net VAT Payable' : netVat < 0 ? 'Net VAT Receivable' : 'Net VAT Liability'}</div><div style={{ fontSize: '28px', fontWeight: '900', color: netVat > 0 ? '#dc2626' : netVat < 0 ? '#d97706' : '#1d4ed8', textAlign: 'right' }}>£ {fmtMoney(Math.abs(netVat))}</div></div>
              </div>
              <div style={{ padding: '24px', borderBottom: `1px solid ${theme.border}`, overflowX: 'auto' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '800', color: theme.textMain }}>VAT Collected (on Sales)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Source</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Gross Sales</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net Sales</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Recorded VAT</th></tr></thead>
                  <tbody>{vatSalesData.length === 0 ? (<tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No sales VAT recorded.</td></tr>) : (vatSalesData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '600', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', color: theme.textMuted, fontSize: '12px', textAlign: 'left' }}>{row.Source}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {row.Gross}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {row.Net}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#059669' }}>£ {row.VAT}</td></tr>)))}</tbody>
                </table>
              </div>
              <div style={{ padding: '24px', borderBottom: `1px solid ${theme.border}`, overflowX: 'auto' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '800', color: theme.textMain }}>VAT Paid (on Purchases & Expenses)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Supplier / Ref</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Gross</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>VAT Amount</th></tr></thead>
                  <tbody>{vatData.length === 0 ? (<tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No VAT recorded on purchases.</td></tr>) : (vatData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '600', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '250px' }}><div style={{ fontWeight: '700', fontSize: '12px' }}>{row.Supplier}</div><div style={{ fontSize: '11px', color: theme.textMuted }}>{row.Ref}</div></td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {row.Gross}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {row.Net}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#dc2626' }}>£ {row.VAT}</td></tr>)))}</tbody>
                </table>
              </div>
              <div style={{ padding: '24px', overflowX: 'auto' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '800', color: theme.textMain }}>VAT Deducted (by Delivery Platforms)</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Payout Date</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Platform</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Settlement Period</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Gross Sales</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Net Payout</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Platform VAT Deducted</th></tr></thead>
                  <tbody>{filteredVatDeliveryData.length === 0 ? (<tr><td colSpan="6" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No VAT recorded from delivery platforms.</td></tr>) : (filteredVatDeliveryData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '600', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '700', color: theme.primary, textAlign: 'left' }}>{row.Platform}</td><td style={{ padding: '10px 12px', color: theme.textMuted, fontSize: '11px', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '200px' }}>{row.Period}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {row.GrossSales}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '600', color: '#059669' }}>£ {row.NetPayout}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#7e22ce' }}>£ {row.VAT_Total}</td></tr>)))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* DELIVERY SETTLEMENTS VIEW */}
          {activeReport === 'delivery' && (
            <div>
              <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, background: '#f8fafc', display: 'flex', gap: '20px', alignItems: 'center' }}>
                <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '800' }}>Select Delivery Platform:</h3>
                <select value={selectedPlatform} onChange={e => setSelectedPlatform(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, fontSize: '13px', fontWeight: '700', minWidth: '250px', outline: 'none' }}>{deliveryPlatformsList.map(p => <option key={p} value={p}>{p}</option>)}</select>
              </div>
              <div style={{ padding: '24px', overflowX: 'auto' }}>
                <table style={{ width: 'max-content', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1300px', whiteSpace: 'nowrap' }}>
                  <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '0 8px 12px 0', textAlign: 'left' }}>Period (Mon - Sun)</th><th style={{ padding: '0 8px 12px 0', textAlign: 'left' }}>Platform</th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>ERP Gross<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Comm.<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>VAT on Comm.<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Adv.<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>VAT on Adv.<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Serv. Chg.<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Refunds<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Adj (+)<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Adj (-)<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Expected<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Actual<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Payout Date</th><th style={{ padding: '0 8px 12px 0', textAlign: 'center' }}>Variance<br/><span style={{ fontWeight: 'normal' }}>(£)</span></th><th style={{ padding: '0 0 12px 0', textAlign: 'left', paddingLeft: '8px' }}>Reasons</th></tr></thead>
                  <tbody>
                    {deliveryWeeklyData.length === 0 ? (<tr><td colSpan="16" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No delivery records found.</td></tr>) : (
                      <>
                        {deliveryWeeklyData.map((row, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${theme.border}`, fontSize: '12px' }}><td style={{ padding: '12px 8px 12px 0', fontWeight: '700', textAlign: 'left' }}>{row.Period}</td><td style={{ padding: '12px 8px 12px 0', fontWeight: '700', color: theme.primary, textAlign: 'left' }}>{row.Platform}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center' }}>{row.GrossSales}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626' }}>{row.Commission}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626' }}>{row.VatOnCommission}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626' }}>{row.Advertisement}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626' }}>{row.VatOnAdvertisement}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626' }}>{row.ServiceCharges}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626' }}>{row.Refunds}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#059669', cursor: 'pointer' }} title={`Reason: ${row._posReason}`}>{row.AdjustmentPos}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', color: '#dc2626', cursor: 'pointer' }} title={`Reason: ${row._negReason}`}>{row.AdjustmentNeg}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', fontWeight: '700' }}>{row.ExpectedPayout}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', fontWeight: '800', color: '#059669' }}>{row.ActualPayout}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center', fontSize: '11px' }}>{row.PayoutDate}</td><td style={{ padding: '12px 8px 12px 0', textAlign: 'center' }}><VarBadge value={row.VarianceVal} text={row.Variance} /></td><td style={{ padding: '12px 0 12px 8px', color: theme.textMuted, textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '250px' }}>{row.VarianceReasons}</td></tr>
                        ))}
                        <tr style={{ background: '#f8fafc', fontWeight: '800' }}><td colSpan="2" style={{ padding: '16px 8px 16px 0', textAlign: 'left' }}>TOTAL:</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center' }}>{fmtMoney(deliveryTotals.GrossSales)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.Commission)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.VatOnCommission)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.Advertisement)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.VatOnAdvertisement)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.ServiceCharges)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.Refunds)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#059669' }}>{fmtMoney(deliveryTotals.AdjustmentPos)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#dc2626' }}>{fmtMoney(deliveryTotals.AdjustmentNeg)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center' }}>{fmtMoney(deliveryTotals.ExpectedPayout)}</td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center', color: '#059669' }}>{fmtMoney(deliveryTotals.ActualPayout)}</td><td style={{ padding: '16px 8px 16px 0' }}></td><td style={{ padding: '16px 8px 16px 0', textAlign: 'center' }}><VarBadge value={deliveryTotals.Variance} text={`${deliveryTotals.Variance > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(deliveryTotals.Variance))}`} /></td><td style={{ padding: '16px 0 16px 8px' }}></td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VARIANCES VIEW */}
          {activeReport === 'variance' && (
            <div>
              <div style={{ display: 'flex', gap: '10px', padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, background: '#f8fafc', flexWrap: 'wrap' }}>
                <button onClick={() => setActiveVarianceTab('till')} style={{ padding: '8px 16px', background: activeVarianceTab === 'till' ? theme.textMain : 'transparent', color: activeVarianceTab === 'till' ? '#fff' : theme.textMuted, border: `1px solid ${activeVarianceTab === 'till' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Till Variances</button>
                <button onClick={() => setActiveVarianceTab('card')} style={{ padding: '8px 16px', background: activeVarianceTab === 'card' ? theme.textMain : 'transparent', color: activeVarianceTab === 'card' ? '#fff' : theme.textMuted, border: `1px solid ${activeVarianceTab === 'card' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Card Variances</button>
                <button onClick={() => setActiveVarianceTab('sales')} style={{ padding: '8px 16px', background: activeVarianceTab === 'sales' ? theme.textMain : 'transparent', color: activeVarianceTab === 'sales' ? '#fff' : theme.textMuted, border: `1px solid ${activeVarianceTab === 'sales' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Sales Variances</button>
                <button onClick={() => setActiveVarianceTab('delivery')} style={{ padding: '8px 16px', background: activeVarianceTab === 'delivery' ? theme.textMain : 'transparent', color: activeVarianceTab === 'delivery' ? '#fff' : theme.textMuted, border: `1px solid ${activeVarianceTab === 'delivery' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Delivery Payout Variances</button>
              </div>

              <div style={{ padding: '24px', overflowX: 'auto' }}>
                {activeVarianceTab === 'till' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Expected in Till</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Actual Counted</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Variance</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Notes / Reason</th></tr></thead>
                    <tbody>{tillVarianceData.length === 0 ? (<tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No till variances found.</td></tr>) : (<>{tillVarianceData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '700', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.Expected}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.Actual}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={row._varVal} text={row.Variance} /></td><td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '350px' }}>{row.Reason}</td></tr>))}<tr style={{ background: '#f1f5f9', fontWeight: '800' }}><td colSpan="1" style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL TILL VARIANCE:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(tillVarianceData.reduce((s, r) => s + parseFloat(r.Expected.replace(/[^0-9.-]/g, '')), 0))}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(tillVarianceData.reduce((s, r) => s + parseFloat(r.Actual.replace(/[^0-9.-]/g, '')), 0))}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={tillVarianceData.reduce((s, r) => s + r._varVal, 0)} text={`${tillVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(tillVarianceData.reduce((s, r) => s + r._varVal, 0)))}`} /></td><td></td></tr></>)}</tbody>
                  </table>
                )}
                {activeVarianceTab === 'card' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>As Per ERP</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>As Per Till</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Variance</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Notes / Reason</th></tr></thead>
                    <tbody>{cardVarianceData.length === 0 ? (<tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No card variances found.</td></tr>) : (<>{cardVarianceData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '700', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.AsPerERP}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.AsPerTill}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={row._varVal} text={row.Variance} /></td><td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '350px' }}>{row.Notes}</td></tr>))}<tr style={{ background: '#f1f5f9', fontWeight: '800' }}><td colSpan="1" style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL CARD VARIANCE:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(cardVarianceData.reduce((s, r) => s + parseFloat(r.AsPerERP.replace(/[^0-9.-]/g, '')), 0))}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(cardVarianceData.reduce((s, r) => s + parseFloat(r.AsPerTill.replace(/[^0-9.-]/g, '')), 0))}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={cardVarianceData.reduce((s, r) => s + r._varVal, 0)} text={`${cardVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(cardVarianceData.reduce((s, r) => s + r._varVal, 0)))}`} /></td><td></td></tr></>)}</tbody>
                  </table>
                )}
                {activeVarianceTab === 'sales' && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>As Per ERP</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>As Per Till</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Variance</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Notes / Reason</th></tr></thead>
                    <tbody>{salesVarianceData.length === 0 ? (<tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No sales variances found.</td></tr>) : (<>{salesVarianceData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '700', textAlign: 'left' }}>{row.Date}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.AsPerERP}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.AsPerTill}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={row._varVal} text={row.Variance} /></td><td style={{ padding: '10px 12px', fontSize: '12px', color: '#475569', textAlign: 'left', whiteSpace: 'normal', wordWrap: 'break-word', maxWidth: '350px' }}>{row.Notes}</td></tr>))}<tr style={{ background: '#f1f5f9', fontWeight: '800' }}><td colSpan="1" style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTAL SALES VARIANCE:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesVarianceData.reduce((s, r) => s + parseFloat(r.AsPerERP.replace(/[^0-9.-]/g, '')), 0))}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{fmtMoney(salesVarianceData.reduce((s, r) => s + parseFloat(r.AsPerTill.replace(/[^0-9.-]/g, '')), 0))}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={salesVarianceData.reduce((s, r) => s + r._varVal, 0)} text={`${salesVarianceData.reduce((s, r) => s + r._varVal, 0) > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(salesVarianceData.reduce((s, r) => s + r._varVal, 0)))}`} /></td><td></td></tr></>)}</tbody>
                  </table>
                )}
                {activeVarianceTab === 'delivery' && (
                  <div>
                    <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}><label style={{ fontSize: '11px', fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase' }}>Filter Platform:</label><select value={selectedPlatform} onChange={e => setSelectedPlatform(e.target.value)} style={{ padding: '6px 12px', borderRadius: '6px', border: `1px solid ${theme.border}`, fontSize: '12px', fontWeight: '700', outline: 'none' }}>{deliveryPlatformsList.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <table style={{ width: 'max-content', borderCollapse: 'collapse', textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <thead style={{ fontSize: '11px', color: theme.textMuted, textTransform: 'uppercase', borderBottom: `2px solid ${theme.border}` }}><tr><th style={{ padding: '10px 12px', textAlign: 'left' }}>Period</th><th style={{ padding: '10px 12px', textAlign: 'left' }}>Platform</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>ERP Gross</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Plat. Gross</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Gross Variance</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Auto Comm+VAT</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Fixed Ded & Adj</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>ERP Expected</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Actual Bank</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Variance</th></tr></thead>
                      <tbody>{deliveryPayoutVarianceData.length === 0 ? (<tr><td colSpan="10" style={{ padding: '40px', textAlign: 'center', color: theme.textMuted }}>No delivery payout variances found.</td></tr>) : (<>{deliveryPayoutVarianceData.map((row, i) => (<tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '600', textAlign: 'left' }}>{row.Period}</td><td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: '700', color: theme.primary, textAlign: 'left' }}>{row.Platform}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>{row.ERPGross}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#475569' }}>{row.PlatGross}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={row.GrossVarianceVal} text={row.GrossVariance} /></td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>{row.AutoCommVat}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>{row.FixedDed}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '700' }}>{row.Expected}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', fontWeight: '800', color: '#059669' }}>{row.Actual}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={row.VarianceVal} text={row.Variance} /></td></tr>))}<tr style={{ background: '#f1f5f9', fontWeight: '800' }}><td colSpan="2" style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'left' }}>TOTALS:</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {fmtMoney(dpvTotals.ERPGross)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {fmtMoney(dpvTotals.PlatGross)}</td><td style={{ padding: '10px 12px', textAlign: 'center' }}><VarBadge value={dpvTotals.GrossVariance} text={`${dpvTotals.GrossVariance > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(dpvTotals.GrossVariance))}`} /></td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>£ {fmtMoney(dpvTotals.AutoCommVat)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#dc2626' }}>£ {fmtMoney(dpvTotals.FixedDed)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}>£ {fmtMoney(dpvTotals.Expected)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center', color: '#059669' }}>£ {fmtMoney(dpvTotals.Actual)}</td><td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'center' }}><VarBadge value={dpvTotals.Variance} text={`${dpvTotals.Variance > 0 ? '+ ' : ''}£ ${fmtMoney(Math.abs(dpvTotals.Variance))}`} /></td></tr></>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}