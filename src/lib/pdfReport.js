import jsPDF from "jspdf";
import "jspdf-autotable";
import { formatCurrency, formatDate } from "./format";

const APP_NAME = "Bin Hassan Bespoke";

/**
 * Common header for all reports
 */
function addReportHeader(doc, title, subtitle) {
  doc.setFontSize(22);
  doc.setTextColor(40, 44, 52);
  doc.text(APP_NAME, 14, 20);
  
  doc.setFontSize(16);
  doc.setTextColor(100);
  doc.text(title, 14, 30);
  
  if (subtitle) {
    doc.setFontSize(10);
    doc.text(subtitle, 14, 37);
  }
  
  doc.setDrawColor(200);
  doc.line(14, 42, 196, 42);
}

/**
 * Admin Master Payroll Sync Report
 */
export function generateMasterPayrollPdf(syncedPieces, totalAmount) {
  const doc = new jsPDF();
  const dateStr = formatDate(new Date());
  
  addReportHeader(doc, "Master Payroll Sync Report", `Generated on: ${dateStr}`);
  
  const tableData = syncedPieces.map((piece) => [
    piece.piece_id,
    piece.piece_name,
    piece.item_type,
    piece.karigar_name || piece.assigned_karigar_id || "-",
    formatCurrency(piece.karigar_rate || 0)
  ]);
  
  doc.autoTable({
    startY: 48,
    head: [["ID", "Piece", "Type", "Karigar", "Amount"]],
    body: tableData,
    foot: [["", "", "", "Total Synced:", formatCurrency(totalAmount)]],
    theme: "striped",
    headStyles: { fillColor: [40, 44, 52] },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" }
  });
  
  doc.save(`Master_Payroll_Report_${dateStr.replace(/\//g, "-")}.pdf`);
}

/**
 * Karigar Ledger Report
 */
export function generateKarigarLedgerPdf(karigar, pieces, payments, summary) {
  const doc = new jsPDF();
  const dateStr = formatDate(new Date());
  
  addReportHeader(
    doc, 
    `Worker Ledger: ${karigar.name}`, 
    `Generated on: ${dateStr} | Contact: ${karigar.contact}`
  );
  
  // Summary Section
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Financial Summary", 14, 52);
  
  doc.autoTable({
    startY: 55,
    body: [
      ["Total Earned:", formatCurrency(summary.earned)],
      ["Total Paid:", formatCurrency(summary.paid)],
      ["Pending Balance:", formatCurrency(summary.balance)]
    ],
    theme: "plain",
    styles: { cellPadding: 1, fontSize: 10 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } }
  });
  
  // Pieces Section
  doc.setFontSize(12);
  doc.text("Completed Work History", 14, doc.lastAutoTable.finalY + 10);
  
  const pieceData = pieces
    .filter(p => p.karigar_status === "complete")
    .map(p => [
      formatDate(p.karigar_complete_date || p.updated_date),
      p.piece_name,
      p.item_type,
      formatCurrency(p.karigar_rate || 0)
    ]);
    
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 15,
    head: [["Date", "Piece", "Type", "Rate"]],
    body: pieceData,
  });
  
  // Payments Section
  doc.setFontSize(12);
  doc.text("Payment History", 14, doc.lastAutoTable.finalY + 10);
  
  const paymentData = payments.map(p => [
    formatDate(p.payment_date),
    formatCurrency(p.amount),
    p.note || "-"
  ]);
  
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 15,
    head: [["Date", "Amount", "Note"]],
    body: paymentData,
  });
  
  doc.save(`Ledger_${karigar.name.replace(/\s+/g, "_")}_${dateStr.replace(/\//g, "-")}.pdf`);
}

/**
 * Shop Ledger Report
 */
export function generateShopLedgerPdf(shop, orders, payments, summary) {
  const doc = new jsPDF();
  const dateStr = formatDate(new Date());
  
  addReportHeader(
    doc, 
    `Shop Ledger: ${shop.shop_name}`, 
    `Generated on: ${dateStr} | Contact: ${shop.contact}`
  );
  
  // Summary
  doc.setFontSize(12);
  doc.text("Account Summary", 14, 52);
  
  doc.autoTable({
    startY: 55,
    body: [
      ["Total Billed:", formatCurrency(summary.billed)],
      ["Total Paid:", formatCurrency(summary.paid)],
      ["Current Balance:", formatCurrency(summary.balance)]
    ],
    theme: "plain",
    styles: { cellPadding: 1 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } }
  });
  
  // Orders
  doc.setFontSize(12);
  doc.text("Order History", 14, doc.lastAutoTable.finalY + 10);
  
  const orderData = orders.map(o => [
    formatDate(o.delivery_date),
    o.order_number,
    o.status,
    formatCurrency(o.total_amount || 0)
  ]);
  
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 15,
    head: [["Deliv. Date", "Order #", "Status", "Amount"]],
    body: orderData,
  });
  
  // Payments
  doc.setFontSize(12);
  doc.text("Payment History", 14, doc.lastAutoTable.finalY + 10);
  
  const paymentData = payments.map(p => [
    formatDate(p.payment_date),
    formatCurrency(p.amount),
    p.note || "-"
  ]);
  
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 15,
    head: [["Date", "Amount", "Note"]],
    body: paymentData,
  });
  
  doc.save(`Report_${shop.shop_name.replace(/\s+/g, "_")}_${dateStr.replace(/\//g, "-")}.pdf`);
}
