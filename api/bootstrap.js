const bcrypt = require("bcryptjs");
const { ROLES, SHEETS } = require("./_lib/constants");
const { requireRole } = require("./_lib/auth");
const { getEnv } = require("./_lib/env");
const { ensureMethod, sendOk } = require("./_lib/http");
const { appendRecord, ensureWorkbook, getRecords } = require("./_lib/sheets");
const {
  normalizeText,
  parseBody,
  requireFields,
  withErrorHandler
} = require("./_lib/utils");

const DEFAULT_SETTINGS = [
  {
    key: "item_types",
    value: "normal,vip,chapma",
    description: "Allowed item types"
  },
  {
    key: "piece_types",
    value: "coat,pent,waistcoat,suit_2piece,suit_3piece",
    description: "Supported order piece types"
  },
  {
    key: "cutting_rate",
    value: "0",
    description: "Default cutting rate per piece"
  }
];

async function seedDefaults() {
  const settings = await getRecords(SHEETS.SETTINGS);
  const existingKeys = new Set(settings.map((row) => row.key));

  for (const row of DEFAULT_SETTINGS) {
    if (!existingKeys.has(row.key)) {
      await appendRecord(SHEETS.SETTINGS, row);
    }
  }
}

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["POST"]);
  await ensureWorkbook();

  const users = await getRecords(SHEETS.USERS);
  const body = await parseBody(req);

  if (!users.length) {
    requireFields(body, [
      "bootstrap_key",
      "admin_username",
      "admin_password",
      "admin_display_name"
    ]);

    const env = getEnv();
    if (body.bootstrap_key !== env.jwtSecret) {
      const error = new Error("Invalid bootstrap key");
      error.statusCode = 401;
      throw error;
    }

    const record = {
      username: normalizeText(body.admin_username),
      password: await bcrypt.hash(String(body.admin_password), 10),
      role: ROLES.ADMIN,
      display_name: normalizeText(body.admin_display_name),
      entity_id: ""
    };

    await appendRecord(SHEETS.USERS, record);
    await seedDefaults();

    return sendOk(res, {
      message: "Workbook bootstrapped with initial admin user"
    });
  }

  requireRole(req, [ROLES.ADMIN]);
  await seedDefaults();

  sendOk(res, {
    message: "Default settings ensured"
  });
});
