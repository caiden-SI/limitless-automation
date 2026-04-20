// Express.js webhook server — receives events from ClickUp, Dropbox, Frame.io.
// Managed by PM2 for auto-restart. All routes verify signatures before processing.

require('dotenv').config();

const express = require('express');
const { log } = require('./lib/logger');
const clickupHandler = require('./handlers/clickup');
const dropboxHandler = require('./handlers/dropbox');
const frameioHandler = require('./handlers/frameio');
const onboarding = require('./agents/onboarding');
const scheduler = require('./lib/scheduler');
const research = require('./agents/research');
const performance = require('./agents/performance');
const scripting = require('./agents/scripting');

const { execFile } = require('child_process');

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

// Onboarding routes
app.post('/onboarding/message', async (req, res) => {
  try {
    const { studentId, campusId, message } = req.body;

    if (!studentId || !campusId) {
      return res.status(400).json({ error: 'studentId and campusId are required' });
    }

    // Look up student — check completion guard
    const { supabase } = require('./lib/supabase');
    const { data: student, error: sErr } = await supabase
      .from('students')
      .select('id, name, onboarding_completed_at, claude_project_context')
      .eq('id', studentId)
      .eq('campus_id', campusId)
      .maybeSingle();

    if (sErr) throw new Error(`Supabase query failed (students): ${sErr.message}`);
    if (!student) {
      return res.status(404).json({ error: 'Student not found for this campus' });
    }

    // Completion guard: if already onboarded, return existing context
    if (student.onboarding_completed_at) {
      return res.json({
        reply: 'Your context is ready!',
        section: 6,
        isComplete: true,
        contextDocument: student.claude_project_context,
      });
    }

    // State lives server-side — client only sends the message
    const result = await onboarding.handleMessage({
      studentId,
      campusId,
      studentName: student.name,
      message: message || '',
    });

    res.json({
      reply: result.reply,
      section: result.section,
      isComplete: result.isComplete,
      contextDocument: result.contextDocument,
    });
  } catch (err) {
    await log({
      agent: 'onboarding',
      action: 'endpoint_error',
      status: 'error',
      errorMessage: err.message,
      payload: { stack: err.stack },
    });
    res.status(500).json({ error: 'Onboarding message failed' });
  }
});

app.get('/onboarding/student', async (req, res) => {
  try {
    const { studentId, campusId } = req.query;

    if (!studentId || !campusId) {
      return res.status(400).json({ error: 'studentId and campusId are required' });
    }

    const { supabase } = require('./lib/supabase');
    const { data: student, error: sErr } = await supabase
      .from('students')
      .select('id, name, onboarding_completed_at')
      .eq('id', studentId)
      .eq('campus_id', campusId)
      .maybeSingle();

    if (sErr) throw new Error(`Supabase query failed (students): ${sErr.message}`);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      id: student.id,
      name: student.name,
      onboardingCompleted: !!student.onboarding_completed_at,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch student' });
  }
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

  // Startup health checks
  execFile('ffmpeg', ['-version'], (err) => {
    if (err) {
      console.error('[server] WARNING: FFmpeg is not installed — QA LUFS checks will fail closed');
      log({ agent: 'server', action: 'health_check_ffmpeg', status: 'warning', payload: { available: false } });
    } else {
      console.log('[server] FFmpeg: available');
      log({ agent: 'server', action: 'health_check_ffmpeg', payload: { available: true } });
    }
  });

  // Register scheduled agent jobs
  // Research Agent — daily at 6 AM
  scheduler.register('research-agent', '0 6 * * *', research.runAll);
  // Performance Analysis Agent — every Monday at 7 AM
  scheduler.register('performance-agent', '0 7 * * 1', performance.runAll);
  // Scripting Agent — every 15 minutes, 48-hour lookahead on Google Calendar
  scheduler.register('scripting-agent', '*/15 * * * *', scripting.runAll);
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
