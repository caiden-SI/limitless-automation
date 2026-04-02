// PM2 ecosystem config — manages webhook server with auto-restart on crash.
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'limitless-webhooks',
      script: 'server.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      // Logging
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
