const { google } = require("googleapis");
const { REQUIRED_HEADERS } = require("./constants");
const { getEnv } = require("./env");

let sheetsApiPromise = null;
let schemaEnsured = false;

function toColumnLabel(columnIndex) {
  let label = "";
  let value = columnIndex;
  while (value > 0) {
    const modulo = (value - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    value = Math.floor((value - modulo) / 26);
  }
  return label;
}

async function getSheetsApi() {
  if (sheetsApiPromise) return sheetsApiPromise;

  const env = getEnv();
  const auth = new google.auth.JWT({
    email: env.serviceAccountEmail,
    key: env.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  sheetsApiPromise = Promise.resolve(
    google.sheets({
      version: "v4",
      auth
    })
  );

  return sheetsApiPromise;
}

async function getSpreadsheetMeta() {
  const env = getEnv();
  const sheets = await getSheetsApi();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: env.sheetsId
  });
  return response.data;
}

async function getSheetId(tabName) {
  const meta = await getSpreadsheetMeta();
  const target = (meta.sheets || []).find(
    (sheet) => sheet.properties?.title === tabName
  );

  if (!target) {
    const error = new Error(`Sheet tab not found: ${tabName}`);
    error.statusCode = 404;
    throw error;
  }

  return target.properties.sheetId;
}

async function ensureHeaders(tabName, headers) {
  const env = getEnv();
  const sheets = await getSheetsApi();
  const row1 = await sheets.spreadsheets.values.get({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!1:1`
  });

  const existing = row1.data.values?.[0] || [];
  const merged = [...existing];

  headers.forEach((header) => {
    if (!merged.includes(header)) merged.push(header);
  });

  if (!existing.length || merged.length !== existing.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.sheetsId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [merged]
      }
    });
  }

  return merged;
}

async function ensureWorkbook() {
  if (schemaEnsured) return;

  const env = getEnv();
  const sheets = await getSheetsApi();
  const meta = await getSpreadsheetMeta();
  const existingTitles = new Set(
    (meta.sheets || []).map((sheet) => sheet.properties?.title)
  );

  const requests = [];

  Object.keys(REQUIRED_HEADERS).forEach((tabName) => {
    if (!existingTitles.has(tabName)) {
      requests.push({
        addSheet: {
          properties: { title: tabName }
        }
      });
    }
  });

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.sheetsId,
      requestBody: { requests }
    });
  }

  const tabs = Object.keys(REQUIRED_HEADERS);
  for (const tabName of tabs) {
    await ensureHeaders(tabName, REQUIRED_HEADERS[tabName]);
  }

  schemaEnsured = true;
}

function rowsToRecords(headers, rows, startingRow = 2) {
  return (rows || []).map((row, index) => {
    const record = {};
    headers.forEach((header, columnIndex) => {
      record[header] = row[columnIndex] ?? "";
    });
    record.__rowNumber = startingRow + index;
    return record;
  });
}

function recordToRow(headers, record) {
  return headers.map((header) => (record[header] ?? "").toString());
}

async function getRows(tabName) {
  await ensureWorkbook();
  const env = getEnv();
  const sheets = await getSheetsApi();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!A:ZZ`
  });

  const values = response.data.values || [];
  const headers = values[0] || REQUIRED_HEADERS[tabName] || [];
  const rows = values.slice(1);

  return {
    headers,
    rows,
    records: rowsToRecords(headers, rows)
  };
}

async function getRecords(tabName) {
  const result = await getRows(tabName);
  return result.records;
}

async function appendRecord(tabName, record) {
  await ensureWorkbook();
  const env = getEnv();
  const sheets = await getSheetsApi();
  const headers = await ensureHeaders(tabName, Object.keys(record));

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!A:ZZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [recordToRow(headers, record)]
    }
  });

  return record;
}

async function appendRecords(tabName, records) {
  if (!records.length) return;
  await ensureWorkbook();

  const env = getEnv();
  const sheets = await getSheetsApi();
  const allKeys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const headers = await ensureHeaders(tabName, allKeys);
  const values = records.map((record) => recordToRow(headers, record));

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!A:ZZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

async function updateRecord(tabName, rowNumber, patch) {
  await ensureWorkbook();
  const env = getEnv();
  const sheets = await getSheetsApi();
  const { headers, records } = await getRows(tabName);

  const existing = records.find((record) => record.__rowNumber === rowNumber);
  if (!existing) {
    const error = new Error(`Row not found in ${tabName}: ${rowNumber}`);
    error.statusCode = 404;
    throw error;
  }

  const merged = { ...existing, ...patch };
  const lastColumn = toColumnLabel(headers.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!A${rowNumber}:${lastColumn}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [recordToRow(headers, merged)]
    }
  });

  return { ...merged, __rowNumber: rowNumber };
}

async function updateByField(tabName, field, value, patch) {
  const records = await getRecords(tabName);
  const target = records.find((record) => record[field] === value);
  if (!target) {
    const error = new Error(`${tabName} record not found for ${field}=${value}`);
    error.statusCode = 404;
    throw error;
  }
  return updateRecord(tabName, target.__rowNumber, patch);
}

async function updateMany(tabName, rows) {
  if (!rows.length) return;
  await ensureWorkbook();
  const env = getEnv();
  const sheets = await getSheetsApi();
  const { headers } = await getRows(tabName);
  const lastColumn = toColumnLabel(headers.length);

  const data = rows.map((row) => ({
    range: `${tabName}!A${row.rowNumber}:${lastColumn}${row.rowNumber}`,
    values: [recordToRow(headers, row.record)]
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.sheetsId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data
    }
  });
}

async function deleteRecord(tabName, rowNumber) {
  await ensureWorkbook();
  const env = getEnv();
  const sheets = await getSheetsApi();
  const sheetId = await getSheetId(tabName);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: env.sheetsId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    }
  });
}

async function deleteByField(tabName, field, value) {
  const records = await getRecords(tabName);
  const target = records.find((record) => record[field] === value);
  if (!target) {
    const error = new Error(`${tabName} record not found for ${field}=${value}`);
    error.statusCode = 404;
    throw error;
  }

  await deleteRecord(tabName, target.__rowNumber);
  return target;
}

module.exports = {
  appendRecord,
  appendRecords,
  deleteByField,
  deleteRecord,
  ensureWorkbook,
  getRecords,
  getRows,
  updateByField,
  updateMany,
  updateRecord
<<<<<<< HEAD
};
=======
};
>>>>>>> 4e59f8e (Vite configuration fixed for Vercel)
