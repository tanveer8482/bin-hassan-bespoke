const { authenticate, createToken } = require("./_lib/auth");
const { getEnv } = require("./_lib/env");
const { ensureMethod, sendOk } = require("./_lib/http");
const { ensureWorkbook, getRecords } = require("./_lib/sheets");
const { parseBody, requireFields, withErrorHandler } = require("./_lib/utils");
const { SHEETS } = require("./_lib/constants");

module.exports = withErrorHandler(async (req, res) => {
  ensureMethod(req, ["POST"]);
  await ensureWorkbook();

  const existingUsers = await getRecords(SHEETS.USERS);
  if (!existingUsers.length) {
    const error = new Error(
      "No users found in Users sheet. Seed an admin user first."
    );
    error.statusCode = 400;
    throw error;
  }

  const body = await parseBody(req);
  requireFields(body, ["username", "password"]);

  const user = await authenticate(body.username, body.password);
  const token = createToken(user);
  const env = getEnv();

  sendOk(res, {
    token,
    user,
    poll_interval_ms: env.pollIntervalMs,
    last_synced: new Date().toISOString()
  });
});
