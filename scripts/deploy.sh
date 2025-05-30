#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting deployment..."

# Navigate to project directory
cd /var/www/mcp-app

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin main

# Install and build backend
echo "🔨 Building backend..."
cd backend
npm install
npm run build

# Install and build MCP server
echo "🔨 Building MCP server..."
cd ../mcp-server
npm install
npm run build

# Restart services
echo "🔄 Restarting services..."
cd ..
pm2 restart mcp-backend
pm2 restart mcp-server

echo "✅ Deployment completed successfully!" 