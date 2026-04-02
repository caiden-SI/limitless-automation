// Express.js webhook server — receives events from ClickUp, Dropbox, Frame.io.
// Managed by PM2 for auto-restart. All routes verify signatures before processing.

require('dotenv').config();

const express = require('express');
const { log } = require('./lib/logger');
const clickupHandler = require('./handlers/clickup');
const dropboxHandler = require('./handlers/dropbox');
const frameioHandler = require('./handlers/frameio');
const scheduler = require('./lib/scheduler');
const research = require('./agents/research');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies — need raw body preserved for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // Store raw body buffer for webhook signature verification
      req.rawBody = buf;
    },
  })
);

// Health check — useful for PM2 monitoring and quick verification
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook routes
app.post('/webhooks/clickup', clickupHandler);
app.post('/webhooks/dropbox', dropboxHandler);
app.post('/webhooks/frameio', frameioHandler);

// Dropbox requires GET for webhook verification challenge
app.get('/webhooks/dropbox', (req, res) => {
  // Dropbox sends a challenge parameter on webhook registration — echo it back
  const challenge = req.query.challenge;
  if (challenge) {
    res.set('Content-Type', 'text/plain');
    res.send(challenge);
    return;
  }
  res.status(400).send('Missing challenge parameter');
});

// Global error handler — catch unhandled route errors
app.use((err, _req, res, _next) => {
  log({
    agent: 'server',
    action: 'unhandled_route_error',
    status: 'error',
    errorMessage: err.message,
    payload: { stack: err.stack },
  });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] Limitless webhook server listening on port ${PORT}`);
  log({ agent: 'server', action: `started on port ${PORT}` });

  // Register scheduled agent jobs
  // Research Agent — daily at 6 AM
  scheduler.register('research-agent', '0 6 * * *', research.runAll);
});

// Catch unhandled promise rejections — log before PM2 restarts
process.on('unhandledRejection', (reason) => {
  log({
    agent: 'server',
    action: 'unhandled_rejection',
    status: 'error',
    errorMessage: reason instanceof Error ? reason.message : String(reason),
    payload: { stack: reason instanceof Error ? reason.stack : null },
  });
});
