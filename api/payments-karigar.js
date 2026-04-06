const { ROLES, SHEETS } = require("./_lib/constants");
const { requireAuth, requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const { appendRecord, ensureWorkbook, getRecords } = require("./_lib/sheets");
const {
  id,
  normalizeText,
  nowISO,
  parseBody,
  requireFields,
  toNumber,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
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

    const payments = await getRecords(SHEETS.PAYMENTS_KARIGAR);
    const filtered =
      user.role === ROLES.ADMIN
        ? payments
        : payments.filter((payment) => payment.karigar_id === user.entity_id);

    return sendOk(res, {
      payments: filtered.map(stripMeta),
      last_synced: new Date().toISOString()
    });
  }

  const admin = requireRole(req, [ROLES.ADMIN]);
  const body = await parseBody(req);
  requireFields(body, ["karigar_id", "amount"]);

  const record = {
    payment_id: id("pay_karigar"),
    karigar_id: normalizeText(body.karigar_id),
    amount: String(toNumber(body.amount)),
    payment_date: normalizeText(body.payment_date) || nowISO(),
    note: normalizeText(body.note),
    recorded_by: normalizeText(body.recorded_by) || admin.username
  };

  await appendRecord(SHEETS.PAYMENTS_KARIGAR, record);

  sendOk(res, {
    message: "Karigar payment recorded",
    payment: record
  });
});
