#!/bin/bash

set -e
echo "🚀 Starting deployment..."

cd /var/www/mcp-app

# Stash + pull
echo "📥 Stashing and pulling latest changes from Git..."
git stash push -m "stash before deploy" --include-untracked || true
git pull origin main
git stash pop || true

# Build backend
echo "🔨 Installing & building backend..."
cd backend
npm install
npm run build

# Restart backend via PM2
echo "🔄 Restarting mcp-backend with PM2..."
pm2 start ecosystem.config.cjs --only mcp-backend || pm2 restart ecosystem.config.cjs --only mcp-backend

# Build MCP server
echo "🔨 Installing & building MCP server..."
cd ../mcp-server
npm install
npm run build

# ✅ Go BACK to backend folder before restarting mcp-server
echo "🔄 Restarting mcp-server with PM2..."
cd ../backend
pm2 start ecosystem.config.cjs --only mcp-server || pm2 restart ecosystem.config.cjs --only mcp-server

cd ..
echo "✅ Deployment completed successfully!"
