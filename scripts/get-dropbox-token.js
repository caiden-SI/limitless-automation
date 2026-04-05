#!/usr/bin/env node
// Exchange a Dropbox authorization code for a refresh token.
// Usage: node scripts/get-dropbox-token.js

require('dotenv').config();
const { createInterface } = require('readline');
const { exec } = require('child_process');

const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;

if (!APP_KEY || !APP_SECRET) {
  console.error('Missing DROPBOX_APP_KEY or DROPBOX_APP_SECRET in .env');
  process.exit(1);
}

const authUrl =
  `https://www.dropbox.com/oauth2/authorize` +
  `?client_id=${APP_KEY}` +
  `&response_type=code` +
  `&token_access_type=offline`;

console.log('\n=== Dropbox OAuth — Get Refresh Token ===\n');
console.log('Opening browser to authorize the app...\n');

// Open URL in default browser (cross-platform)
const openCmd = process.platform === 'win32' ? 'start' :
                process.platform === 'darwin' ? 'open' : 'xdg-open';
exec(`${openCmd} "${authUrl}"`);

console.log('If the browser did not open, go to:\n');
console.log(`  ${authUrl}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question('Paste the authorization code here: ', async (code) => {
  rl.close();
  code = code.trim();
  if (!code) {
    console.error('No code provided.');
    process.exit(1);
  }

  try {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: APP_KEY,
        client_secret: APP_SECRET,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`\nToken exchange failed (${res.status}):`);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('\n=== Success ===\n');
    console.log(`DROPBOX_REFRESH_TOKEN=${data.refresh_token}`);
    console.log(`\nAccess token (short-lived): ${data.access_token.slice(0, 20)}...`);
    console.log(`Expires in: ${data.expires_in}s`);
    console.log('\nAdd the refresh token to your .env file.');
  } catch (err) {
    console.error('\nRequest failed:', err.message);
    process.exit(1);
  }
});
