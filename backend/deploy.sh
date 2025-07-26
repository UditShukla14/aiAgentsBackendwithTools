#!/bin/bash

# MCP Backend Deployment Script
# Run this script on your DigitalOcean droplet

set -e

echo "🚀 Starting MCP Backend Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Set variables
APP_DIR="/var/www/mcp-app"
BACKEND_DIR="$APP_DIR/backend"
LOG_DIR="/var/log/pm2"

print_status "Setting up deployment environment..."

# Create necessary directories
sudo mkdir -p $APP_DIR
sudo mkdir -p $LOG_DIR
sudo chown -R $USER:$USER $APP_DIR
sudo chown -R $USER:$USER $LOG_DIR

# Navigate to backend directory
cd $BACKEND_DIR

print_status "Installing dependencies..."
npm ci --production

print_status "Building the application..."
npm run build

# Check if build was successful
if [ ! -f "./dist/server.js" ]; then
    print_error "Build failed! dist/server.js not found"
    exit 1
fi

print_status "Setting up environment variables..."
# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    print_warning "No .env file found. Please create one with your environment variables:"
    echo "ANTHROPIC_API_KEY=your_api_key_here"
    echo "MCP_SERVER_PATH=/var/www/mcp-app/mcp-server/dist/mcp-server.js"
    echo "NODE_ENV=production"
    echo "PORT=8080"
    exit 1
fi

print_status "Installing PM2 globally..."
npm install -g pm2

print_status "Stopping existing PM2 processes..."
pm2 stop mcp-backend 2>/dev/null || true
pm2 delete mcp-backend 2>/dev/null || true

print_status "Starting application with PM2..."
pm2 start ecosystem.config.cjs

print_status "Saving PM2 configuration..."
pm2 save

print_status "Setting up PM2 startup script..."
pm2 startup

print_status "Checking application status..."
sleep 5

# Check if the application is running
if pm2 list | grep -q "mcp-backend.*online"; then
    print_status "✅ Application is running successfully!"
else
    print_error "❌ Application failed to start. Check logs with: pm2 logs mcp-backend"
    pm2 logs mcp-backend --lines 20
    exit 1
fi

print_status "Testing health endpoint..."
sleep 3

# Test the health endpoint
HEALTH_RESPONSE=$(curl -s http://localhost:8080/api/health || echo "FAILED")
if [[ $HEALTH_RESPONSE == *"healthy"* ]]; then
    print_status "✅ Health check passed!"
else
    print_warning "⚠️  Health check failed. Response: $HEALTH_RESPONSE"
fi

print_status "Setting up log rotation..."
# Create logrotate configuration
sudo tee /etc/logrotate.d/pm2-mcp-backend > /dev/null <<EOF
/var/log/pm2/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

print_status "Restarting nginx..."
sudo systemctl restart nginx

print_status "Checking nginx status..."
if sudo systemctl is-active --quiet nginx; then
    print_status "✅ Nginx is running!"
else
    print_error "❌ Nginx failed to start"
    sudo systemctl status nginx
fi

print_status "🎉 Deployment completed successfully!"
echo ""
echo "📋 Useful commands:"
echo "  View logs: pm2 logs mcp-backend"
echo "  Restart app: pm2 restart mcp-backend"
echo "  Stop app: pm2 stop mcp-backend"
echo "  Monitor: pm2 monit"
echo "  Health check: curl https://mcp.worxstream.io/health"
echo ""
echo "🔍 To monitor the application:"
echo "  pm2 monit"
echo ""
echo "📊 To view real-time logs:"
echo "  pm2 logs mcp-backend --lines 100 -f" 