<<<<<<< HEAD
const { requireAuth } = require("./_lib/auth");
const { getEnv } = require("./_lib/env");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  filterSnapshotByRole,
  loadFullSnapshot,
  refreshOrderStatuses,
  withComputedFields
} = require("./_lib/domain");
const { ensureWorkbook } = require("./_lib/sheets");
const { withErrorHandler } = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

function sanitizeSnapshot(snapshot) {
  return {
    ...snapshot,
    users: snapshot.users.map(stripMeta),
    shops: snapshot.shops.map(stripMeta),
    karigars: snapshot.karigars.map(stripMeta),
    orders: snapshot.orders.map(stripMeta),
    orderItems: snapshot.orderItems.map(stripMeta),
    pieces: snapshot.pieces.map(stripMeta),
    paymentsShops: snapshot.paymentsShops.map(stripMeta),
    paymentsKarigar: snapshot.paymentsKarigar.map(stripMeta),
    settings: snapshot.settings.map(stripMeta),
    shopRates: snapshot.shopRates.map(stripMeta),
    karigarRates: snapshot.karigarRates.map(stripMeta)
  };
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);
  const env = getEnv();

  await ensureWorkbook();
  await refreshOrderStatuses();

  const snapshot = await loadFullSnapshot();
  const withComputed = withComputedFields(snapshot);
  const filtered = filterSnapshotByRole(user, withComputed);

  sendOk(res, {
    data: sanitizeSnapshot(filtered),
    poll_interval_ms: env.pollIntervalMs,
    last_synced: new Date().toISOString()
  });
});
=======
const { requireAuth } = require("./_lib/auth");
const { getEnv } = require("./_lib/env");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  filterSnapshotByRole,
  loadFullSnapshot,
  refreshOrderStatuses,
  withComputedFields
} = require("./_lib/domain");
const { ensureWorkbook } = require("./_lib/sheets");
const { withErrorHandler } = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

function sanitizeSnapshot(snapshot) {
  return {
    ...snapshot,
    users: snapshot.users.map(stripMeta),
    shops: snapshot.shops.map(stripMeta),
    karigars: snapshot.karigars.map(stripMeta),
    orders: snapshot.orders.map(stripMeta),
    orderItems: snapshot.orderItems.map(stripMeta),
    pieces: snapshot.pieces.map(stripMeta),
    paymentsShops: snapshot.paymentsShops.map(stripMeta),
    paymentsKarigar: snapshot.paymentsKarigar.map(stripMeta),
    settings: snapshot.settings.map(stripMeta),
    shopRates: snapshot.shopRates.map(stripMeta),
    karigarRates: snapshot.karigarRates.map(stripMeta)
  };
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET"]);
  const user = requireAuth(req);
  const env = getEnv();

  await ensureWorkbook();
  await refreshOrderStatuses();

  const snapshot = await loadFullSnapshot();
  const withComputed = withComputedFields(snapshot);
  const filtered = filterSnapshotByRole(user, withComputed);

  sendOk(res, {
    data: sanitizeSnapshot(filtered),
    poll_interval_ms: env.pollIntervalMs,
    last_synced: new Date().toISOString()
  });
});
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
