const EMPTY_COMPUTED = {
  orderTotals: {},
  shopFinancials: {},
  karigarFinancials: {},
  dashboard: {
    total_active_orders: 0,
    orders_ready_for_delivery: 0,
    pieces_pending_cutting: 0,
    pieces_assigned_pending_completion: 0,
    overdue_orders: 0
  }
};

export function emptySnapshot() {
  return {
    users: [],
    shops: [],
    karigars: [],
    orders: [],
    archivedOrders: [],
    orderItems: [],
    pieces: [],
    paymentsShops: [],
    paymentsKarigar: [],
    settings: [],
    products: [],
    productSubProducts: [],
    shopInvoices: [],
    shopInvoiceLines: [],
    payrollSyncRuns: [],
    shopRates: [],
    karigarRates: [],
    computed: EMPTY_COMPUTED
  };
}
