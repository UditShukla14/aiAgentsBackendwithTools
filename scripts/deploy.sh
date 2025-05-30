#!/bin/bash

# Exit on any error
set -e

echo "🚀 Starting deployment..."

# Ensure we’re in the root project directory
cd /var/www/mcp-app

# Pull latest changes
echo "📥 Pulling latest changes from Git..."
git pull origin main

# Build Backend
echo "🔨 Building backend..."
cd backend
npm install
npm run build

# Use correct PM2 ecosystem config file
echo "🔄 Restarting mcp-backend with PM2..."
pm2 start ecosystem.config.cjs --only mcp-backend || pm2 restart ecosystem.config.cjs --only mcp-backend

# Build MCP server
echo "🔨 Building MCP server..."
cd ../mcp-server
npm install
npm run build

# Restart MCP server
echo "🔄 Restarting mcp-server with PM2..."
pm2 restart mcp-server || pm2 start ecosystem.config.cjs --only mcp-server

# Return to base folder
cd ..

echo "✅ Deployment completed successfully!"
