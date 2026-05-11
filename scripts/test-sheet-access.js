#!/usr/bin/env node
/**
 * One-off verification: does the service account in
 * GOOGLE_CALENDAR_CREDENTIALS_PATH have read + edit access to the
 * Sheet identified by argv[2]?
 *
 * Reads cell A1 (verifies viewer access).
 * Writes a static test value to Z100 (verifies editor access).
 * Clears Z100 (cleanup so the Sheet stays clean).
 *
 * Run: node scripts/test-sheet-access.js <SHEET_ID>
 */

require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');

const SHEET_ID = process.argv[2];
if (!SHEET_ID) {
  console.error('Usage: node scripts/test-sheet-access.js <SHEET_ID>');
  process.exit(1);
}

const credPath = process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH;
if (!credPath) {
  console.error('Missing GOOGLE_CALENDAR_CREDENTIALS_PATH in .env');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));

const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

(async () => {
  console.log('Service account:', creds.client_email);
  console.log('Sheet ID:', SHEET_ID);
  console.log('');

  // 1. READ test
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'A1',
    });
    const value = r.data.values && r.data.values[0] && r.data.values[0][0];
    console.log('READ OK -- A1 value:', value || '(empty)');
  } catch (err) {
    console.error('READ FAILED:', err.message);
    console.error('  Either the Sheet ID is wrong or the service account has no access.');
    process.exit(2);
  }

  // 2. WRITE test
  const testCell = 'Z100';
  const testValue = 'svc_test_value';
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: testCell,
      valueInputOption: 'RAW',
      requestBody: { values: [[testValue]] },
    });
    console.log('WRITE OK -- wrote', testValue, 'to', testCell);
  } catch (err) {
    console.error('WRITE FAILED:', err.message);
    console.error('  Service account can read but not write.');
    console.error('  Re-share the Sheet with Editor permission for', creds.client_email);
    process.exit(3);
  }

  // 3. CLEANUP
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: testCell,
    });
    console.log('CLEANUP OK -- Z100 cleared');
  } catch (err) {
    console.warn('cleanup warning:', err.message);
    console.warn('  Test value may still be sitting in cell Z100; clear manually if so.');
  }

  process.exit(0);
})();
