#!/bin/bash

# MCP Backend Monitoring Script
# Run this script to check the health and status of your backend

set -e

echo "🔍 MCP Backend Health Check"
echo "=========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check PM2 status
echo ""
print_info "Checking PM2 Process Status..."
if command -v pm2 &> /dev/null; then
    PM2_STATUS=$(pm2 list | grep mcp-backend || echo "NOT_FOUND")
    if [[ $PM2_STATUS == *"online"* ]]; then
        print_status "PM2 process is running"
        pm2 list | grep mcp-backend
    elif [[ $PM2_STATUS == *"stopped"* ]]; then
        print_error "PM2 process is stopped"
        echo "To restart: pm2 restart mcp-backend"
    elif [[ $PM2_STATUS == *"errored"* ]]; then
        print_error "PM2 process has errors"
        echo "Check logs: pm2 logs mcp-backend"
    else
        print_error "PM2 process not found"
        echo "To start: pm2 start ecosystem.config.cjs"
    fi
else
    print_error "PM2 not installed"
fi

# Check if port 8080 is listening
echo ""
print_info "Checking if port 8080 is listening..."
if netstat -tlnp 2>/dev/null | grep -q ":8080"; then
    print_status "Port 8080 is listening"
    netstat -tlnp | grep ":8080"
else
    print_error "Port 8080 is not listening"
fi

# Check local health endpoint
echo ""
print_info "Testing local health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "%{http_code}" http://localhost:8080/api/health 2>/dev/null || echo "FAILED")
HTTP_CODE=$(echo $HEALTH_RESPONSE | tail -c 4)
RESPONSE_BODY=$(echo $HEALTH_RESPONSE | head -c -4)

if [[ $HTTP_CODE == "200" ]]; then
    print_status "Health endpoint responding (HTTP 200)"
    echo "Response: $RESPONSE_BODY"
elif [[ $HEALTH_RESPONSE == "FAILED" ]]; then
    print_error "Health endpoint not responding"
else
    print_warning "Health endpoint responding with HTTP $HTTP_CODE"
    echo "Response: $RESPONSE_BODY"
fi

# Check nginx status
echo ""
print_info "Checking Nginx status..."
if sudo systemctl is-active --quiet nginx; then
    print_status "Nginx is running"
else
    print_error "Nginx is not running"
    echo "To start: sudo systemctl start nginx"
fi

# Check nginx configuration
echo ""
print_info "Checking Nginx configuration..."
if sudo nginx -t 2>/dev/null; then
    print_status "Nginx configuration is valid"
else
    print_error "Nginx configuration has errors"
fi

# Check external health endpoint
echo ""
print_info "Testing external health endpoint..."
EXTERNAL_HEALTH=$(curl -s -w "%{http_code}" https://mcp.worxstream.io/health 2>/dev/null || echo "FAILED")
EXTERNAL_HTTP_CODE=$(echo $EXTERNAL_HEALTH | tail -c 4)
EXTERNAL_RESPONSE_BODY=$(echo $EXTERNAL_HEALTH | head -c -4)

if [[ $EXTERNAL_HTTP_CODE == "200" ]]; then
    print_status "External health endpoint responding (HTTP 200)"
    echo "Response: $EXTERNAL_RESPONSE_BODY"
elif [[ $EXTERNAL_HEALTH == "FAILED" ]]; then
    print_error "External health endpoint not responding"
else
    print_warning "External health endpoint responding with HTTP $EXTERNAL_HTTP_CODE"
    echo "Response: $EXTERNAL_RESPONSE_BODY"
fi

# Check system resources
echo ""
print_info "Checking system resources..."
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1

echo "Memory Usage:"
free -h | grep -E "Mem|Swap"

echo "Disk Usage:"
df -h / | tail -1

# Check recent logs
echo ""
print_info "Recent PM2 logs (last 10 lines):"
pm2 logs mcp-backend --lines 10 2>/dev/null || echo "No logs available"

# Check environment variables
echo ""
print_info "Checking environment variables..."
if [ -f ".env" ]; then
    print_status ".env file exists"
    echo "Environment variables:"
    grep -E "^(ANTHROPIC_API_KEY|NODE_ENV|PORT|MCP_SERVER_PATH)=" .env | sed 's/=.*/=***/' || echo "No key environment variables found"
else
    print_error ".env file not found"
fi

# Check if MCP server exists
echo ""
print_info "Checking MCP server path..."
MCP_PATH=$(grep "MCP_SERVER_PATH" .env | cut -d'=' -f2 2>/dev/null || echo "/var/www/mcp-app/mcp-server/dist/mcp-server.js")
if [ -f "$MCP_PATH" ]; then
    print_status "MCP server file exists at: $MCP_PATH"
else
    print_error "MCP server file not found at: $MCP_PATH"
fi

# Check network connectivity
echo ""
print_info "Checking network connectivity..."
if ping -c 1 8.8.8.8 &> /dev/null; then
    print_status "Internet connectivity OK"
else
    print_error "No internet connectivity"
fi

echo ""
echo "🔧 Troubleshooting Commands:"
echo "  Restart backend: pm2 restart mcp-backend"
echo "  View logs: pm2 logs mcp-backend --lines 50"
echo "  Monitor: pm2 monit"
echo "  Restart nginx: sudo systemctl restart nginx"
echo "  Check nginx logs: sudo tail -f /var/log/nginx/error.log"
echo "  Check system logs: sudo journalctl -u nginx -f" 