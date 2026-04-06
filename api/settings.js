const { ROLES, SHEETS } = require("./_lib/constants");
const { requireRole } = require("./_lib/auth");
const { ensureMethod, sendOk } = require("./_lib/http");
const {
  appendRecord,
  ensureWorkbook,
  getRecords,
  updateRecord
} = require("./_lib/sheets");
const {
  normalizeText,
  parseBody,
  requireFields,
  withErrorHandler
} = require("./_lib/utils");

function stripMeta(record) {
  const { __rowNumber, ...rest } = record;
  return rest;
}

async function upsertSetting(incoming) {
  const settings = await getRecords(SHEETS.SETTINGS);
  const existing = settings.find((record) => record.key === incoming.key);

  if (existing) {
    const updated = await updateRecord(SHEETS.SETTINGS, existing.__rowNumber, {
      ...existing,
      ...incoming
    });
    return {
      action: "updated",
      record: stripMeta(updated)
    };
  }

  await appendRecord(SHEETS.SETTINGS, incoming);
  return {
    action: "inserted",
    record: incoming
  };
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["GET", "POST"]);
  requireRole(req, [ROLES.ADMIN]);
  await ensureWorkbook();

  if (req.method === "GET") {
    const settings = await getRecords(SHEETS.SETTINGS);
    return sendOk(res, {
      settings: settings.map(stripMeta),
      last_synced: new Date().toISOString()
    });
  }

  const body = await parseBody(req);

  const rows = Array.isArray(body.settings)
    ? body.settings
    : [body];

  if (!rows.length) {
    const error = new Error("At least one setting row is required");
    error.statusCode = 400;
    throw error;
  }

  const changes = [];
  for (const row of rows) {
    requireFields(row, ["key", "value"]);

    const normalized = {
      key: normalizeText(row.key),
      value: normalizeText(row.value),
      description: normalizeText(row.description)
    };

    changes.push(await upsertSetting(normalized));
  }

  sendOk(res, {
    message: "Settings saved",
    changes
  });
});
