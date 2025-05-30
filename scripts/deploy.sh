#!/bin/bash

# Exit immediately on any error
set -e

echo "🚀 Starting deployment..."

# Go to project root
cd /var/www/mcp-app

# Safely stash local changes before pulling
echo "📥 Stashing and pulling latest changes from Git..."
git stash push -m "pre-deploy" --include-untracked || true
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

# Restart MCP server
echo "🔄 Restarting mcp-server with PM2..."
pm2 start ecosystem.config.cjs --only mcp-server || pm2 restart ecosystem.config.cjs --only mcp-server

# Back to root
cd ..

echo "✅ Deployment completed successfully!"
