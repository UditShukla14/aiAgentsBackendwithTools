const dotenv = require('dotenv');
const envConfig = dotenv.config().parsed || {};

module.exports = {
  apps: [
    {
      name: "mcp-backend",
      script: "./dist/server.js",
      cwd: "/var/www/mcp-app/backend",
      instances: 1,
      exec_mode: "fork",
      env: {
        ...envConfig,
        NODE_ENV: "production",
        PORT: 8080
      },
      // Process management
      max_memory_restart: "1G",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 4000,
      // Logging
      log_file: "/var/log/pm2/mcp-backend.log",
      out_file: "/var/log/pm2/mcp-backend-out.log",
      error_file: "/var/log/pm2/mcp-backend-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Monitoring
      watch: false,
      ignore_watch: ["node_modules", "logs"],
      // Health check
      health_check_grace_period: 3000,
      health_check_fatal_exceptions: true
    }
  ]
};
