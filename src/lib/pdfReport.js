import jsPDF from "jspdf";
import "jspdf-autotable";

/**
 * Generate Master Payroll PDF for Admin
 */
export function generateMasterPayrollPdf(syncedPieces, karigarsById, syncId) {
  const doc = new jsPDF();
  const dateStr = new Date().toLocaleDateString();

  doc.setFontSize(18);
  doc.text("Bin Hassan Bespoke - Master Payroll Sync Report", 14, 20);
  doc.setFontSize(10);
  doc.text(`Sync ID: ${syncId} | Date: ${dateStr}`, 14, 28);

  const karigarGroups = {};
  syncedPieces.forEach(p => {
    const kid = p.assigned_karigar_id;
    if (!karigarGroups[kid]) karigarGroups[kid] = [];
    karigarGroups[kid].push(p);
  });

  const tableRows = [];
  let grandTotal = 0;

  Object.entries(karigarGroups).forEach(([kid, pieces]) => {
    const karigarName = karigarsById[kid]?.name || kid;
    let karigarSubtotal = 0;

    pieces.forEach(p => {
      const amount = (Number(p.karigar_rate) || 0) + (Number(p.designing_karigar_charge) || 0);
      karigarSubtotal += amount;
      grandTotal += amount;

      tableRows.push([
        karigarName,
        p.piece_name || "Piece",
        p.sub_product_name || "-",
        p.item_type || "normal",
        amount.toLocaleString()
      ]);
    });

    // Add a subtotal row for this karigar
    tableRows.push([
      { content: `${karigarName} Total`, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
      { content: karigarSubtotal.toLocaleString(), styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }
    ]);
  });

  // Add Grand Total
  tableRows.push([
    { content: `GRAND TOTAL`, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [200, 200, 200] } },
    { content: grandTotal.toLocaleString(), styles: { fontStyle: 'bold', fillColor: [200, 200, 200] } }
  ]);

  doc.autoTable({
    startY: 35,
    head: [["Karigar", "Piece", "Type", "Item Type", "Amount"]],
    body: tableRows,
    theme: 'striped',
    headStyles: { fillColor: [41, 128, 185] }
  });

  doc.save(`Payroll_Master_${syncId}_${dateStr.replace(/\//g, '-')}.pdf`);
}

/**
 * Generate Karigar Ledger PDF
 */
export function generateKarigarLedgerPdf(karigar, pieces, payments, syncRuns) {
  const doc = new jsPDF();
  const dateStr = new Date().toLocaleDateString();

  doc.setFontSize(18);
  doc.text(`Karigar Ledger: ${karigar.name}`, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generated on: ${dateStr}`, 14, 28);

  // Combine pieces (earnings) and payments (withdrawals) into a chronological ledger
  const entries = [
    ...pieces.filter(p => String(p.is_synced).toUpperCase() === "TRUE").map(p => ({
      date: p.completion_verified_date || p.updated_date,
      desc: `Earning: ${p.piece_name} (${p.item_type})`,
      amount: (Number(p.karigar_rate) || 0) + (Number(p.designing_karigar_charge) || 0),
      type: 'EARNING'
    })),
    ...payments.map(p => ({
      date: p.date,
      desc: `Payment: ${p.notes || "Karigar Payout"}`,
      amount: Number(p.amount) || 0,
      type: 'PAYMENT'
    }))
  ];

  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  const tableRows = entries.map(e => {
    if (e.type === 'EARNING') balance += e.amount;
    else balance -= e.amount;

    return [
      new Date(e.date).toLocaleDateString(),
      e.desc,
      e.type === 'EARNING' ? e.amount.toLocaleString() : "-",
      e.type === 'PAYMENT' ? e.amount.toLocaleString() : "-",
      balance.toLocaleString()
    ];
  });

  doc.autoTable({
    startY: 35,
    head: [["Date", "Description", "Earned", "Paid", "Balance"]],
    body: tableRows,
    headStyles: { fillColor: [39, 174, 96] }
  });

  doc.save(`Ledger_${karigar.name.replace(/\s+/g, '_')}_${dateStr.replace(/\//g, '-')}.pdf`);
}

/**
 * Generate Shop History PDF
 */
export function generateShopHistoryPdf(shop, orders, payments, orderTotals) {
  const doc = new jsPDF();
  const dateStr = new Date().toLocaleDateString();

  doc.setFontSize(18);
  doc.text(`Shop Report: ${shop.shop_name}`, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generated on: ${dateStr}`, 14, 28);

  const entries = [
    ...orders.map(o => ({
      date: o.created_date,
      desc: `Order: ${o.order_number}`,
      amount: orderTotals[o.order_id]?.grand_total || 0,
      type: 'ORDER'
    })),
    ...payments.map(p => ({
      date: p.date,
      desc: `Payment: ${p.notes || "Shop Received"}`,
      amount: Number(p.amount) || 0,
      type: 'PAYMENT'
    }))
  ];

  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  const tableRows = entries.map(e => {
    if (e.type === 'ORDER') balance += e.amount;
    else balance -= e.amount;

    return [
      new Date(e.date).toLocaleDateString(),
      e.desc,
      e.type === 'ORDER' ? e.amount.toLocaleString() : "-",
      e.type === 'PAYMENT' ? e.amount.toLocaleString() : "-",
      balance.toLocaleString()
    ];
  });

  doc.autoTable({
    startY: 35,
    head: [["Date", "Description", "Order Amount", "Paid", "Balance"]],
    body: tableRows,
    headStyles: { fillColor: [142, 68, 173] }
  });

  doc.save(`Shop_Report_${shop.shop_name.replace(/\s+/g, '_')}_${dateStr.replace(/\//g, '-')}.pdf`);
}
