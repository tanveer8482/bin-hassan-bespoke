const { ROLES, SHEETS, STATUS } = require("./_lib/constants");
const {
  buildRateMap,
  refreshOrderStatuses,
  resolveKarigarPieceRate
} = require("./_lib/domain");
const { requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const { ensureWorkbook, getRecords, updateByField } = require("./_lib/sheets");
const {
  normalizeKey,
  nowISO,
  parseBody,
  parseBoolean,
  requireFields,
  toNumber,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["POST"]);
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  const body = await parseBody(req);
  requireFields(body, ["piece_id", "karigar_id"]);

  const [pieces, karigars, karigarRates, orders] = await Promise.all([
    getRecords(SHEETS.PIECES),
    getRecords(SHEETS.KARIGAR),
    getRecords(SHEETS.KARIGAR_RATES),
    getRecords(SHEETS.ORDERS)
  ]);

  const piece = pieces.find((record) => record.piece_id === body.piece_id);
  if (!piece) {
    const error = new Error("Piece not found");
    error.statusCode = 404;
    throw error;
  }

  if (!parseBoolean(piece.cutting_done)) {
    const error = new Error("Piece cannot be assigned before cutting is complete");
    error.statusCode = 400;
    throw error;
  }

  const karigarExists = karigars.some(
    (karigar) => karigar.karigar_id === body.karigar_id
  );
  if (!karigarExists) {
    const error = new Error("Selected karigar does not exist");
    error.statusCode = 400;
    throw error;
  }

  const order = orders.find((record) => record.order_id === piece.order_id);
  const orderDesigningEnabled = order && parseBoolean(order.designing_enabled);

  const karigarRateMap = buildRateMap(karigarRates, "karigar_id");
  const karigarRate = resolveKarigarPieceRate(
    karigarRateMap,
    body.karigar_id,
    piece.piece_name,
    piece.item_type
  );

  const designingCharge = orderDesigningEnabled
    ? toNumber(body.designing_karigar_charge)
    : 0;

  const now = nowISO();
  const updated = await updateByField(SHEETS.PIECES, "piece_id", body.piece_id, {
    assigned_karigar_id: body.karigar_id,
    assigned_date: now,
    karigar_status: STATUS.KARIGAR.ASSIGNED,
    karigar_complete_date: "",
    completion_photo_url: "",
    completion_verified: "false",
    completion_verified_date: "",
    karigar_rate: String(karigarRate),
    designing_karigar_charge: String(designingCharge),
    updated_date: now
  });

  await refreshOrderStatuses([updated.order_id]);

  sendOk(res, {
    message:
      normalizeKey(piece.karigar_status) === STATUS.KARIGAR.NOT_ASSIGNED
        ? "Piece assigned"
        : "Piece reassigned",
    piece: stripMeta(updated)
  });
<<<<<<< HEAD
});
=======
});
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
