const { ITEM_TYPES, ROLES, SHEETS } = require("./_lib/constants");
const { requireAuth, requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  appendRecord,
  ensureWorkbook,
  getRecords,
  updateRecord
} = require("./_lib/sheets");
const {
  normalizeKey,
  normalizeText,
  parseBody,
  requireFields,
  toNumber,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

function normalizeRateInput(rate) {
  const normalized = {
    karigar_id: normalizeText(rate.karigar_id),
    piece_name: normalizeKey(rate.piece_name),
    item_type: normalizeKey(rate.item_type || "normal"),
    rate: String(toNumber(rate.rate))
  };

  if (!normalized.karigar_id || !normalized.piece_name) {
    const error = new Error("karigar_id and piece_name are required for rate rows");
    error.statusCode = 400;
    throw error;
  }

  if (!ITEM_TYPES.includes(normalized.item_type)) {
    const error = new Error(`Invalid item_type: ${normalized.item_type}`);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function upsertRates(rates) {
  const existing = await getRecords(SHEETS.KARIGAR_RATES);

  const updatedRows = [];
  const insertedRows = [];

  for (const incoming of rates) {
    const match = existing.find(
      (candidate) =>
        candidate.karigar_id === incoming.karigar_id &&
        normalizeKey(candidate.piece_name) === incoming.piece_name &&
        normalizeKey(candidate.item_type || "normal") === incoming.item_type
    );

    if (match) {
      const merged = {
        ...match,
        ...incoming
      };
      const updated = await updateRecord(
        SHEETS.KARIGAR_RATES,
        match.__rowNumber,
        merged
      );
      updatedRows.push(stripMeta(updated));
    } else {
      await appendRecord(SHEETS.KARIGAR_RATES, incoming);
      insertedRows.push(incoming);
    }
  }

  return {
    updatedRows,
    insertedRows
  };
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET", "POST"]);
  const user = requireAuth(req);
  await ensureWorkbook();

  if (req.method === "GET") {
    if (![ROLES.ADMIN, ROLES.KARIGAR].includes(user.role)) {
      const error = new Error("Forbidden");
      error.statusCode = 403;
      throw error;
    }

    const rates = await getRecords(SHEETS.KARIGAR_RATES);
    const filtered =
      user.role === ROLES.ADMIN
        ? rates
        : rates.filter((rate) => rate.karigar_id === user.entity_id);

    return sendOk(res, {
      rates: filtered.map(stripMeta),
      last_synced: new Date().toISOString()
    });
  }

  requireRole(req, [ROLES.ADMIN]);
  const body = await parseBody(req);

  let ratesInput = [];
  if (Array.isArray(body.rates)) {
    ratesInput = body.rates;
  } else {
    requireFields(body, ["karigar_id", "piece_name", "item_type", "rate"]);
    ratesInput = [body];
  }

  const normalizedRates = ratesInput.map(normalizeRateInput);
  const result = await upsertRates(normalizedRates);

  sendOk(res, {
    message: "Karigar rates saved",
    ...result
  });
});
