const { ROLES, SHEETS } = require("./_lib/constants");
const {
  computeKarigarFinancials,
  loadFullSnapshot
} = require("./_lib/domain");
const { requireAuth, requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  appendRecord,
  ensureWorkbook,
  getRecords,
  updateByField
} = require("./_lib/sheets");
const {
  id,
  normalizeText,
  nowISO,
  parseBody,
  requireFields,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

async function listKarigar(res, user) {
  if (![ROLES.ADMIN, ROLES.KARIGAR].includes(user.role)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }

  await ensureWorkbook();

  const [karigars, snapshot] = await Promise.all([
    getRecords(SHEETS.KARIGAR),
    loadFullSnapshot()
  ]);

  const financials = computeKarigarFinancials(
    snapshot.pieces,
    snapshot.paymentsKarigar
  );

  const filtered =
    user.role === ROLES.ADMIN
      ? karigars
      : karigars.filter((karigar) => karigar.karigar_id === user.entity_id);

  sendOk(res, {
    karigars: filtered.map(stripMeta),
    karigar_financials: financials,
    last_synced: new Date().toISOString()
  });
}

async function createKarigar(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["name"]);

  const karigarId = normalizeText(body.karigar_id) || id("karigar");

  const existing = await getRecords(SHEETS.KARIGAR);
  if (existing.some((karigar) => karigar.karigar_id === karigarId)) {
    const error = new Error("karigar_id already exists");
    error.statusCode = 400;
    throw error;
  }

  const now = nowISO();
  const record = {
    karigar_id: karigarId,
    name: normalizeText(body.name),
    contact: normalizeText(body.contact),
    created_date: now
  };

  await appendRecord(SHEETS.KARIGAR, record);

  sendOk(res, {
    message: "Karigar created",
    karigar: record
  });
}

async function updateKarigar(req, res) {
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["karigar_id"]);

  const patch = {};
  if (body.name !== undefined) patch.name = normalizeText(body.name);
  if (body.contact !== undefined) patch.contact = normalizeText(body.contact);

  if (!Object.keys(patch).length) {
    const error = new Error("No updatable fields provided");
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateByField(
    SHEETS.KARIGAR,
    "karigar_id",
    body.karigar_id,
    patch
  );

  sendOk(res, {
    message: "Karigar updated",
    karigar: stripMeta(updated)
  });
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET", "POST", "PATCH"]);

  const user = requireAuth(req);

  if (req.method === "GET") {
    return listKarigar(res, user);
  }

  if (req.method === "POST") {
    return createKarigar(req, res);
  }

  return updateKarigar(req, res);
});
