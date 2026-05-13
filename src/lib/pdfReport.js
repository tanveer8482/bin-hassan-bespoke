import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, formatDate, number } from "./format";

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

function isApprovedWork(piece) {
  const status = String(piece?.karigar_status || "").trim().toLowerCase();
  return status === "complete" || status === "approved";
}

function resolveOrderFromRef(orderRef, orderId) {
  if (!orderRef || !orderId) return null;
  if (Array.isArray(orderRef)) {
    return orderRef.find((order) => order.order_id === orderId) || null;
  }
  return orderRef[orderId] || null;
}

function karigarPieceAmount(piece) {
  const baseAmount = number(piece?.karigar_rate);
  const designingAmount = number(piece?.designing_karigar_charge);
  const cuttingAmount = number(piece?.cutting_credit_amount);
  return baseAmount + designingAmount || cuttingAmount;
}

function productNamesForOrder(order, orderItems) {
  const items = orderItems.filter((item) => item.order_id === order.order_id);
  const names = items
    .map((item) => item.piece_type || item.product_name || item.product_id)
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(", ") : order.product_name || "-";
}

function orderPrice(order, orderItems, orderTotals) {
  const computed = orderTotals?.[order.order_id]?.grand_total;
  if (computed !== undefined && computed !== null && computed !== "") return number(computed);

  const itemTotal = orderItems
    .filter((item) => item.order_id === order.order_id)
    .reduce((sum, item) => sum + number(item.item_rate), 0);

  return itemTotal || number(order.total_amount);
}

/**
 * Admin Master Payroll Sync Report
 */
export function generateMasterPayrollPdf(syncedPieces, totalAmount) {
  console.log("[PDF] Starting Master Payroll PDF generation", { count: syncedPieces?.length, totalAmount });
  try {
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
    
    autoTable(doc, {
      startY: 48,
      head: [["ID", "Piece", "Type", "Karigar", "Amount"]],
      body: tableData,
      foot: [["", "", "", "Total Synced:", formatCurrency(totalAmount)]],
      theme: "striped",
      headStyles: { fillColor: [40, 44, 52] },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" }
    });
    
    doc.save(`Master_Payroll_Report_${(dateStr || "unknown").replace(/\//g, "-")}.pdf`);
    console.log("[PDF] Master Payroll PDF saved successfully");
  } catch (error) {
    console.error("[PDF] Failed to generate Master Payroll PDF:", error);
  }
}

/**
 * Admin Master Ledger Report
 */
export function generateMasterLedgerPdf({
  karigars = [],
  shops = [],
  karigarFinancials = {},
  shopFinancials = {}
} = {}) {
  console.log("[PDF] Starting Master Ledger PDF generation", {
    karigarCount: karigars.length,
    shopCount: shops.length
  });

  try {
    const doc = new jsPDF();
    const dateStr = formatDate(new Date());
    addReportHeader(doc, "Master Ledger", `Generated on: ${dateStr}`);

    const karigarRows = karigars.map((karigar) => {
      const financial = karigarFinancials[karigar.karigar_id] || {};
      return [
        karigar.name || karigar.karigar_id || "-",
        formatCurrency(number(financial.earned)),
        formatCurrency(number(financial.pending)),
        formatCurrency(number(financial.paid)),
        formatCurrency(number(financial.balance) + number(financial.pending))
      ];
    });

    const totalPayable = karigars.reduce((sum, karigar) => {
      const financial = karigarFinancials[karigar.karigar_id] || {};
      return sum + number(financial.balance) + number(financial.pending);
    }, 0);

    autoTable(doc, {
      startY: 50,
      head: [["Karigar", "Synced Earned", "Pending Sync", "Paid", "Net Payable"]],
      body: karigarRows.length ? karigarRows : [["-", formatCurrency(0), formatCurrency(0), formatCurrency(0), formatCurrency(0)]],
      foot: [["", "", "", "Total Payable", formatCurrency(totalPayable)]],
      theme: "grid",
      headStyles: { fillColor: [40, 44, 52] },
      footStyles: { fillColor: [245, 247, 250], textColor: [15, 23, 42], fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 3 }
    });

    const receivableStartY = doc.lastAutoTable.finalY + 12;
    const shopRows = shops.map((shop) => {
      const financial = shopFinancials[shop.shop_id] || {};
      return [
        shop.shop_name || shop.shop_id || "-",
        formatCurrency(number(financial.billed)),
        formatCurrency(number(financial.paid)),
        formatCurrency(number(financial.balance))
      ];
    });
    const totalReceivable = shops.reduce(
      (sum, shop) => sum + number(shopFinancials[shop.shop_id]?.balance),
      0
    );

    autoTable(doc, {
      startY: receivableStartY,
      head: [["Shop", "Outstanding Orders", "Received", "Net Receivable"]],
      body: shopRows.length ? shopRows : [["-", formatCurrency(0), formatCurrency(0), formatCurrency(0)]],
      foot: [["", "", "Total Receivable", formatCurrency(totalReceivable)]],
      theme: "grid",
      headStyles: { fillColor: [40, 44, 52] },
      footStyles: { fillColor: [245, 247, 250], textColor: [15, 23, 42], fontStyle: "bold" },
      styles: { fontSize: 9, cellPadding: 3 }
    });

    const summaryStartY = doc.lastAutoTable.finalY + 12;
    autoTable(doc, {
      startY: summaryStartY,
      head: [["Summary", "Amount"]],
      body: [
        ["Total Payable to Karigars", formatCurrency(totalPayable)],
        ["Total Receivable from Shops", formatCurrency(totalReceivable)],
        ["Final Net Balance", formatCurrency(totalReceivable - totalPayable)]
      ],
      theme: "striped",
      headStyles: { fillColor: [40, 44, 52] },
      styles: { fontSize: 10, cellPadding: 3 }
    });

    const safeDate = (dateStr || "unknown").replace(/\//g, "-");
    doc.save(`Master_Ledger_${safeDate}.pdf`);
    console.log("[PDF] Master Ledger PDF saved successfully");
  } catch (error) {
    console.error("[PDF] Failed to generate Master Ledger PDF:", error);
  }
}

/**
 * Karigar Ledger Report
 */
export function generateKarigarLedgerPdf(karigar, pieces = [], payments = [], summary = {}, ordersById = {}) {
  console.log("[PDF] Starting Karigar Ledger PDF generation", { karigar: karigar?.name, pieceCount: pieces?.length });
  try {
    const doc = new jsPDF();
    const dateStr = formatDate(new Date());
    const workerName = karigar?.name || karigar?.display_name || "Worker";
    
    addReportHeader(
      doc, 
      `Karigar Invoice: ${workerName}`,
      `Generated on: ${dateStr} | Contact: ${karigar?.contact || "-"}`
    );

    const approvedPieces = pieces.filter(isApprovedWork);
    const totalPayable = approvedPieces.reduce(
      (sum, piece) => sum + karigarPieceAmount(piece),
      0
    );
    const pieceData = approvedPieces.map((piece) => {
      const order = resolveOrderFromRef(ordersById, piece.order_id);
      return [
        order?.order_number || piece.order_number || piece.order_id || "-",
        piece.piece_name || piece.sub_product_name || "-",
        formatCurrency(karigarPieceAmount(piece))
      ];
    });

    autoTable(doc, {
      startY: 50,
      head: [["Order Number", "Piece Type", "Payment Amount"]],
      body: pieceData.length ? pieceData : [["-", "No approved work", formatCurrency(0)]],
      foot: [["", "Total Payable", formatCurrency(totalPayable)]],
      theme: "grid",
      headStyles: { fillColor: [40, 44, 52] },
      footStyles: { fillColor: [245, 247, 250], textColor: [15, 23, 42], fontStyle: "bold" },
      styles: { fontSize: 10, cellPadding: 3 }
    });
    
    const safeKarigarName = workerName.replace(/\s+/g, "_");
    const safeDate = (dateStr || "unknown").replace(/\//g, "-");
    doc.save(`Karigar_Invoice_${safeKarigarName}_${safeDate}.pdf`);
    console.log("[PDF] Karigar Ledger PDF saved successfully");
  } catch (error) {
    console.error("[PDF] Failed to generate Karigar Ledger PDF:", error);
  }
}

/**
 * Shop Ledger Report
 */
export function generateShopLedgerPdf(
  shop,
  orders = [],
  payments = [],
  summary = {},
  orderItems = [],
  orderTotals = {}
) {
  console.log("[PDF] Starting Shop Ledger PDF generation", { shop: shop?.shop_name, orderCount: orders?.length });
  try {
    const doc = new jsPDF();
    const dateStr = formatDate(new Date());
    const shopName = shop?.shop_name || shop?.display_name || "Shop";
    
    addReportHeader(
      doc, 
      `Shop Invoice: ${shopName}`,
      `Generated on: ${dateStr} | Contact: ${shop?.contact || "-"}`
    );

    const orderRows = orders.map((order) => {
      const price = orderPrice(order, orderItems, orderTotals);
      return [
        order.order_number || "-",
        productNamesForOrder(order, orderItems),
        formatCurrency(price)
      ];
    });
    const fallbackTotal = orders.reduce(
      (sum, order) => sum + orderPrice(order, orderItems, orderTotals),
      0
    );
    const outstandingTotal =
      summary?.balance !== undefined && summary?.balance !== null
        ? number(summary.balance)
        : fallbackTotal;

    autoTable(doc, {
      startY: 50,
      head: [["Order Number", "Product Name", "Price"]],
      body: orderRows.length ? orderRows : [["-", "No orders", formatCurrency(0)]],
      foot: [["", "Total Outstanding Bill", formatCurrency(outstandingTotal)]],
      theme: "grid",
      headStyles: { fillColor: [40, 44, 52] },
      footStyles: { fillColor: [245, 247, 250], textColor: [15, 23, 42], fontStyle: "bold" },
      styles: { fontSize: 10, cellPadding: 3 }
    });
    
    const safeShopName = shopName.replace(/\s+/g, "_");
    const safeDate = (dateStr || "unknown").replace(/\//g, "-");
    doc.save(`Shop_Invoice_${safeShopName}_${safeDate}.pdf`);
    console.log("[PDF] Shop Ledger PDF saved successfully");
  } catch (error) {
    console.error("[PDF] Failed to generate Shop Ledger PDF:", error);
  }
}
