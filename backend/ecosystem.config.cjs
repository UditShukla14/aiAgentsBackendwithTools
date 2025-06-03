const dotenv = require('dotenv');
const envConfig = dotenv.config().parsed || {};

module.exports = {
  apps: [
    {
      name: "mcp-backend",
      script: "./dist/server.js",
      cwd: "/var/www/mcp-app/backend",
      env: {
        ...envConfig,
        NODE_ENV: "production" // ✅ Force production mode
      }
    }
  ]
};
