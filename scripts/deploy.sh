#!/bin/bash

set -euo pipefail
echo "🚀 Starting deployment..."

# Base project path
APP_PATH="/var/www/mcp-app"
cd "$APP_PATH"

# Pull latest changes
echo "📥 Stashing and pulling latest changes from Git..."
git stash push -m "stash before deploy" --include-untracked || true
git pull origin main
git stash pop || true

# 🔧 Update Nginx config
echo "🧩 Updating nginx.conf..."
sudo cp "$APP_PATH/config/nginx.conf" /etc/nginx/sites-available/default

echo "🧪 Testing Nginx config..."
sudo nginx -t

echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

# Backend
echo "🔨 Installing & building backend..."
cd backend
npm ci
npm run build

# Restart backend service
echo "🔄 Restarting mcp-backend with PM2..."
pm2 start ecosystem.config.cjs --only mcp-backend || pm2 restart ecosystem.config.cjs --only mcp-backend

# MCP Server
echo "🔨 Installing & building MCP server..."
cd ../mcp-server
npm ci
npm run build

# Restart MCP server service
echo "🔄 Restarting mcp-server with PM2..."
cd ../backend
pm2 start ecosystem.config.cjs --only mcp-server || pm2 restart ecosystem.config.cjs --only mcp-server

cd "$APP_PATH"
echo "✅ Deployment completed successfully!"
