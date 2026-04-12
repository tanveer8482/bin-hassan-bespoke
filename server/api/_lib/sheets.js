const { google } = require("googleapis");
const { REQUIRED_HEADERS } = require("./constants");
const { getEnv } = require("./env");

let sheetsApiPromise = null;
let schemaEnsured = false;
let schemaEnsurePromise = null;
const headerCache = new Map();
const sheetIdCache = new Map();

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

function normalizeSheetTitle(range = "") {
  const [rawTitle] = range.split("!");
  if (!rawTitle) return "";
  return rawTitle.replace(/^'/, "").replace(/'$/, "");
}

function mergeHeaders(existingHeaders = [], requiredHeaders = []) {
  const merged = [...existingHeaders];
  requiredHeaders.forEach((header) => {
    if (!header) return;
    if (!merged.includes(header)) merged.push(header);
  });
  return merged;
}

function hasSameHeaderOrder(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function cacheHeaders(tabName, headers = []) {
  headerCache.set(tabName, [...headers]);
}

function getCachedHeaders(tabName) {
  const headers = headerCache.get(tabName);
  return headers ? [...headers] : null;
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
  if (sheetIdCache.has(tabName)) {
    return sheetIdCache.get(tabName);
  }

  const meta = await getSpreadsheetMeta();
  (meta.sheets || []).forEach((sheet) => {
    const title = sheet.properties?.title;
    const sheetId = sheet.properties?.sheetId;
    if (title && sheetId !== undefined) {
      sheetIdCache.set(title, sheetId);
    }
  });

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

async function ensureHeaders(tabName, headers = []) {
  await ensureWorkbook();

  const required = REQUIRED_HEADERS[tabName] || [];
  const needed = [...new Set([...required, ...headers])];
  const cached = getCachedHeaders(tabName);
  if (cached && needed.every((header) => cached.includes(header))) {
    return cached;
  }

  const env = getEnv();
  const sheets = await getSheetsApi();
  const row1 = await sheets.spreadsheets.values.get({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!1:1`
  });

  const existing = row1.data.values?.[0] || [];
  const merged = mergeHeaders(existing, needed);

  if (!hasSameHeaderOrder(existing, merged)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: env.sheetsId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [merged]
      }
    });
  }

  cacheHeaders(tabName, merged);
  return merged;
}

async function ensureWorkbook() {
  if (schemaEnsured) return;
  if (schemaEnsurePromise) return schemaEnsurePromise;

  schemaEnsurePromise = (async () => {
    const env = getEnv();
    const sheets = await getSheetsApi();
    const meta = await getSpreadsheetMeta();
    const existingTitles = new Set(
      (meta.sheets || []).map((sheet) => sheet.properties?.title)
    );

    const addSheetRequests = [];
    Object.keys(REQUIRED_HEADERS).forEach((tabName) => {
      if (!existingTitles.has(tabName)) {
        addSheetRequests.push({
          addSheet: {
            properties: { title: tabName }
          }
        });
      }
    });

    if (addSheetRequests.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: env.sheetsId,
        requestBody: { requests: addSheetRequests }
      });
    }

    const latestMeta = addSheetRequests.length ? await getSpreadsheetMeta() : meta;
    (latestMeta.sheets || []).forEach((sheet) => {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      if (title && sheetId !== undefined) {
        sheetIdCache.set(title, sheetId);
      }
    });

    const tabs = Object.keys(REQUIRED_HEADERS);
    const headerRanges = tabs.map((tabName) => `${tabName}!1:1`);
    const headerResult = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: env.sheetsId,
      ranges: headerRanges
    });

    const valuesByTab = new Map();
    (headerResult.data.valueRanges || []).forEach((valueRange) => {
      const tabName = normalizeSheetTitle(valueRange.range || "");
      const headers = valueRange.values?.[0] || [];
      valuesByTab.set(tabName, headers);
    });

    const headerUpdates = [];
    tabs.forEach((tabName) => {
      const existing = valuesByTab.get(tabName) || [];
      const required = REQUIRED_HEADERS[tabName] || [];
      const merged = mergeHeaders(existing, required);

      if (!hasSameHeaderOrder(existing, merged)) {
        headerUpdates.push({
          range: `${tabName}!A1`,
          values: [merged]
        });
      }

      cacheHeaders(tabName, merged);
    });

    if (headerUpdates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: env.sheetsId,
        requestBody: {
          valueInputOption: "RAW",
          data: headerUpdates
        }
      });
    }

    schemaEnsured = true;
  })()
    .catch((error) => {
      schemaEnsured = false;
      throw error;
    })
    .finally(() => {
      schemaEnsurePromise = null;
    });

  return schemaEnsurePromise;
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

function recordsToAppendCells(headers, records) {
  return records.map((record) => ({
    values: recordToRow(headers, record).map((cellValue) => ({
      userEnteredValue: { stringValue: cellValue }
    }))
  }));
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
  const headers = values[0] || getCachedHeaders(tabName) || REQUIRED_HEADERS[tabName] || [];
  const rows = values.slice(1);
  cacheHeaders(tabName, headers);

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
  await appendRecords(tabName, [record]);
  return record;
}

async function appendRecords(tabName, records) {
  if (!records.length) return;
  await ensureWorkbook();

  const env = getEnv();
  const sheets = await getSheetsApi();
  const required = REQUIRED_HEADERS[tabName] || [];
  const allKeys = [...new Set([...required, ...records.flatMap((record) => Object.keys(record))])];
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

async function appendRecordsBatch(operations) {
  const work = (operations || [])
    .filter((entry) => entry && entry.tabName && Array.isArray(entry.records))
    .map((entry) => ({
      tabName: entry.tabName,
      records: entry.records.filter(Boolean)
    }))
    .filter((entry) => entry.records.length > 0);

  if (!work.length) return;
  await ensureWorkbook();

  const env = getEnv();
  const sheets = await getSheetsApi();
  const requests = [];

  for (const entry of work) {
    const required = REQUIRED_HEADERS[entry.tabName] || [];
    const allKeys = [
      ...new Set([
        ...required,
        ...entry.records.flatMap((record) => Object.keys(record))
      ])
    ];
    const headers = await ensureHeaders(entry.tabName, allKeys);
    const sheetId = await getSheetId(entry.tabName);

    requests.push({
      appendCells: {
        sheetId,
        rows: recordsToAppendCells(headers, entry.records),
        fields: "userEnteredValue"
      }
    });
  }

  if (!requests.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: env.sheetsId,
    requestBody: { requests }
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
  await ensureWorkbook();
  const env = getEnv();
  const sheets = await getSheetsApi();
  const { headers, records } = await getRows(tabName);
  const target = records.find((record) => record[field] === value);
  if (!target) {
    const error = new Error(`${tabName} record not found for ${field}=${value}`);
    error.statusCode = 404;
    throw error;
  }

  const merged = { ...target, ...patch };
  const lastColumn = toColumnLabel(headers.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.sheetsId,
    range: `${tabName}!A${target.__rowNumber}:${lastColumn}${target.__rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [recordToRow(headers, merged)]
    }
  });

  return { ...merged, __rowNumber: target.__rowNumber };
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
  appendRecordsBatch,
  deleteByField,
  deleteRecord,
  ensureWorkbook,
  getRecords,
  getRows,
  updateByField,
  updateMany,
  updateRecord
};
