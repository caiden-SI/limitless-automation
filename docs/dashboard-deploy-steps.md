# Dashboard Phase A — Mac Mini deploy steps

After PR #6 (`feature/dashboard-scoring-fix`) is merged or pulled to the
Mac Mini, complete these steps once to start the health-ping agent. Without
this step, four System Pulse cells (Tunnel, Process manager, FFmpeg, Server
resources) will sit on amber forever because the agent isn't writing pings
to `agent_logs`.

## One-time setup

```bash
# 1. SSH into the Mac Mini (use whatever hostname you've configured)
ssh limitless-mac-mini

# 2. Pull the latest code
cd ~/limitless-automation
git pull origin feature/dashboard-scoring-fix
# or `git pull origin main` after merge

# 3. Add TUNNEL_URL to .env (see step 4 below for what to put here)
nano .env
# Add a line: TUNNEL_URL=https://your-public-tunnel-url
# (No trailing slash. The script appends /health itself.)

# 4. Confirm what TUNNEL_URL should be:
#    Whatever public URL ClickUp currently posts webhooks to.
#    - Tailscale Funnel: https://your-machine.your-tailnet.ts.net
#    - ngrok: the ngrok URL (e.g. https://abc123.ngrok.io)
#    - Other reverse proxy: whatever the public host is

# 5. Reload PM2 — picks up the new health-ping cron entry
pm2 reload ecosystem.config.js

# 6. Tail the health-ping logs to confirm it's running
pm2 logs limitless-health-ping --lines 20
# Should see one line per minute, e.g.:
# [health-ping] ping_tunnel=success ping_pm2=success ping_ffmpeg=success
#               ping_disk=success ping_memory=success
# If any show `error`, the detail tells you what's wrong (e.g. wrong
# TUNNEL_URL, ffmpeg missing, etc.)
```

## Verify in Supabase

```sql
SELECT action, status, error_message, created_at
FROM agent_logs
WHERE agent_name = 'health'
ORDER BY created_at DESC
LIMIT 15;
```

You should see 5 rows per minute, one per ping action (`ping_tunnel`,
`ping_pm2`, `ping_ffmpeg`, `ping_disk`, `ping_memory`), all `status='success'`
under normal conditions.

## Verify on the dashboard

1. Wait 60–90 seconds after PM2 reloads.
2. Refresh `/ops` (anywhere — laptop, Mac Mini, doesn't matter; the data is
   in Supabase).
3. Four cells should turn green: Webhook tunnel, Process manager, FFmpeg,
   Server resources.
4. Hover or click each — detail line reads e.g. "tunnel verified · last
   ping 12s ago", "all PM2 processes online", etc.

## Synthetic test (optional)

To prove the cells respond to actual failures:

```bash
# Stop the tunnel temporarily
sudo tailscale down  # or stop your ngrok / reverse proxy

# Wait 3 minutes — three consecutive ping_tunnel failures are needed
# to push the cell to red.

# Open dashboard, watch:
#  - Webhook tunnel cell turns red
#  - Action item appears: "Tunnel verification failing"
#  - Detail line shows the actual error (connection refused, timeout, etc.)

# Restart the tunnel
sudo tailscale up

# Wait 1–5 minutes for the failure rows to age out of the count window.
# Cell returns to green automatically.
```

## If something goes wrong

- **Pings don't appear in `agent_logs`:** check `pm2 logs
  limitless-health-ping --err` for runtime errors. Most common cause is
  missing `SUPABASE_SERVICE_KEY` or `CAMPUS_ID` in `.env`.
- **`ping_tunnel` always errors:** check `TUNNEL_URL` in `.env` matches
  what's actually reachable from the public internet. Test from outside
  the network with `curl https://your-tunnel-url/health` — should return
  `ok`.
- **`ping_pm2` errors:** the script runs `pm2 jlist`. If `pm2` isn't on
  the script's PATH, you may need to give the script the absolute path
  (e.g. `/usr/local/bin/pm2`). Check the cron entry in
  `ecosystem.config.js`.
- **`ping_ffmpeg` errors:** ffmpeg isn't installed or not on PATH. Install
  with `brew install ffmpeg` if missing.

## Background / context

The health-ping agent (`scripts/health-ping.js`) runs every 60 seconds via
PM2 cron and writes one row per check to `agent_logs` with
`agent_name='health'` and a distinct `action` (`ping_tunnel`, `ping_pm2`,
etc). The dashboard's `get_campus_system_health_summary` RPC reads the most
recent ping result for each check; the System Pulse cells in
`dashboard/src/lib/health.js` translate those into green/amber/red states.

This replaces the old time-based "no webhook in N hours" detection with
active verification. Pre-launch quiet weekends no longer flag the tunnel
as broken — only actual ping failures do.
