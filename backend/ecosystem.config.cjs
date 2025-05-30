module.exports = {
  apps: [
    {
      name: "mcp-backend",
      script: "./dist/server.js",
      cwd: "/var/www/mcp-app/backend",
      env: require('dotenv').config().parsed // pulls from .env dynamically
    }
  ]
};
