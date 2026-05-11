#!/usr/bin/env node
/**
 * One-time Frame.io v4 webhook registration.
 *
 * Frame.io v4 has no webhook UI — registration is API-only via:
 *   POST /v4/accounts/{account_id}/workspaces/{workspace_id}/webhooks
 *
 * This script:
 *   1. Reads webhook URL, name, and event list from CLI flags
 *   2. Calls createWebhook() via the v4 client (which handles OAuth)
 *   3. Prints the response, including the signing secret (returned
 *      ONLY on initial creation — we don't get a second chance)
 *   4. Tells you exactly what to set FRAMEIO_WEBHOOK_SECRET to in .env
 *
 * Usage:
 *   node scripts/register-frameio-webhook.js \
 *     --name "Limitless QA Comments" \
 *     --url https://your-tunnel.tail-XXXX.ts.net/webhooks/frameio \
 *     --events comment.created
 *
 * Multiple events: comma-separated, e.g. --events comment.created,file.ready
 *
 * After running, copy the signing_secret from the printed response into
 * .env on both your MacBook and the Mac Mini, then pm2 restart limitless-webhooks.
 */

require('dotenv').config();
const { createWebhook, listWebhooks } = require('../lib/frameio');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function usage() {
  console.error('Usage: node scripts/register-frameio-webhook.js --name "Name" --url https://... --events comment.created[,file.ready,...]');
  console.error('');
  console.error('Optional: --list   (list existing webhooks instead of creating)');
  process.exit(1);
}

(async () => {
  const args = parseArgs(process.argv);

  if (args.list) {
    console.log('Listing existing webhooks on the configured workspace...');
    const list = await listWebhooks();
    console.log(JSON.stringify(list, null, 2));
    process.exit(0);
  }

  if (!args.name || !args.url || !args.events) usage();
  if (args.name === true || args.url === true || args.events === true) usage();

  const events = String(args.events).split(',').map((e) => e.trim()).filter(Boolean);
  if (events.length === 0) usage();

  console.log('Registering webhook on Frame.io v4');
  console.log('  Account:   ', process.env.FRAMEIO_ACCOUNT_ID);
  console.log('  Workspace: ', process.env.FRAMEIO_WORKSPACE_ID);
  console.log('  Name:      ', args.name);
  console.log('  URL:       ', args.url);
  console.log('  Events:    ', events.join(', '));
  console.log('');

  const result = await createWebhook({ name: args.name, url: args.url, events });

  console.log('=== FULL RESPONSE ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('');

  // Frame.io v4 returns the signing secret ONLY on creation. Surface it
  // loudly so the operator can copy it into .env immediately.
  const signingSecret =
    result?.data?.signing_secret ||
    result?.data?.secret ||
    result?.signing_secret ||
    result?.secret ||
    null;

  const webhookId = result?.data?.id || result?.id || null;

  if (signingSecret) {
    console.log('=== ACTION REQUIRED ===');
    console.log('Copy this signing secret into .env on BOTH your MacBook and the Mac Mini:');
    console.log('');
    console.log(`FRAMEIO_WEBHOOK_SECRET=${signingSecret}`);
    console.log('');
    console.log(`Webhook ID (save for future updates / deletes): ${webhookId}`);
    console.log('');
    console.log('Then on the Mac Mini:  pm2 restart limitless-webhooks');
  } else {
    console.warn('WARNING: signing_secret not found in response. Inspect the JSON above; the field name may differ from expected.');
    console.warn('If you do not see a secret here, the webhook may not work — verify the response shape and update this script.');
  }

  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(2);
});
