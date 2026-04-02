// PM2 ecosystem config — manages webhook server with auto-restart on crash.
// Usage: pm2 start ecosystem.config.js
// Runs on Mac Mini (always-on). All credentials loaded from .env via dotenv.
module.exports = {
  apps: [
    {
      name: 'limitless-webhooks',
      script: 'server.js',
      instances: 1,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },

      // Auto-restart — PM2 is the last line of defense per error handling rules
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,

      // Memory limit — restart if leak pushes past 512MB
      max_memory_restart: '512M',

      // Logging — PM2 handles rotation, timestamps prepended
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
