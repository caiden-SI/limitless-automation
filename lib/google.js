// Google Sheets client — service-account JWT auth, read-only.
// Used by scripts/sync-performance-tracker.js to pull weekly view counts
// out of the Content Performance Tracker spreadsheet and into the
// `performance` table.
//
// Reuses the same service account JSON as lib/gcal.js (one credential,
// two scopes). The service account email must be granted Viewer on the
// spreadsheet for spreadsheets.values.get to succeed.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let _authClient = null;
let _sheets = null;

function getSheets() {
  if (_sheets) return _sheets;

  const credPath = process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH;
  if (!credPath) {
    throw new Error('GOOGLE_CALENDAR_CREDENTIALS_PATH not set in .env');
  }

  const resolved = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Google service account file not found: ${resolved}`);
  }

  const creds = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  _authClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [SCOPE],
  });
  _sheets = google.sheets({ version: 'v4', auth: _authClient });
  return _sheets;
}

/**
 * Fetch the spreadsheet metadata (sheet titles, IDs, grid sizes).
 * Used to discover which tabs exist without committing to a range.
 * @param {string} spreadsheetId
 * @returns {Promise<object>} the raw Sheets API response.data
 */
async function getSpreadsheetMeta(spreadsheetId) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
  });
  return res.data;
}

/**
 * List the tab names of a spreadsheet, in tab order.
 * @param {string} spreadsheetId
 * @returns {Promise<string[]>}
 */
async function listTabs(spreadsheetId) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  return (meta.sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean);
}

/**
 * Fetch a 2D array of cell values for the given range. Empty cells come
 * back as undefined; trailing empty cells in a row may be omitted entirely.
 *
 * @param {string} spreadsheetId
 * @param {string} range - A1 notation, e.g. `'Alex Mathews'!A1:Z2000`
 * @returns {Promise<Array<Array<any>>>}
 */
async function getSheetValues(spreadsheetId, range) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    // unformatted values so numbers come back as numbers, not "1,234"
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

module.exports = { getSheets, getSpreadsheetMeta, listTabs, getSheetValues };
