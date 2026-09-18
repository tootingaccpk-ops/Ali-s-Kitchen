import React, { useState, useMemo } from 'react';
import { Calendar, FileSpreadsheet, FileText, Filter } from 'lucide-react';
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
  const parts = normalizeDate(dateStr).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
};

const toDateObj = (dateStr) => {
  if (!dateStr) return new Date(0); 
  const nd = normalizeDate(dateStr); 
  const p = nd.split('-');
  if (p.length === 3) return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  return new Date(nd);
};

const fmtMoney = (n) => { 
  const num = Number(n) || 0; 
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); 
};

const fmtCol = (n) => { 
  const num = Number(n) || 0; 
  return Math.abs(num) < 0.01 ? '-' : num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); 
};

const calcRatio = (amt, total) => { 
  const nAmt = Number(amt) || 0; 
  const nTot = Number(total) || 0;
  if (nTot === 0) return '0.00%'; 
  return ((nAmt / nTot) * 100).toFixed(2) + '%'; 
};

export default function FinancialStatements({ salesDb = [], purchasesDb = [], receiptsDb = [], accountsDb = [], deliveryDb = [], categoriesMap = {} }) {
  const [financialsTab, setFinancialsTab] = useState('pnl_detailed'); 
  const [dateFrom, setDateFrom] = useState(getStartOfMonth());
  const [dateTo, setDateTo] = useState(getToday());
  
  const [auditPlatformFilter, setAuditPlatformFilter] = useState('All');

  const actualDeliveryDb = useMemo(() => { 
    try { 
      return deliveryDb.length > 0 ? deliveryDb : JSON.parse(localStorage.getItem('erp_delivery') || '[]'); 
    } catch (e) { 
      return []; 
    } 
  }, [deliveryDb]);

  const genericItemNames = ['Direct Financial Payment', 'Journal Entry', 'System Adjustment', 'Unassigned Vendor', 'Unassigned / Direct Ledger', 'Cash In Hand'];

  const activeAccountNames = useMemo(() => {
    const set = new Set();
    (accountsDb || []).forEach(acc => {
      if (acc && acc.name) set.add(String(acc.name).trim().toLowerCase());
    });
    return set;
  }, [accountsDb]);

  const handleExport = (format, reportTitle, headers, dataRows, orientation = 'l') => {
    if (!dataRows || dataRows.length === 0) return alert("No data available to export for this date range.");
    const businessName = "Ali's Kitchen"; 
    const period = `Period: ${formatDate(dateFrom)} to ${formatDate(dateTo)}`; 
    const filename = `${reportTitle.replace(/\s+/g, '_')}_${dateFrom}`;
    
    if (format === 'excel') {
      let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>table { border-collapse: collapse; white-space: nowrap; } th, td { border: 1px solid #000000; padding: 8px; font-family: Arial, sans-serif; }</style></head><body><table><tr><td colspan="${headers.length}" style="font-size: 18px; font-weight: bold; border: none; text-align: left;">${businessName}</td></tr><tr><td colspan="${headers.length}" style="font-size: 14px; font-weight: bold; border: none; text-align: left;">${reportTitle}</td></tr><tr><td colspan="${headers.length}" style="font-size: 12px; color: #000; border: none; text-align: left;">${period}</td></tr><tr><td colspan="${headers.length}" style="border: none;"></td></tr><tr>`;
      headers.forEach((h, i) => { html += `<th style="background-color: #0f172a; color: #ffffff; font-weight: bold; text-align: ${i === 0 || i === headers.length - 1 ? 'left' : 'right'}; border: 1px solid #000000;">${h}</th>`; }); 
      html += `</tr>`;
      
      dataRows.forEach((row, rowIndex) => { 
        html += `<tr>`; 
        row.forEach((val, i) => {
          const text = String(row[0] || '');
          const isSummaryRow = text.startsWith('TOTAL') || text.startsWith('NET BALANCE') || text.startsWith('Total ') || text === 'NET SALES' || text === 'TOTAL INCOME' || text === 'GROSS PROFIT' || text.includes('NET PROFIT') || text === 'NET VAT AMOUNT';

          let bg = '#ffffff';
          let color = '#000000';
          let fw = isSummaryRow ? 'bold' : 'normal';

          if (text.includes('---')) {
            bg = '#0f172a'; color = '#ffffff'; fw = 'bold';
          } else if (text.startsWith('[Group]')) {
            bg = '#f1f5f9'; color = '#334155'; fw = 'bold';
          } else if (isSummaryRow) {
            bg = '#dcfce7'; color = '#000000'; fw = 'bold';
          }

          html += `<td style="text-align: ${i === 0 || i === headers.length - 1 ? 'left' : 'right'}; font-weight: ${fw}; background-color: ${bg}; color: ${color}; border: 1px solid #000000;">${val}</td>`; 
        }); 
        html += `</tr>`; 
      });
      html += `</table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' }); 
      const url = URL.createObjectURL(blob); 
      const link = document.createElement("a"); 
      link.href = url; 
      link.download = `${filename}.xls`; 
      document.body.appendChild(link); 
      link.click(); 
      document.body.removeChild(link);
    } else if (format === 'pdf') {
      try {
        const doc = new jsPDF(orientation, 'pt', 'a4'); 
        doc.setFontSize(18); doc.setFont("helvetica", "bold"); doc.text(businessName, 15, 40); 
        doc.setFontSize(14); doc.text(reportTitle, 15, 60); 
        doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.text(period, 15, 75);
        autoTable(doc, { 
          startY: 90, 
          head: [headers], 
          body: dataRows, 
          theme: 'grid', 
          margin: { left: 15, right: 15 }, 
          headStyles: { fillColor: [15, 23, 42], fontSize: 8, cellPadding: 4, textColor: [255, 255, 255] }, 
          styles: { fontSize: 7, cellPadding: 4, textColor: [0, 0, 0] },
          didParseCell: (data) => { 
            const text = String(data.row.raw[0] || '');
            
            if (text.includes('---')) {
              data.cell.styles.fillColor = [15, 23, 42];
              data.cell.styles.textColor = [255, 255, 255];
              data.cell.styles.fontStyle = 'bold';
            } else if (text.startsWith('[Group]')) {
              data.cell.styles.fillColor = [241, 245, 249];
              data.cell.styles.textColor = [51, 65, 85];
              data.cell.styles.fontStyle = 'bold';
            } else if (text.startsWith('TOTAL') || text.startsWith('NET BALANCE') || text.startsWith('Total ') || text === 'NET SALES' || text === 'TOTAL INCOME' || text === 'GROSS PROFIT' || text.includes('NET PROFIT') || text === 'NET VAT AMOUNT') {
              data.cell.styles.fillColor = [220, 252, 231];
              data.cell.styles.textColor = [0, 0, 0];
              data.cell.styles.fontStyle = 'bold';
            }

            if (data.column.index > 0 && data.column.index < headers.length - 1) {
              data.cell.styles.halign = 'right';
            }
          } 
        }); 
        doc.save(`${filename}.pdf`);
      } catch (err) { alert("PDF Generation Failed."); }
    }
  };

  const pnlData = useMemo(() => {
    const validSales = (salesDb || []).filter(s => s && toDateObj(s.date) >= toDateObj(dateFrom) && toDateObj(s.date) <= toDateObj(dateTo));
    const validPurchases = (purchasesDb || []).filter(p => p && toDateObj(p.date) >= toDateObj(dateFrom) && toDateObj(p.date) <= toDateObj(dateTo));
    const validReceipts = (receiptsDb || []).filter(r => r && toDateObj(r.date) >= toDateObj(dateFrom) && toDateObj(r.date) <= toDateObj(dateTo));
    const validDelivery = (actualDeliveryDb || []).filter(d => {
       if (!d) return false;
       const settleDate = normalizeDate(d.payoutDate || d.date || d.dateTo || d.dateFrom || getToday());
       return toDateObj(settleDate) >= toDateObj(dateFrom) && toDateObj(settleDate) <= toDateObj(dateTo);
    });
    
    const initCols = () => ({ cash: 0, memon: 0, khanani: 0, lk: 0, total: 0 });
    const colKeys = ['cash', 'memon', 'khanani', 'lk', 'total'];
    
    let salesMap = {}; let refundsMap = {}; let cogsMap = {}; let otherIncomeMap = {}; let promoMap = {}; let expensesMap = {};
    
    // Detailed VAT Maps
    let vatSalesCols = initCols();
    let vatPurchasesCols = initCols();
    let vatDeliveryMap = {};
    
    let totalTillOverage = 0; let totalTillShortage = 0; 
    let totalErpCardNet = 0; let totalTillCardNet = 0;

    const addAmt = (map, acc, amt, col) => {
      const nAmt = Number(amt) || 0;
      if (isNaN(nAmt) || Math.abs(nAmt) < 0.01) return;
      if (!map[acc]) map[acc] = initCols();
      if (col && typeof map[acc][col] !== 'undefined') { map[acc][col] += nAmt; }
      map[acc].total += nAmt;
    };

    const addAmtNested = (map, category, item, amt, col) => {
      const nAmt = Number(amt) || 0;
      if (isNaN(nAmt) || Math.abs(nAmt) < 0.01) return;
      if (!map[category]) map[category] = { subtotal: initCols(), items: {} };
      const itemName = item || 'Unassigned / Direct Ledger';
      if (!map[category].items[itemName]) map[category].items[itemName] = initCols();
      
      if (col && typeof map[category].subtotal[col] !== 'undefined') {
          map[category].subtotal[col] += nAmt;
          map[category].items[itemName][col] += nAmt;
      }
      map[category].subtotal.total += nAmt;
      map[category].items[itemName].total += nAmt;
    };

    const getBankCol = (name) => {
      if (!name) return null; const n = String(name).toLowerCase();
      if (n.includes('memon')) return 'memon';
      if (n.includes('khanani')) return 'khanani';
      if (n.includes('lk')) return 'lk';
      if (n.includes('cash') || n.includes('till')) return 'cash';
      return null;
    };

    const isCogsAccount = (nameStr, catStr) => {
       const str = String(nameStr || '').toLowerCase() + ' ' + String(catStr || '').toLowerCase();
       return str.includes('cogs') || str.includes('cost of goods') || str.includes('purchase');
    };

    const isValidAccount = (accName) => {
      if (!accName) return false;
      return activeAccountNames.has(String(accName).trim().toLowerCase());
    };

    validSales.forEach(s => {
      if (!s) return;
      const cashG = Number(s.cashGross) || 0; 
      const m1G = Number(s.m1Gross) || 0; 
      const m2G = Number(s.m2Gross) || 0; 
      const m3G = Number(s.m3Gross) || 0;
      const uber = Number(s.uber) || 0;
      const deliv = Number(s.deliveroo) || 0;
      const justEat = Number(s.justEat) || 0;
      const app4 = Number(s.app4) || 0;
      const otherD = Number(s.otherDel) || 0;

      const vatVal = Number(s.vatAmount) || Number(s.totalVat) || Number(s.vatCollected) || Number(s.vat) || 0;
      
      addAmt(salesMap, 'Cash Sales', cashG, 'cash');
      addAmt(salesMap, 'Card Sales - Memon', m1G, 'memon');
      addAmt(salesMap, 'Card Sales - Khanani', m2G, 'khanani');
      addAmt(salesMap, 'Card Sales - LK', m3G, 'lk');
      addAmt(salesMap, 'Delivery - Uber Eats', uber, 'memon');
      addAmt(salesMap, 'Delivery - Deliveroo', deliv, 'memon');
      addAmt(salesMap, 'Delivery - Just Eat', justEat, 'memon');
      addAmt(salesMap, 'Delivery - App4', app4, 'memon');
      addAmt(salesMap, 'Delivery - Other', otherD, 'memon');

      addAmt(refundsMap, 'Cash Refunds', Number(s.cashRefund)||0, 'cash');
      addAmt(refundsMap, 'Card Refunds - Memon', Number(s.m1Refund)||0, 'memon');
      addAmt(refundsMap, 'Card Refunds - Khanani', Number(s.m2Refund)||0, 'khanani');
      addAmt(refundsMap, 'Card Refunds - LK', Number(s.m3Refund)||0, 'lk');

      // VAT on Sales completely unassigned to columns - kept exclusively in the Total Column
      vatSalesCols.total += vatVal;

      const coll = Number(s.collections) || 0;
      addAmtNested(cogsMap, 'Purchases', 'Daily Petty Cash (From Sales)', coll, 'cash');

      const expectedTill = (Number(s.openingTill)||0) + (cashG - (Number(s.cashRefund)||0)) - coll - (Number(s.safeBox)||0);
      const actualTill = Number(s.physicalTill)||0; 
      const tillVar = actualTill - expectedTill;
      if (tillVar > 0) totalTillOverage += tillVar;
      if (tillVar < 0) totalTillShortage += Math.abs(tillVar);

      const m1Net = m1G - (Number(s.m1Refund)||0);
      const m2Net = m2G - (Number(s.m2Refund)||0);
      const m3Net = m3G - (Number(s.m3Refund)||0);
      totalErpCardNet += (m1Net + m2Net + m3Net);
      
      const tillCardGross = Number(s.tillCardGross) || 0;
      const tillCardRefund = Number(s.tillCardRefund) || 0;
      totalTillCardNet += (tillCardGross - tillCardRefund);
    });

    const netTillVariance = totalTillOverage - totalTillShortage;
    if (netTillVariance > 0.01) addAmt(otherIncomeMap, 'Net Till Variance (Overage)', netTillVariance, 'cash');
    if (netTillVariance < -0.01) addAmtNested(expensesMap, 'Net Till Variance (Shortage)', 'System Adjustment', Math.abs(netTillVariance), 'cash');

    const netCardVariance = totalErpCardNet - totalTillCardNet;
    if (netCardVariance > 0.01) addAmt(otherIncomeMap, 'Net Card Variance (Overage)', netCardVariance, null);
    if (netCardVariance < -0.01) addAmtNested(expensesMap, 'Net Card Variance (Shortage)', 'System Adjustment', Math.abs(netCardVariance), null);

    validDelivery.forEach(d => {
       if (!d) return;
       const pName = d.platform || 'Unknown Platform';
       addAmt(promoMap, `${pName} - Commissions`, Number(d.commission)||0, 'memon');
       addAmt(promoMap, `${pName} - Advertisements`, Number(d.advertisement)||0, 'memon');
       addAmt(promoMap, `${pName} - Service Charges`, Number(d.serviceCharges)||0, 'memon');
       addAmt(promoMap, `${pName} - Refunds`, Number(d.refunds)||0, 'memon');
       
       const dVat = (Number(d.vatOnCommission)||0) + (Number(d.vatOnAdvertisement)||0) + (Number(d.vatOnServiceCharges)||0);
       addAmt(vatDeliveryMap, pName, dVat, 'memon');

       const pVar = (Number(d.actualPayout)||0) - (Number(d.expectedPayout)||0);
       if (pVar > 0) addAmt(otherIncomeMap, `Net Variance - ${pName} (Overage)`, pVar, 'memon');
       else if (pVar < 0) addAmtNested(expensesMap, `Net Variance - ${pName} (Shortage)`, 'System Adjustment', Math.abs(pVar), 'memon');
    });

    validPurchases.forEach(inv => { 
      if (!inv) return;
      const invVat = Number(inv.totalVat) || 0;
      
      const linkedPayments = validReceipts.filter(r => r.linkedInvoiceId === inv.id && r.type === 'Payment');

      // Distribute Purchase VAT based on Payment Source Split
      if (linkedPayments.length > 0) {
          const totalPaid = linkedPayments.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) || 1;
          linkedPayments.forEach(pay => {
             const payShare = (Number(pay.amount) || 0) / totalPaid;
             const shareVat = invVat * payShare;
             const col = getBankCol(pay.mode === 'Bank' ? pay.bankName : 'Cash in Hand');
             if (col && typeof vatPurchasesCols[col] !== 'undefined') {
                 vatPurchasesCols[col] += shareVat;
             } else {
                 vatPurchasesCols.cash += shareVat; // fallback to cash
             }
          });
          vatPurchasesCols.total += invVat;
      } else {
          vatPurchasesCols.total += invVat;
      }

      // Distribute Purchase Lines (Gross) based on Payment Source Split
      if (Array.isArray(inv.lines)) {
          inv.lines.forEach(line => { 
            if (line && line.account && isValidAccount(line.account)) {
               const category = categoriesMap[line.account] || ''; 
               const catLower = String(category).toLowerCase(); 
               const isAssetOrLiab = catLower === 'asset' || catLower.includes('liability') || catLower.includes('equity') || catLower.includes('deposit') || catLower.includes('equipment');
               
               if (!isAssetOrLiab) {
                   const grossAmt = Number(line.gross) || 0;
                   const isCogs = isCogsAccount(line.account, category);
                   const vendorName = inv.supplier || 'Unassigned Vendor';
                   
                   if (linkedPayments.length > 0) {
                       const totalPaid = linkedPayments.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) || 1;
                       linkedPayments.forEach(pay => {
                           const payShare = (Number(pay.amount) || 0) / totalPaid;
                           const shareAmt = grossAmt * payShare;
                           const col = getBankCol(pay.mode === 'Bank' ? pay.bankName : 'Cash in Hand');
                           if (isCogs) {
                               addAmtNested(cogsMap, line.account, vendorName, shareAmt, col);
                           } else {
                               addAmtNested(expensesMap, line.account, vendorName, shareAmt, col); 
                           }
                       });
                   } else {
                       if (isCogs) {
                           addAmtNested(cogsMap, line.account, vendorName, grossAmt, null);
                       } else {
                           addAmtNested(expensesMap, line.account, vendorName, grossAmt, null); 
                       }
                   }
               }
            }
          }); 
      }
    });

    validReceipts.forEach(r => { 
      if (!r) return;
      if (r.type === 'Payment') {
        if (!r.account || !isValidAccount(r.account)) return; 

        const accInfo = accountsDb.find(a => a && a.name.toLowerCase() === String(r.account).toLowerCase()); 
        const activeCategory = r.category || (accInfo ? accInfo.category : '');
        const cat = String(activeCategory).toLowerCase();
        
        if (cat.includes('payable') || cat.includes('supplier') || cat.includes('liability') || cat.includes('asset')) return; 
        
        const isExp = categoriesMap[r.account] === 'Expense' || cat.includes('expense') || cat.includes('cogs') || cat.includes('cost');
        if (isExp) {
            const isCogs = isCogsAccount(r.account, activeCategory);
            const colName = getBankCol(r.mode === 'Bank' ? r.bankName : 'Cash in Hand');
            const itemName = r.payee ? r.payee : 'Direct Financial Payment';
            addAmtNested(isCogs ? cogsMap : expensesMap, r.account, itemName, Number(r.amount), colName); 
        }
      } else if (r.type === 'Journal' || r.type === 'JV') {
        const processCompoundJv = (lines) => {
            const creditLegs = lines.filter(l => (Number(l.credit) || 0) > 0 && getBankCol(l.account));
            const debitLegs = lines.filter(l => (Number(l.debit) || 0) > 0);
            const totalCreditBankAmt = creditLegs.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);

            debitLegs.forEach(dLine => {
                const accName = dLine.account;
                if (!accName || !isValidAccount(accName)) return;
                const accInfo = accountsDb.find(a => a && a.name.toLowerCase() === String(accName).toLowerCase());
                if (!accInfo) return;
                const cat = String(accInfo.category || '').toLowerCase();
                if (cat.includes('payable') || cat.includes('supplier') || cat.includes('liability') || cat.includes('asset')) return;

                const isExp = categoriesMap[accName] === 'Expense' || cat.includes('expense') || cat.includes('cogs') || cat.includes('cost');
                if (!isExp) return;

                const isCogs = isCogsAccount(accName, accInfo.category);
                const debitAmt = Number(dLine.debit) || 0;
                const itemMemo = dLine.description || 'Journal Entry';

                if (creditLegs.length > 0 && totalCreditBankAmt > 0) {
                    creditLegs.forEach(cLine => {
                        const cAmt = Number(cLine.credit) || 0;
                        const proportion = cAmt / totalCreditBankAmt;
                        const splitAmt = debitAmt * proportion;
                        const col = getBankCol(cLine.account);
                        addAmtNested(isCogs ? cogsMap : expensesMap, accName, itemMemo, splitAmt, col);
                    });
                } else {
                    addAmtNested(isCogs ? cogsMap : expensesMap, accName, itemMemo, debitAmt, null);
                }
            });
        };

        if (r.lines && r.lines.length > 0) {
            processCompoundJv(r.lines);
        } else {
            const legacyLines = [
              { account: r.debitAccount, debit: r.amount, credit: 0, description: r.description },
              { account: r.creditAccount, debit: 0, credit: r.amount, description: r.description }
            ];
            processCompoundJv(legacyLines);
        }
      }
    });

    const aggregateMap = (map) => {
        const arr = Object.entries(map).map(([Account, cols]) => ({ Account, ...cols }));
        const totals = initCols();
        arr.forEach(row => { colKeys.forEach(c => totals[c] += (Number(row[c]) || 0)); });
        return { arr, totals };
    };

    const aggregateNestedMap = (map) => {
        const arr = Object.entries(map).map(([Category, data]) => {
            const itemsArr = Object.entries(data.items).map(([ItemName, cols]) => ({ ItemName, ...cols }));
            itemsArr.sort((a,b) => b.total - a.total);
            return { Category, subtotal: data.subtotal, items: itemsArr };
        });
        const totals = initCols();
        arr.forEach(cat => {
            colKeys.forEach(c => totals[c] += (Number(cat.subtotal[c]) || 0));
        });
        arr.sort((a,b) => a.Category.localeCompare(b.Category));
        return { arr, totals };
    };

    const sData = aggregateMap(salesMap);
    const rData = aggregateMap(refundsMap);
    const cData = aggregateNestedMap(cogsMap);
    const oiData = aggregateMap(otherIncomeMap);
    const pData = aggregateMap(promoMap);
    const eData = aggregateNestedMap(expensesMap);
    const vdData = aggregateMap(vatDeliveryMap);

    const netSalesCols = initCols();
    const totalIncomeCols = initCols();
    const grossProfitCols = initCols();
    const netProfitIncVatCols = initCols();
    const netVatAmountCols = initCols();
    const netProfitExcVatCols = initCols();

    colKeys.forEach(c => {
        netSalesCols[c] = (sData.totals[c]||0) - (rData.totals[c]||0);
        totalIncomeCols[c] = netSalesCols[c] + (oiData.totals[c]||0);
        grossProfitCols[c] = totalIncomeCols[c] - (cData.totals[c]||0);
        netProfitIncVatCols[c] = grossProfitCols[c] - (pData.totals[c]||0) - (eData.totals[c]||0);
        
        // Exact column-by-column VAT reduction
        netVatAmountCols[c] = (vatSalesCols[c]||0) - (vatPurchasesCols[c]||0) - (vdData.totals[c]||0);
        netProfitExcVatCols[c] = netProfitIncVatCols[c] - netVatAmountCols[c];
    });

    return { 
      sData, rData, cData, oiData, pData, eData, vdData, 
      vatSalesCols, vatPurchasesCols,
      netSalesCols, totalIncomeCols, grossProfitCols, 
      netProfitIncVatCols, netVatAmountCols, netProfitExcVatCols 
    };
  }, [salesDb, purchasesDb, receiptsDb, actualDeliveryDb, dateFrom, dateTo, categoriesMap, accountsDb, activeAccountNames]);

  const pnlDetailedHeaders = ['Account / Category Name', 'Cash', 'Memon Services', 'Khanani Mgt', 'LK Associates', 'Total £', 'Ratio'];
  const pnlCombinedHeaders = ['Account / Category Name', 'Amount (£)', 'Ratio'];

  const getActiveExportRows = (isCombined) => {
    let rows = [];
    const tg = pnlData.totalIncomeCols.total || 1; 

    const addSection = (title, dataObj, subtotalLabel) => {
      if (dataObj && dataObj.arr && dataObj.arr.length > 0) {
        rows.push([`--- ${title} ---`, ...Array(isCombined ? 2 : 6).fill('')]);
        dataObj.arr.forEach(r => {
          if (isCombined) rows.push([r.Account, fmtCol(r.total), calcRatio(r.total, tg)]);
          else rows.push([r.Account, fmtCol(r.cash), fmtCol(r.memon), fmtCol(r.khanani), fmtCol(r.lk), fmtCol(r.total), calcRatio(r.total, tg)]);
        });
        if (subtotalLabel) {
          if (isCombined) rows.push([subtotalLabel, fmtCol(dataObj.totals.total), calcRatio(dataObj.totals.total, tg)]);
          else rows.push([subtotalLabel, fmtCol(dataObj.totals.cash), fmtCol(dataObj.totals.memon), fmtCol(dataObj.totals.khanani), fmtCol(dataObj.totals.lk), fmtCol(dataObj.totals.total), calcRatio(dataObj.totals.total, tg)]);
        }
      }
    };

    const addNestedSection = (title, dataObj, subtotalLabel) => {
      if (dataObj && dataObj.arr && dataObj.arr.length > 0) {
        rows.push([`--- ${title} ---`, ...Array(isCombined ? 2 : 6).fill('')]);
        dataObj.arr.forEach(cat => {
          const isFlat = cat.items.every(i => genericItemNames.includes(i.ItemName));
          
          if (isFlat) {
            if (isCombined) rows.push([cat.Category, fmtCol(cat.subtotal.total), calcRatio(cat.subtotal.total, tg)]);
            else rows.push([cat.Category, fmtCol(cat.subtotal.cash), fmtCol(cat.subtotal.memon), fmtCol(cat.subtotal.khanani), fmtCol(cat.subtotal.lk), fmtCol(cat.subtotal.total), calcRatio(cat.subtotal.total, tg)]);
          } else {
            rows.push([`[Group] ${cat.Category}`, ...Array(isCombined ? 2 : 6).fill('')]);
            cat.items.forEach(item => {
              if (isCombined) rows.push([`    - ${item.ItemName}`, fmtCol(item.total), calcRatio(item.total, tg)]);
              else rows.push([`    - ${item.ItemName}`, fmtCol(item.cash), fmtCol(item.memon), fmtCol(item.khanani), fmtCol(item.lk), fmtCol(item.total), calcRatio(item.total, tg)]);
            });
            if (isCombined) rows.push([`Total ${cat.Category}`, fmtCol(cat.subtotal.total), calcRatio(cat.subtotal.total, tg)]);
            else rows.push([`Total ${cat.Category}`, fmtCol(cat.subtotal.cash), fmtCol(cat.subtotal.memon), fmtCol(cat.subtotal.khanani), fmtCol(cat.subtotal.lk), fmtCol(cat.subtotal.total), calcRatio(cat.subtotal.total, tg)]);
          }
        });
        if (subtotalLabel) {
          if (isCombined) rows.push([subtotalLabel, fmtCol(dataObj.totals.total), calcRatio(dataObj.totals.total, tg)]);
          else rows.push([subtotalLabel, fmtCol(dataObj.totals.cash), fmtCol(dataObj.totals.memon), fmtCol(dataObj.totals.khanani), fmtCol(dataObj.totals.lk), fmtCol(dataObj.totals.total), calcRatio(dataObj.totals.total, tg)]);
        }
      }
    };

    const addSub = (title, totalsObj) => {
        if (isCombined) rows.push([title, fmtCol(totalsObj.total), calcRatio(totalsObj.total, tg)]);
        else rows.push([title, fmtCol(totalsObj.cash), fmtCol(totalsObj.memon), fmtCol(totalsObj.khanani), fmtCol(totalsObj.lk), fmtCol(totalsObj.total), calcRatio(totalsObj.total, tg)]);
    }

    addSection('GROSS SALES', pnlData.sData, 'Total Gross Sales');
    addSection('LESS: REFUNDS', pnlData.rData, 'Total Refunds');
    addSub('NET SALES', pnlData.netSalesCols);
    rows.push([...Array(isCombined ? 3 : 7).fill('')]);

    if (pnlData.oiData.arr.length > 0) {
      addSection('OTHER INCOME (POSITIVE VARIANCES)', pnlData.oiData, 'Total Other Income');
      addSub('TOTAL INCOME', pnlData.totalIncomeCols);
      rows.push([...Array(isCombined ? 3 : 7).fill('')]);
    }

    addNestedSection('COST OF GOODS SOLD (COGS) & PURCHASES', pnlData.cData, 'Total COGS & Purchases');
    addSub('GROSS PROFIT', pnlData.grossProfitCols);
    rows.push([...Array(isCombined ? 3 : 7).fill('')]);
    
    addSection('PLATFORM FEES & DEDUCTIONS', pnlData.pData, 'Total Platform Fees');
    addNestedSection('OPERATING EXPENSES (INC. NEGATIVE VARIANCES)', pnlData.eData, 'Total Operating Expenses');
    addSub('NET PROFIT INCLUSIVE VAT', pnlData.netProfitIncVatCols);
    rows.push([...Array(isCombined ? 3 : 7).fill('')]);

    // EXPORT VAT CALCULATION
    rows.push(['--- VAT CALCULATION ---', ...Array(isCombined ? 2 : 6).fill('')]);
    
    if (isCombined) rows.push(['VAT Collected on Sales', fmtCol(pnlData.vatSalesCols.total), calcRatio(pnlData.vatSalesCols.total, tg)]);
    else rows.push(['VAT Collected on Sales', '-', '-', '-', '-', fmtCol(pnlData.vatSalesCols.total), calcRatio(pnlData.vatSalesCols.total, tg)]);

    if (isCombined) rows.push(['Less: VAT Paid on Purchases and Expenses', fmtCol(pnlData.vatPurchasesCols.total), calcRatio(pnlData.vatPurchasesCols.total, tg)]);
    else rows.push(['Less: VAT Paid on Purchases and Expenses', fmtCol(pnlData.vatPurchasesCols.cash), fmtCol(pnlData.vatPurchasesCols.memon), fmtCol(pnlData.vatPurchasesCols.khanani), fmtCol(pnlData.vatPurchasesCols.lk), fmtCol(pnlData.vatPurchasesCols.total), calcRatio(pnlData.vatPurchasesCols.total, tg)]);

    rows.push(['[Group] Less: VAT Collected by Platforms', ...Array(isCombined ? 2 : 6).fill('')]);
    pnlData.vdData.arr.forEach(r => {
        if (isCombined) rows.push([`    - ${r.Account}`, fmtCol(r.total), calcRatio(r.total, tg)]);
        else rows.push([`    - ${r.Account}`, fmtCol(r.cash), fmtCol(r.memon), fmtCol(r.khanani), fmtCol(r.lk), fmtCol(r.total), calcRatio(r.total, tg)]);
    });

    if (isCombined) rows.push(['Total VAT Collected by Platforms', fmtCol(pnlData.vdData.totals.total), calcRatio(pnlData.vdData.totals.total, tg)]);
    else rows.push(['Total VAT Collected by Platforms', fmtCol(pnlData.vdData.totals.cash), fmtCol(pnlData.vdData.totals.memon), fmtCol(pnlData.vdData.totals.khanani), fmtCol(pnlData.vdData.totals.lk), fmtCol(pnlData.vdData.totals.total), calcRatio(pnlData.vdData.totals.total, tg)]);

    if (isCombined) rows.push(['NET VAT AMOUNT', fmtCol(pnlData.netVatAmountCols.total), calcRatio(pnlData.netVatAmountCols.total, tg)]);
    else rows.push(['NET VAT AMOUNT', fmtCol(pnlData.netVatAmountCols.cash), fmtCol(pnlData.netVatAmountCols.memon), fmtCol(pnlData.netVatAmountCols.khanani), fmtCol(pnlData.netVatAmountCols.lk), fmtCol(pnlData.netVatAmountCols.total), calcRatio(pnlData.netVatAmountCols.total, tg)]);

    rows.push([...Array(isCombined ? 3 : 7).fill('')]);
    
    if (isCombined) rows.push(['NET PROFIT EXCLUSIVE VAT', fmtCol(pnlData.netProfitExcVatCols.total), calcRatio(pnlData.netProfitExcVatCols.total, tg)]);
    else rows.push(['NET PROFIT EXCLUSIVE VAT', fmtCol(pnlData.netProfitExcVatCols.cash), fmtCol(pnlData.netProfitExcVatCols.memon), fmtCol(pnlData.netProfitExcVatCols.khanani), fmtCol(pnlData.netProfitExcVatCols.lk), fmtCol(pnlData.netProfitExcVatCols.total), calcRatio(pnlData.netProfitExcVatCols.total, tg)]);

    return rows;
  };

  const deliveryAuditData = useMemo(() => {
    const validDelivery = (actualDeliveryDb || []).filter(d => {
       if (!d) return false;
       const settleDate = normalizeDate(d.payoutDate || d.date || d.dateTo || d.dateFrom || getToday());
       return toDateObj(settleDate) >= toDateObj(dateFrom) && toDateObj(settleDate) <= toDateObj(dateTo);
    });

    const list = [];
    validDelivery.forEach(d => {
        if (auditPlatformFilter !== 'All' && d.platform !== auditPlatformFilter) return;
        
        const dateStr = formatDate(d.payoutDate || d.date || d.dateTo || d.dateFrom || getToday());
        const plat = d.platform || 'Unknown Platform';

        const adjP = Number(d.adjustmentPositive) || 0;
        const adjN = Number(d.adjustmentNegative) || 0;
        
        const posReason = d.adjustmentPositiveReason || '';
        const negReason = d.adjustmentNegativeReason || '';
        const generalReason = d.adjustmentReason || d.adjustmentNotes || d.reason || d.notes || d.comment || d.remarks || d.description || d.details || '';

        let finalReason = '';
        if (adjP > 0 && posReason) finalReason += posReason;
        if (adjN > 0 && negReason) {
            if (finalReason) finalReason += ' | ';
            finalReason += negReason;
        }
        if (!finalReason) {
            finalReason = generalReason;
        }

        if (Math.abs(adjP) > 0.01 || Math.abs(adjN) > 0.01) {
            list.push({ 
              date: dateStr, 
              platform: plat, 
              positive: Math.abs(adjP) > 0.01 ? adjP : 0, 
              negative: Math.abs(adjN) > 0.01 ? adjN : 0, 
              reason: String(finalReason).trim() !== '' ? String(finalReason).trim() : '-' 
            });
        }
    });

    return list;
  }, [actualDeliveryDb, dateFrom, dateTo, auditPlatformFilter]);

  const deliveryAuditTotals = useMemo(() => {
    let totPos = 0;
    let totNeg = 0;
    deliveryAuditData.forEach(r => {
      totPos += r.positive;
      totNeg += r.negative;
    });
    return { totPos, totNeg, net: totPos - totNeg };
  }, [deliveryAuditData]);

  const handleExportDeliveryAudit = (format) => {
    const title = "Delivery Adjustments Audit Report";
    const headers = ['Date', 'Platform', 'Positive Adjustment (£)', 'Negative Adjustment (£)', 'Reason / Notes'];
    const rows = deliveryAuditData.map(r => [
      r.date, 
      r.platform, 
      r.positive > 0 ? fmtMoney(r.positive) : '-', 
      r.negative > 0 ? fmtMoney(r.negative) : '-', 
      r.reason
    ]);
    
    rows.push(['TOTALS', '', fmtMoney(deliveryAuditTotals.totPos), fmtMoney(deliveryAuditTotals.totNeg), '']);
    rows.push(['NET BALANCE (Net-Off)', '', '', '', `£ ${fmtMoney(deliveryAuditTotals.net)} (${deliveryAuditTotals.net >= 0 ? 'Net Positive' : 'Net Negative'})`]);

    handleExport(format, title, headers, rows, 'l');
  };

  const unifiedLedger = useMemo(() => {
    const bals = {};
    const getType = (acc) => {
        const lower = String(acc || '').toLowerCase();
        if (lower.includes('vat input')) return 'Asset';
        if (lower.includes('vat output')) return 'Liability';
        if (categoriesMap[acc]) return categoriesMap[acc]; 
        if (lower.includes('reclaimable')) return 'Asset';
        if (lower.includes('payable') || lower.includes('liability')) return 'Liability';
        if (lower.includes('sales revenue') || lower.includes('income') || lower.includes('overage')) return 'Income';
        if (lower.includes('expense') || lower.includes('shortage') || lower.includes('commission') || lower.includes('advertisement') || lower.includes('service') || lower.includes('refund') || lower.includes('petty cash')) return 'Expense';
        if (lower.includes('equity') || lower.includes('drawings') || lower.includes('retained')) return 'Equity';
        return 'Asset'; 
    };

    const getAccName = (name) => {
        if (!name) return 'Unknown Account';
        if (name === 'Safe Box (Main Cash)') return 'Pending Safe Box Collections';
        return name;
    };

    const post = (rawAcc, dr, cr) => {
        const acc = getAccName(rawAcc);
        if (!bals[acc]) bals[acc] = { dr: 0, cr: 0, type: getType(rawAcc) };
        bals[acc].dr += (dr || 0);
        bals[acc].cr += (cr || 0);
    };

    let openDr = 0; let openCr = 0;
    (accountsDb || []).forEach(a => {
        if (!a) return;
        const amt = Number(a.balance) || 0;
        const t = categoriesMap[a.name] || 'Asset';
        if (t === 'Asset' || t === 'Expense') { post(a.name, amt, 0); openDr += amt; }
        else { post(a.name, 0, amt); openCr += amt; }
    });
    if (openDr > openCr) post('Retained Earnings', 0, openDr - openCr);
    else if (openCr > openDr) post('Retained Earnings', openCr - openDr, 0);

    const targetDateObj = toDateObj(dateTo);

    (salesDb || []).forEach(s => {
        if (!s || toDateObj(s.date) > targetDateObj) return;
        const cashNet = (Number(s.cashGross)||0) - (Number(s.cashRefund)||0);
        const m1Net = (Number(s.m1Gross)||0) - (Number(s.m1Refund)||0);
        const m2Net = (Number(s.m2Gross)||0) - (Number(s.m2Refund)||0);
        const m3Net = (Number(s.m3Gross)||0) - (Number(s.m3Refund)||0);
        const uber = Number(s.uber)||0; const del = Number(s.deliveroo)||0; 
        const je = Number(s.justEat)||0; const app4 = Number(s.app4)||0; 
        const otherDel = Number(s.otherDel)||0;
        const vat = Number(s.vatAmount)||Number(s.totalVat)||Number(s.vatCollected)||Number(s.vat)||0;
        const netSales = cashNet + m1Net + m2Net + m3Net + uber + del + je + app4 + otherDel - vat;

        post('Physical Till Drawer', cashNet, 0);
        post('Memon Services Ltd', m1Net, 0);
        post('Khanani Management', m2Net, 0);
        post('LK Associates', m3Net, 0);
        post('Uber Eats', uber, 0);
        post('Deliveroo', del, 0);
        post('Just Eat', je, 0);
        post('App4', app4, 0);
        post('Other Delivery', otherDel, 0);
        
        if (netSales > 0) post('Sales Revenue', 0, netSales); 
        else if (netSales < 0) post('Sales Revenue', Math.abs(netSales), 0);
        
        post('VAT Output (Sales)', 0, vat);

        const drop = Number(s.safeBox)||0; 
        const coll = Number(s.collections)||0;
        
        if (drop > 0) { post('Safe Box (Main Cash)', drop, 0); post('Physical Till Drawer', 0, drop); }
        if (coll > 0) { post('Purchases', coll, 0); post('Physical Till Drawer', 0, coll); }

        const expected = (Number(s.openingTill)||0) + cashNet - coll - drop;
        const actual = Number(s.physicalTill)||0;
        const variance = actual - expected;
        if (variance > 0) { post('Physical Till Drawer', variance, 0); post('Till Overage (Income)', 0, variance); }
        if (variance < 0) { post('Till Shortage (Expense)', Math.abs(variance), 0); post('Physical Till Drawer', 0, Math.abs(variance)); }
    });

    (purchasesDb || []).forEach(p => {
        if (!p || toDateObj(p.date) > targetDateObj) return;
        const gross = Number(p.totalGross)||0; 
        const vat = Number(p.totalVat)||0; 
        const net = Number(p.totalNet)||0;
        
        post(p.supplier || 'Unknown Supplier', 0, gross);
        post('VAT Input (Purchases)', vat, 0);
        
        if (Array.isArray(p.lines) && p.lines.length > 0) {
            let linesTotal = 0;
            p.lines.forEach(l => { 
                if (!l) return;
                const lNet = ((Number(l.gross)||0) - (Number(l.vat)||0)); 
                post(l.account || 'Uncategorized Expense', lNet, 0); 
                linesTotal += lNet; 
            });
            if (Math.abs(linesTotal - net) > 0.01) post('Uncategorized Expense', net - linesTotal, 0);
        } else {
            post('Uncategorized Expense', net, 0);
        }
    });

    (receiptsDb || []).forEach(r => {
        if (!r || toDateObj(r.date) > targetDateObj) return;
        
        if (r.type === 'Transfer' && String(r.description).includes('Auto-Collected')) {
            post('Cash in Hand', Number(r.amount), 0); 
            post('Safe Box (Main Cash)', 0, Number(r.amount));
        } else if (r.type === 'Transfer') {
            post(r.toBank || 'Unknown Account', Number(r.amount), 0); 
            post(r.fromBank || 'Unknown Account', 0, Number(r.amount));
        } else if (r.type === 'Journal' || r.type === 'JV') {
            if (r.lines && r.lines.length > 0) {
                r.lines.forEach(line => {
                    const debitAmt = Number(line.debit) || 0;
                    const creditAmt = Number(line.credit) || 0;
                    if (debitAmt > 0) post(line.account || 'Unknown Account', debitAmt, 0);
                    if (creditAmt > 0) post(line.account || 'Unknown Account', 0, creditAmt);
                });
            } else {
                post(r.debitAccount || 'Unknown Account', Number(r.amount), 0);
                post(r.creditAccount || 'Unknown Account', 0, Number(r.amount));
            }
        } else if (r.type === 'Receipt') {
            post(r.mode === 'Bank' ? (r.bankName || 'Unknown Account') : 'Cash in Hand', Number(r.amount), 0); 
            post(r.account || 'Unknown Account', 0, Number(r.amount));
        } else if (r.type === 'Payment') {
            post(r.account || 'Unknown Account', Number(r.amount), 0); 
            post(r.mode === 'Bank' ? (r.bankName || 'Unknown Account') : 'Cash in Hand', 0, Number(r.amount));
        }
    });

    (actualDeliveryDb || []).forEach(d => {
        if (!d) return;
        const settleDate = normalizeDate(d.payoutDate || d.date || d.dateTo || d.dateFrom || getToday());
        if (toDateObj(settleDate) > targetDateObj) return;
        
        const plat = d.platform || 'Unknown Platform';
        const erpGross = Number(d.grossSales)||0; 
        const comm = Number(d.commission)||0; 
        const vatComm = Number(d.vatOnCommission)||0; 
        const adv = Number(d.advertisement)||0; 
        const vatAdv = Number(d.vatOnAdvertisement)||0; 
        const serv = Number(d.serviceCharges)||0; 
        const vatServ = Number(d.vatOnServiceCharges)||0; 
        const ref = Number(d.refunds)||0; 
        const expected = Number(d.expectedPayout)||0; 
        const actual = Number(d.actualPayout)||0; 
        const variance = actual - expected;

        post(plat, 0, erpGross);
        post('Platform Commission', comm, 0); 
        post('VAT Input (Delivery Platforms)', vatComm, 0); 
        post('Platform Advertisement', adv, 0); 
        post('VAT Input (Delivery Platforms)', vatAdv, 0); 
        post('Platform Service Charges', serv, 0); 
        post('VAT Input (Delivery Platforms)', vatServ, 0); 
        post('Sales Refunds', ref, 0); 
        
        if (variance > 0) post('Delivery Payout Variance (Income)', 0, variance);
        else if (variance < 0) post('Delivery Payout Variance (Expense)', Math.abs(variance), 0);
    });

    const sortedSales = [...(salesDb || [])].sort((a,b) => {
        const dA = normalizeDate(a?.date);
        const dB = normalizeDate(b?.date);
        if (dA < dB) return -1;
        if (dA > dB) return 1;
        return 0;
    });
    const validSales = sortedSales.filter(r => r && toDateObj(r.date) <= targetDateObj);
    const endRecord = validSales.length > 0 ? validSales[validSales.length - 1] : null;
    const targetTill = endRecord ? (Number(endRecord.physicalTill) || 0) : 0;
    
    const currentTill = (bals['Physical Till Drawer']?.dr || 0) - (bals['Physical Till Drawer']?.cr || 0);
    const tillDiff = targetTill - currentTill;
    if (Math.abs(tillDiff) > 0.01) {
        if (tillDiff > 0) { post('Physical Till Drawer', tillDiff, 0); post('Opening Balance Equity', 0, tillDiff); }
        else { post('Physical Till Drawer', 0, Math.abs(tillDiff)); post('Opening Balance Equity', Math.abs(tillDiff), 0); }
    }

    const targetSafe = validSales.filter(d => {
        if (!d) return false;
        const amt = Number(d.safeBox) || 0;
        if (amt <= 0) return false;
        const rawDate = d.safeBoxDate || d.safeBoxColDate;
        if (!rawDate || String(rawDate).trim() === '') return true;
        if (toDateObj(normalizeDate(rawDate)) > targetDateObj) return true;
        return false;
    }).reduce((sum, item) => sum + (Number(item.safeBox) || 0), 0);

    const currentSafe = (bals['Pending Safe Box Collections']?.dr || 0) - (bals['Pending Safe Box Collections']?.cr || 0);
    const safeDiff = targetSafe - currentSafe;
    if (Math.abs(safeDiff) > 0.01) {
        if (safeDiff > 0) { post('Safe Box (Main Cash)', safeDiff, 0); post('Opening Balance Equity', 0, safeDiff); }
        else { post('Safe Box (Main Cash)', 0, Math.abs(safeDiff)); post('Opening Balance Equity', Math.abs(safeDiff), 0); }
    }

    return bals;
  }, [salesDb, purchasesDb, receiptsDb, actualDeliveryDb, accountsDb, categoriesMap, dateTo]);

  const { tbRows, bsAssets, bsLiabs, bsEquity, bsTotals } = useMemo(() => {
    const trialBalanceRows = [];
    let totDr = 0, totCr = 0;
    
    Object.keys(unifiedLedger).sort().forEach(acc => {
        const net = unifiedLedger[acc].dr - unifiedLedger[acc].cr;
        if (Math.abs(net) < 0.01) return;
        let dr = 0, cr = 0;
        if (net > 0) dr = net; else cr = -net;
        totDr += dr; totCr += cr;
        trialBalanceRows.push({ Account: acc, Type: unifiedLedger[acc].type, Debit: dr, Credit: cr });
    });

    let currentPeriodProfit = 0;
    trialBalanceRows.forEach(r => {
        if (r.Type === 'Income') currentPeriodProfit += (r.Credit - r.Debit);
        if (r.Type === 'Expense') currentPeriodProfit -= (r.Debit - r.Credit);
    });

    const assets = trialBalanceRows.filter(r => r.Type === 'Asset');
    const liabilities = trialBalanceRows.filter(r => r.Type === 'Liability');
    const equity = trialBalanceRows.filter(r => r.Type === 'Equity');
    
    const totalAssets = assets.reduce((sum, r) => sum + r.Debit - r.Credit, 0);
    const totalLiabs = liabilities.reduce((sum, r) => sum + r.Credit - r.Debit, 0);
    const baseEquity = equity.reduce((sum, r) => sum + r.Credit - r.Debit, 0);
    const totalEquity = baseEquity + currentPeriodProfit;
    const discrepancy = totalAssets - (totalLiabs + totalEquity);

    return { 
      tbRows: trialBalanceRows, tbTotDr: totDr, tbTotCr: totCr, bsAssets: assets, bsLiabs: liabilities, bsEquity: equity,
      bsTotals: { assets: totalAssets, liabs: totalLiabs, equity: totalEquity, profit: currentPeriodProfit, discrepancy }
    };
  }, [unifiedLedger]);

  const handleExportTB = (format) => {
    const title = "Trial Balance Statement"; 
    const headers = ['Account Name', 'Account Type', 'Debit Balance (£)', 'Credit Balance (£)'];
    const rows = tbRows.map(r => ({ 'Account Name': r.Account, 'Account Type': r.Type, 'Debit Balance (£)': r.Debit > 0 ? fmtMoney(r.Debit) : '-', 'Credit Balance (£)': r.Credit > 0 ? fmtMoney(r.Credit) : '-' }));
    handleExport(format, title, headers, rows, 'p'); 
  };

  const handleExportBS = (format) => {
    const title = "Balance Sheet"; 
    const headers = ['Classification', 'Account Name', 'Amount (£)']; 
    const rows = [];
    rows.push(['ASSETS', '', '']); 
    bsAssets.forEach(r => rows.push(['', r.Account, fmtMoney(r.Debit - r.Credit)])); 
    rows.push(['Total Assets', '', fmtMoney(bsTotals.assets)]);
    
    rows.push(['LIABILITIES', '', '']); 
    bsLiabs.forEach(r => rows.push(['', r.Account, fmtMoney(r.Credit - r.Debit)])); 
    rows.push(['Total Liabilities', '', fmtMoney(bsTotals.liabs)]);
    
    rows.push(['EQUITY', '', '']); 
    bsEquity.forEach(r => rows.push(['', r.Account, fmtMoney(r.Credit - r.Debit)])); 
    rows.push(['', 'Net Profit (Current Period)', fmtMoney(bsTotals.profit)]); 
    rows.push(['Total Equity', '', fmtMoney(bsTotals.equity)]); 
    
    rows.push(['Total Liabilities & Equity', '', fmtMoney(bsTotals.liabs + bsTotals.equity)]);
    handleExport(format, title, headers, rows, 'p');
  };

  const theme = { bg: '#ffffff', cardBg: '#ffffff', textMain: '#000000', textMuted: '#000000', primary: '#0ea5e9', border: '#cbd5e1' };
  const uiRatioBase = pnlData.totalIncomeCols.total || 1;

  const renderPnlSection = (title, dataObj, isCombined, customColor = '', subtotalLabel = '') => {
    if (!dataObj || !dataObj.arr || dataObj.arr.length === 0) return null;
    return (
      <React.Fragment>
        <tr style={{ background: '#f8fafc' }}>
          <td colSpan={isCombined ? 3 : 7} style={{ padding: '10px 14px', fontWeight: '900', fontSize: '12px', color: customColor || '#000' }}>--- {title} ---</td>
        </tr>
        {dataObj.arr.map((r, i) => (
          <tr key={`${title}-${i}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
            <td style={{ padding: '10px 14px', fontWeight: '800', fontSize: '12px' }}>{r.Account}</td>
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(r.cash)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(r.memon)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(r.khanani)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(r.lk)}</td>}
            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: customColor || '#000' }}>{fmtCol(r.total)}</td>
            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{calcRatio(r.total, uiRatioBase)}</td>
          </tr>
        ))}
        {subtotalLabel && (
          <tr style={{ background: '#fef9c3', borderTop: `1px solid ${theme.border}`, borderBottom: `2px solid ${theme.border}` }}>
            <td style={{ padding: '10px 14px', fontWeight: '900', fontSize: '12px', color: '#000' }}>{subtotalLabel}</td>
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.cash)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.memon)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.khanani)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.lk)}</td>}
            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.total)}</td>
            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{calcRatio(dataObj.totals.total, uiRatioBase)}</td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const renderPnlNestedSection = (title, dataObj, isCombined, customColor = '', subtotalLabel = '') => {
    if (!dataObj || !dataObj.arr || dataObj.arr.length === 0) return null;
    return (
      <React.Fragment>
        <tr style={{ background: '#f8fafc' }}>
          <td colSpan={isCombined ? 3 : 7} style={{ padding: '10px 14px', fontWeight: '900', fontSize: '12px', color: customColor || '#000' }}>--- {title} ---</td>
        </tr>
        {dataObj.arr.map((cat, i) => {
          const isFlat = cat.items.every(item => genericItemNames.includes(item.ItemName));

          if (isFlat) {
            return (
              <tr key={`${title}-${i}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                <td style={{ padding: '10px 14px', fontWeight: '800', fontSize: '12px' }}>{cat.Category}</td>
                {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(cat.subtotal.cash)}</td>}
                {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(cat.subtotal.memon)}</td>}
                {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(cat.subtotal.khanani)}</td>}
                {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(cat.subtotal.lk)}</td>}
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: customColor || '#000' }}>{fmtCol(cat.subtotal.total)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{calcRatio(cat.subtotal.total, uiRatioBase)}</td>
              </tr>
            );
          }

          return (
            <React.Fragment key={`${title}-${i}`}>
              <tr style={{ background: '#f1f5f9', borderTop: `1px solid ${theme.border}` }}>
                <td style={{ padding: '8px 14px', fontWeight: '800', fontSize: '12px', color: '#334155' }}>{cat.Category}</td>
                <td colSpan={isCombined ? 2 : 6}></td>
              </tr>
              {cat.items.map((item, j) => (
                <tr key={`${title}-${i}-${j}`} style={{ borderBottom: `1px solid ${theme.border}`, background: '#fff' }}>
                  <td style={{ padding: '8px 14px 8px 32px', fontWeight: '600', fontSize: '12px', color: '#475569' }}>  - {item.ItemName}</td>
                  {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px' }}>{fmtCol(item.cash)}</td>}
                  {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px' }}>{fmtCol(item.memon)}</td>}
                  {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px' }}>{fmtCol(item.khanani)}</td>}
                  {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px' }}>{fmtCol(item.lk)}</td>}
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: customColor || '#000' }}>{fmtCol(item.total)}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px' }}>{calcRatio(item.total, uiRatioBase)}</td>
                </tr>
              ))}
              <tr style={{ borderBottom: `1px solid ${theme.border}`, background: '#f8fafc' }}>
                <td style={{ padding: '8px 14px 8px 14px', fontWeight: '800', fontSize: '12px', color: '#0f172a' }}>Total {cat.Category}</td>
                {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px' }}>{fmtCol(cat.subtotal.cash)}</td>}
                {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px' }}>{fmtCol(cat.subtotal.memon)}</td>}
                {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px' }}>{fmtCol(cat.subtotal.khanani)}</td>}
                {!isCombined && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px' }}>{fmtCol(cat.subtotal.lk)}</td>}
                <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: customColor || '#000' }}>{fmtCol(cat.subtotal.total)}</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px' }}>{calcRatio(cat.subtotal.total, uiRatioBase)}</td>
              </tr>
            </React.Fragment>
          );
        })}
        {subtotalLabel && (
          <tr style={{ background: '#fef9c3', borderTop: `1px solid ${theme.border}`, borderBottom: `2px solid ${theme.border}` }}>
            <td style={{ padding: '10px 14px', fontWeight: '900', fontSize: '12px', color: '#000' }}>{subtotalLabel}</td>
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.cash)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.memon)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.khanani)}</td>}
            {!isCombined && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.lk)}</td>}
            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(dataObj.totals.total)}</td>
            <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{calcRatio(dataObj.totals.total, uiRatioBase)}</td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const renderSubtotal = (label, totalsObj, isCombined, customColor = '', isGrandTotal = false) => (
    <tr style={{ background: isGrandTotal ? '#dcfce7' : '#dcfce7', borderTop: isGrandTotal ? `2px solid #166534` : `2px solid #166534`, borderBottom: isGrandTotal ? `2px solid #166534` : `2px solid #166534` }}>
        <td style={{ padding: '12px 14px', fontWeight: '900', fontSize: '13px', color: '#000' }}>{label}</td>
        {!isCombined && <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '13px', color: '#000' }}>{totalsObj.cash !== undefined ? fmtCol(totalsObj.cash) : '-'}</td>}
        {!isCombined && <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '13px', color: '#000' }}>{totalsObj.memon !== undefined ? fmtCol(totalsObj.memon) : '-'}</td>}
        {!isCombined && <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '13px', color: '#000' }}>{totalsObj.khanani !== undefined ? fmtCol(totalsObj.khanani) : '-'}</td>}
        {!isCombined && <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '13px', color: '#000' }}>{totalsObj.lk !== undefined ? fmtCol(totalsObj.lk) : '-'}</td>}
        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '14px', color: '#000' }}>{fmtCol(totalsObj.total !== undefined ? totalsObj.total : totalsObj)}</td>
        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '13px', color: '#000' }}>{calcRatio(totalsObj.total !== undefined ? totalsObj.total : totalsObj, uiRatioBase)}</td>
    </tr>
  );

  return (
    <div style={{ background: theme.bg, minHeight: '100vh', fontFamily: '"Inter", sans-serif', color: theme.textMain, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${theme.border}`, paddingBottom: '16px', marginBottom: '20px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '900', color: '#000', letterSpacing: '-0.5px' }}>Financial Statements</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', fontWeight: '700', color: theme.textMuted }}>Core accounting statements generated from the double-entry ledger.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {financialsTab === 'pnl_detailed' && (
              <>
                <button onClick={() => handleExport('excel', 'Profit & Loss (Detailed)', pnlDetailedHeaders, getActiveExportRows(false), 'l')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileSpreadsheet size={14} color="#10b981" /> Export Excel</button>
                <button onClick={() => handleExport('pdf', 'Profit & Loss (Detailed)', pnlDetailedHeaders, getActiveExportRows(false), 'l')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileText size={14} color="#ef4444" /> Export PDF</button>
              </>
            )}
            {financialsTab === 'pnl_combined' && (
              <>
                <button onClick={() => handleExport('excel', 'Profit & Loss (Combined)', pnlCombinedHeaders, getActiveExportRows(true), 'l')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileSpreadsheet size={14} color="#10b981" /> Export Excel</button>
                <button onClick={() => handleExport('pdf', 'Profit & Loss (Combined)', pnlCombinedHeaders, getActiveExportRows(true), 'l')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileText size={14} color="#ef4444" /> Export PDF</button>
              </>
            )}
            {financialsTab === 'tb' && (
              <>
                <button onClick={() => handleExportTB('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileSpreadsheet size={14} color="#10b981" /> Export Excel</button>
                <button onClick={() => handleExportTB('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileText size={14} color="#ef4444" /> Export PDF</button>
              </>
            )}
            {financialsTab === 'bs' && (
              <>
                <button onClick={() => handleExportBS('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileSpreadsheet size={14} color="#10b981" /> Export Excel</button>
                <button onClick={() => handleExportBS('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileText size={14} color="#ef4444" /> Export PDF</button>
              </>
            )}
            {financialsTab === 'delivery_audit' && (
              <>
                <button onClick={() => handleExportDeliveryAudit('excel')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileSpreadsheet size={14} color="#10b981" /> Export Excel</button>
                <button onClick={() => handleExportDeliveryAudit('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: '#f8fafc', color: '#000', border: `1px solid ${theme.border}`, borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}><FileText size={14} color="#ef4444" /> Export PDF</button>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', background: '#f8fafc', padding: '16px 20px', borderRadius: '8px', border: `1px solid ${theme.border}`, marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date From</label>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '0 10px' }}>
              <Calendar size={14} color={theme.textMuted} />
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: 'none', outline: 'none', padding: '8px', fontWeight: '800', fontSize: '13px', color: theme.textMain, background: 'transparent' }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: '800', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date To</label>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '0 10px' }}>
              <Calendar size={14} color={theme.textMuted} />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: 'none', outline: 'none', padding: '8px', fontWeight: '800', fontSize: '13px', color: theme.textMain, background: 'transparent' }} />
            </div>
          </div>
        </div>

        <div style={{ background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: '8px', padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, background: '#f8fafc', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setFinancialsTab('pnl_detailed')} style={{ padding: '6px 14px', background: financialsTab === 'pnl_detailed' ? theme.textMain : 'transparent', color: financialsTab === 'pnl_detailed' ? '#fff' : theme.textMuted, border: `1px solid ${financialsTab === 'pnl_detailed' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}>Profit & Loss (Detailed)</button>
            <button onClick={() => setFinancialsTab('pnl_combined')} style={{ padding: '6px 14px', background: financialsTab === 'pnl_combined' ? theme.textMain : 'transparent', color: financialsTab === 'pnl_combined' ? '#fff' : theme.textMuted, border: `1px solid ${financialsTab === 'pnl_combined' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}>Profit & Loss (Combined)</button>
            <button onClick={() => setFinancialsTab('tb')} style={{ padding: '6px 14px', background: financialsTab === 'tb' ? theme.textMain : 'transparent', color: financialsTab === 'tb' ? '#fff' : theme.textMuted, border: `1px solid ${financialsTab === 'tb' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}>Trial Balance</button>
            <button onClick={() => setFinancialsTab('bs')} style={{ padding: '6px 14px', background: financialsTab === 'bs' ? theme.textMain : 'transparent', color: financialsTab === 'bs' ? '#fff' : theme.textMuted, border: `1px solid ${financialsTab === 'bs' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}>Balance Sheet</button>
            <button onClick={() => setFinancialsTab('delivery_audit')} style={{ padding: '6px 14px', background: financialsTab === 'delivery_audit' ? theme.textMain : 'transparent', color: financialsTab === 'delivery_audit' ? '#fff' : theme.textMuted, border: `1px solid ${financialsTab === 'delivery_audit' ? theme.textMain : theme.border}`, borderRadius: '20px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}>Delivery Adjustments Audit</button>
          </div>

          {(financialsTab === 'pnl_detailed' || financialsTab === 'pnl_combined') && (() => {
            const isComb = financialsTab === 'pnl_combined';
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '20px', background: '#f8fafc', borderBottom: `1px solid ${theme.border}`, flexWrap: 'wrap' }}>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, minWidth: '160px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', marginBottom: '8px' }}>Net Sales</div>
                    <div style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>£ {fmtCol(pnlData.netSalesCols.total)}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, minWidth: '160px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#ea580c', textTransform: 'uppercase', marginBottom: '8px' }}>Purchases & Expenses</div>
                    <div style={{ fontSize: '18px', fontWeight: '900', color: '#c2410c' }}>£ {fmtCol((pnlData.cData?.totals.total || 0) + (pnlData.eData?.totals.total || 0))}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, minWidth: '160px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#9333ea', textTransform: 'uppercase', marginBottom: '8px' }}>VAT Collected</div>
                    <div style={{ fontSize: '18px', fontWeight: '900', color: '#7e22ce' }}>£ {fmtCol(pnlData.totalVatSales)}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `1px solid ${theme.border}`, minWidth: '160px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#0284c7', textTransform: 'uppercase', marginBottom: '8px' }}>Net Profit (Inc. VAT)</div>
                    <div style={{ fontSize: '18px', fontWeight: '900', color: '#0369a1' }}>£ {fmtCol(pnlData.netProfitIncVatCols.total)}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '16px', borderRadius: '8px', border: `2px solid #166534`, minWidth: '160px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#166534', textTransform: 'uppercase', marginBottom: '8px' }}>Net Profit (Exc. VAT)</div>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: '#15803d' }}>£ {fmtCol(pnlData.netProfitExcVatCols.total)}</div>
                  </div>
                </div>
                
                <div style={{ padding: '20px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ fontSize: '11px', color: '#000', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `2px solid ${theme.border}` }}>
                      <tr>
                        <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Account / Category Name</th>
                        {!isComb && <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Cash (£)</th>}
                        {!isComb && <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Memon Services (£)</th>}
                        {!isComb && <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Khanani Mgt (£)</th>}
                        {!isComb && <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>LK Associates (£)</th>}
                        <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>{isComb ? 'Amount (£)' : 'Total (£)'}</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Ratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderPnlSection('GROSS SALES', pnlData.sData, isComb, '', 'Total Gross Sales')}
                      {renderPnlSection('LESS: REFUNDS', pnlData.rData, isComb, '#dc2626', 'Total Refunds')}
                      {renderSubtotal('NET SALES', pnlData.netSalesCols, isComb, '#15803d')}
                      
                      {renderPnlSection('OTHER INCOME (POSITIVE VARIANCES)', pnlData.oiData, isComb, '#15803d', 'Total Other Income')}
                      {pnlData.oiData.arr.length > 0 && renderSubtotal('TOTAL INCOME', pnlData.totalIncomeCols, isComb, '#15803d')}

                      {renderPnlNestedSection('COST OF GOODS SOLD (COGS) & PURCHASES', pnlData.cData, isComb, '#dc2626', 'Total COGS & Purchases')}
                      {renderSubtotal('GROSS PROFIT', pnlData.grossProfitCols, isComb, '#15803d')}
                      
                      {renderPnlSection('PLATFORM FEES & DEDUCTIONS', pnlData.pData, isComb, '#dc2626', 'Total Platform Fees')}
                      {renderPnlNestedSection('OPERATING EXPENSES (INC. NEGATIVE VARIANCES)', pnlData.eData, isComb, '#dc2626', 'Total Operating Expenses')}
                      
                      {renderSubtotal('NET PROFIT INCLUSIVE VAT', pnlData.netProfitIncVatCols, isComb, '#0369a1')}
                      
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={isComb ? 3 : 7} style={{ padding: '10px 14px', fontWeight: '900', fontSize: '12px', color: '#000' }}>--- VAT CALCULATION ---</td>
                      </tr>
                      
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        <td style={{ padding: '10px 14px', fontWeight: '700', fontSize: '12px' }}>VAT Collected on Sales</td>
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>-</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>-</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>-</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>-</td>}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{fmtCol(pnlData.vatSalesCols.total)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{calcRatio(pnlData.vatSalesCols.total, uiRatioBase)}</td>
                      </tr>
                      
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        <td style={{ padding: '10px 14px', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>Less: VAT Paid on Purchases and Expenses</td>
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vatPurchasesCols.cash)}</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vatPurchasesCols.memon)}</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vatPurchasesCols.khanani)}</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vatPurchasesCols.lk)}</td>}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vatPurchasesCols.total)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px' }}>{calcRatio(pnlData.vatPurchasesCols.total, uiRatioBase)}</td>
                      </tr>
                      
                      <tr style={{ background: '#f1f5f9', borderTop: `1px solid ${theme.border}` }}>
                        <td style={{ padding: '8px 14px', fontWeight: '800', fontSize: '12px', color: '#334155' }}>Less: VAT Collected by Platforms</td>
                        <td colSpan={isComb ? 2 : 6}></td>
                      </tr>
                      {pnlData.vdData.arr.map((r, i) => (
                        <tr key={`vat-plat-${i}`} style={{ borderBottom: `1px solid ${theme.border}`, background: '#fff' }}>
                          <td style={{ padding: '8px 14px 8px 32px', fontWeight: '600', fontSize: '12px', color: '#475569' }}>  - {r.Account}</td>
                          {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px', color: '#dc2626' }}>{fmtCol(r.cash)}</td>}
                          {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px', color: '#dc2626' }}>{fmtCol(r.memon)}</td>}
                          {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px', color: '#dc2626' }}>{fmtCol(r.khanani)}</td>}
                          {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px', color: '#dc2626' }}>{fmtCol(r.lk)}</td>}
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#dc2626' }}>{fmtCol(r.total)}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '600', fontSize: '12px' }}>{calcRatio(r.total, uiRatioBase)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderBottom: `1px solid ${theme.border}`, background: '#f8fafc' }}>
                        <td style={{ padding: '8px 14px 8px 14px', fontWeight: '800', fontSize: '12px', color: '#0f172a' }}>Total VAT Collected by Platforms</td>
                        {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vdData.totals.cash)}</td>}
                        {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vdData.totals.memon)}</td>}
                        {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vdData.totals.khanani)}</td>}
                        {!isComb && <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vdData.totals.lk)}</td>}
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#dc2626' }}>{fmtCol(pnlData.vdData.totals.total)}</td>
                        <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px' }}>{calcRatio(pnlData.vdData.totals.total, uiRatioBase)}</td>
                      </tr>

                      <tr style={{ background: '#fef9c3', borderTop: `1px solid ${theme.border}`, borderBottom: `2px solid ${theme.border}` }}>
                        <td style={{ padding: '10px 14px', fontWeight: '900', fontSize: '12px', color: '#000' }}>NET VAT AMOUNT</td>
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(pnlData.netVatAmountCols.cash)}</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(pnlData.netVatAmountCols.memon)}</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(pnlData.netVatAmountCols.khanani)}</td>}
                        {!isComb && <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(pnlData.netVatAmountCols.lk)}</td>}
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{fmtCol(pnlData.netVatAmountCols.total)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '900', fontSize: '12px', color: '#000' }}>{calcRatio(pnlData.netVatAmountCols.total, uiRatioBase)}</td>
                      </tr>
                      
                      {renderSubtotal('NET PROFIT EXCLUSIVE VAT', pnlData.netProfitExcVatCols, isComb, '#15803d', true)}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {financialsTab === 'tb' && (
            <div>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, background: '#fff' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '900', color: theme.textMain }}>Trial Balance <span style={{ fontWeight: '600', color: theme.textMuted, fontSize: '12px', marginLeft: '6px' }}>(Cumulative balances up to {formatDate(dateTo)})</span></h3>
              </div>
              <div style={{ padding: '0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ fontSize: '11px', color: '#000', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                    <tr>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Account Name</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Type</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Debit Balance (£)</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Credit Balance (£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tbRows.length === 0 ? (
                      <tr><td colSpan="4" style={{ padding: '30px', textAlign: 'center', color: theme.textMuted }}>No ledger balances available.</td></tr>
                    ) : (
                      tbRows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}`, transition: 'background 0.2s' }}>
                          <td style={{ padding: '10px 14px', fontWeight: '800', fontSize: '12px', color: theme.textMain }}>{r.Account}</td>
                          <td style={{ padding: '10px 14px', fontSize: '11px', fontWeight: '700', color: theme.textMuted }}>{r.Type}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '12px', fontWeight: '800', color: r.Debit > 0 ? '#000' : theme.textMuted }}>{r.Debit > 0 ? fmtMoney(r.Debit) : '-'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '12px', fontWeight: '800', color: r.Credit > 0 ? '#000' : theme.textMuted }}>{r.Credit > 0 ? fmtMoney(r.Credit) : '-'}</td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderTop: `2px solid ${theme.border}` }}>
                      <td colSpan="2" style={{ padding: '14px', fontWeight: '900', fontSize: '13px', textAlign: 'right' }}>TOTALS:</td>
                      <td style={{ padding: '14px', fontSize: '13px', textAlign: 'right', fontWeight: '900', color: theme.textMain }}>£ {fmtMoney(bsTotals.tbTotDr)}</td>
                      <td style={{ padding: '14px', fontSize: '13px', textAlign: 'right', fontWeight: '900', color: theme.textMain }}>£ {fmtMoney(bsTotals.tbTotCr)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {financialsTab === 'bs' && (
            <div>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, background: '#fff' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '900', color: theme.textMain }}>Balance Sheet <span style={{ fontWeight: '600', color: theme.textMuted, fontSize: '12px', marginLeft: '6px' }}>(As of {formatDate(dateTo)})</span></h3>
              </div>
              <div style={{ padding: '0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ fontSize: '11px', color: '#000', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                    <tr>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Classification</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Account Name</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Amount (£)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td colSpan="3" style={{ padding: '14px', fontWeight: '900', fontSize: '13px', background: '#f0fdf4', color: '#166534', borderBottom: `1px solid ${theme.border}` }}>ASSETS</td></tr>
                    {bsAssets.length === 0 ? (
                      <tr><td colSpan="3" style={{ padding: '10px 14px', textAlign: 'center', color: theme.textMuted }}>No Assets recorded.</td></tr>
                    ) : (
                      bsAssets.map((r, i) => (
                        <tr key={`a-${i}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <td style={{ padding: '10px 14px' }}></td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '800', color: theme.textMain }}>{r.Account}</td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'right', fontWeight: '800', color: '#000' }}>{fmtMoney(r.Debit - r.Credit)}</td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                      <td colSpan="2" style={{ padding: '12px 14px', fontWeight: '900', fontSize: '12px', textAlign: 'right' }}>Total Assets:</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', textAlign: 'right', fontWeight: '900', color: '#15803d' }}>£ {fmtMoney(bsTotals.assets)}</td>
                    </tr>
                    
                    <tr><td colSpan="3" style={{ padding: '14px', fontWeight: '900', fontSize: '13px', background: '#fef2f2', color: '#991b1b', borderBottom: `1px solid ${theme.border}`, borderTop: `4px solid ${theme.border}` }}>LIABILITIES</td></tr>
                    {bsLiabs.length === 0 ? (
                      <tr><td colSpan="3" style={{ padding: '10px 14px', textAlign: 'center', color: theme.textMuted }}>No Liabilities recorded.</td></tr>
                    ) : (
                      bsLiabs.map((r, i) => (
                        <tr key={`l-${i}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <td style={{ padding: '10px 14px' }}></td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '800', color: theme.textMain }}>{r.Account}</td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'right', fontWeight: '800', color: '#000' }}>{fmtMoney(r.Credit - r.Debit)}</td>
                        </tr>
                      ))
                    )}
                    <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                      <td colSpan="2" style={{ padding: '12px 14px', fontWeight: '900', fontSize: '12px', textAlign: 'right' }}>Total Liabilities:</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', textAlign: 'right', fontWeight: '900', color: '#dc2626' }}>£ {fmtMoney(bsTotals.liabs)}</td>
                    </tr>

                    <tr><td colSpan="3" style={{ padding: '14px', fontWeight: '900', fontSize: '13px', background: '#eff6ff', color: '#1e40af', borderBottom: `1px solid ${theme.border}`, borderTop: `4px solid ${theme.border}` }}>EQUITY</td></tr>
                    {bsEquity.length > 0 && bsEquity.map((r, i) => (
                      <tr key={`e-${i}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                        <td style={{ padding: '10px 14px' }}></td>
                        <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '800', color: theme.textMain }}>{r.Account}</td>
                        <td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'right', fontWeight: '800', color: '#000' }}>{fmtMoney(r.Credit - r.Debit)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                       <td style={{ padding: '10px 14px' }}></td>
                       <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '800', color: theme.textMain }}>Net Profit (Current Period)</td>
                       <td style={{ padding: '10px 14px', fontSize: '12px', textAlign: 'right', fontWeight: '800', color: theme.primary }}>{fmtMoney(bsTotals.profit)}</td>
                    </tr>
                    <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                      <td colSpan="2" style={{ padding: '12px 14px', fontWeight: '900', fontSize: '12px', textAlign: 'right' }}>Total Equity:</td>
                      <td style={{ padding: '13px', fontSize: '13px', textAlign: 'right', fontWeight: '900', color: '#1d4ed8' }}>£ {fmtMoney(bsTotals.equity)}</td>
                    </tr>

                    <tr style={{ background: '#f1f5f9', borderTop: `2px solid ${theme.textMain}` }}>
                      <td colSpan="2" style={{ padding: '16px 14px', fontWeight: '900', fontSize: '14px', textAlign: 'right', color: theme.textMain }}>TOTAL LIABILITIES & EQUITY:</td>
                      <td style={{ padding: '16px 14px', fontSize: '14px', textAlign: 'right', fontWeight: '900', color: theme.textMain }}>£ {fmtMoney(bsTotals.liabs + bsTotals.equity)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {financialsTab === 'delivery_audit' && (
            <div>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '900', color: theme.textMain }}>Delivery Adjustments & Reasons Audit Report</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Filter size={14} color="#64748b" />
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>Platform:</span>
                  <select value={auditPlatformFilter} onChange={e => setAuditPlatformFilter(e.target.value)} style={{ padding: '6px 12px', border: `1px solid ${theme.border}`, borderRadius: '6px', fontSize: '12px', fontWeight: '700', background: '#f8fafc', outline: 'none' }}>
                    <option value="All">All Platforms</option>
                    {Array.from(new Set(actualDeliveryDb.map(d => d.platform).filter(Boolean))).map(plat => (
                      <option key={plat} value={plat}>{plat}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ padding: '0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ fontSize: '11px', color: '#000', textTransform: 'uppercase', background: '#f8fafc', borderBottom: `1px solid ${theme.border}` }}>
                    <tr>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Date</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Platform</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Positive Adjustment (£)</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900' }}>Negative Adjustment (£)</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: '900' }}>Reason / Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryAuditData.length === 0 ? (
                      <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: theme.textMuted }}>No adjustments found for this date range and platform filter.</td></tr>
                    ) : (
                      deliveryAuditData.map((r, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <td style={{ padding: '10px 14px', fontWeight: '800', fontSize: '12px' }}>{r.date}</td>
                          <td style={{ padding: '10px 14px', fontWeight: '800', fontSize: '12px' }}>{r.platform}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#15803d' }}>{r.positive > 0 ? fmtMoney(r.positive) : '-'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '800', fontSize: '12px', color: '#dc2626' }}>{r.negative > 0 ? fmtMoney(r.negative) : '-'}</td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>{r.reason}</td>
                        </tr>
                      ))
                    )}
                    {deliveryAuditData.length > 0 && (
                      <>
                        <tr style={{ background: '#fef9c3', borderTop: `2px solid ${theme.border}`, fontWeight: '900' }}>
                          <td colSpan="2" style={{ padding: '12px 14px', textAlign: 'right' }}>TOTALS:</td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: '#15803d' }}>£ {fmtMoney(deliveryAuditTotals.totPos)}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: '#dc2626' }}>£ {fmtMoney(deliveryAuditTotals.totNeg)}</td>
                          <td></td>
                        </tr>
                        <tr style={{ background: '#dcfce7', borderBottom: `2px solid #166534`, fontWeight: '900' }}>
                          <td colSpan="2" style={{ padding: '12px 14px', textAlign: 'right' }}>NET BALANCE (Net-Off):</td>
                          <td colSpan="3" style={{ padding: '12px 14px', textAlign: 'left', color: deliveryAuditTotals.net >= 0 ? '#15803d' : '#dc2626' }}>
                            £ {fmtMoney(deliveryAuditTotals.net)} ({deliveryAuditTotals.net >= 0 ? 'Net Positive' : 'Net Negative'})
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}