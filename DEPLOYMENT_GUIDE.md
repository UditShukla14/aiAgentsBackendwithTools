# MCP Backend Deployment Guide

This guide will help you fix the 502 Bad Gateway error and properly deploy your MCP backend on DigitalOcean.

## 🚨 Current Issue: 502 Bad Gateway

The 502 Bad Gateway error occurs when Nginx cannot connect to your backend server. This typically happens when:

1. The Node.js backend is not running
2. PM2 is not properly managing the process
3. Environment variables are missing
4. The backend is crashing due to errors

## 🔧 Quick Fix Steps

### 1. SSH into your DigitalOcean droplet
```bash
ssh root@your-droplet-ip
```

### 2. Navigate to your backend directory
```bash
cd /var/www/mcp-app/backend
```

### 3. Check if the backend is running
```bash
pm2 list
```

### 4. If not running, start it properly
```bash
# Install dependencies
npm ci --production

# Build the application
npm run build

# Start with PM2
pm2 start ecosystem.config.cjs

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

### 5. Check the logs for errors
```bash
pm2 logs mcp-backend --lines 50
```

## 📋 Complete Deployment Process

### Step 1: Prepare Environment Variables

Create a `.env` file in your backend directory:

```bash
cd /var/www/mcp-app/backend
nano .env
```

Add the following content:
```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
MCP_SERVER_PATH=/var/www/mcp-app/mcp-server/dist/mcp-server.js
NODE_ENV=production
PORT=8080
```

### Step 2: Run the Deployment Script

```bash
# Make the script executable
chmod +x deploy.sh

# Run the deployment script
./deploy.sh
```

### Step 3: Verify Deployment

```bash
# Run the monitoring script
chmod +x monitor.sh
./monitor.sh
```

## 🔍 Troubleshooting

### Check if the backend is running
```bash
# Check PM2 status
pm2 list

# Check if port 8080 is listening
netstat -tlnp | grep :8080

# Test local health endpoint
curl http://localhost:8080/api/health
```

### Check logs for errors
```bash
# PM2 logs
pm2 logs mcp-backend --lines 100

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# System logs
sudo journalctl -u nginx -f
```

### Common Issues and Solutions

#### Issue 1: PM2 process not found
```bash
# Start the application
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

#### Issue 2: Port 8080 not listening
```bash
# Check if the process is running
ps aux | grep node

# Restart the application
pm2 restart mcp-backend
```

#### Issue 3: Environment variables missing
```bash
# Check if .env file exists
ls -la .env

# Create .env file if missing
nano .env
```

#### Issue 4: MCP server not found
```bash
# Check if MCP server exists
ls -la /var/www/mcp-app/mcp-server/dist/mcp-server.js

# Build MCP server if needed
cd /var/www/mcp-app/mcp-server
npm run build
```

#### Issue 5: Nginx configuration errors
```bash
# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
```

## 📊 Monitoring Commands

### Real-time monitoring
```bash
# PM2 monitoring dashboard
pm2 monit

# Real-time logs
pm2 logs mcp-backend --lines 100 -f

# System resources
htop
```

### Health checks
```bash
# Local health check
curl http://localhost:8080/api/health

# External health check
curl https://mcp.worxstream.io/health

# Rate limit status
curl http://localhost:8080/api/rate-limit-status
```

## 🔄 Restart Procedures

### Full restart (recommended for 502 errors)
```bash
# Stop all processes
pm2 stop all
pm2 delete all

# Restart nginx
sudo systemctl restart nginx

# Start backend
pm2 start ecosystem.config.cjs
pm2 save

# Verify
./monitor.sh
```

### Quick restart
```bash
pm2 restart mcp-backend
sudo systemctl restart nginx
```

## 📈 Performance Optimization

### Check system resources
```bash
# CPU and memory usage
top

# Disk usage
df -h

# Network connections
netstat -tlnp
```

### Optimize for multiple users
```bash
# Increase PM2 instances (if needed)
pm2 scale mcp-backend 2

# Monitor memory usage
pm2 monit
```

## 🚨 Emergency Recovery

If the server is completely down:

1. **SSH into the droplet**
2. **Check system status**: `systemctl status nginx`
3. **Check PM2 status**: `pm2 list`
4. **Restart services**: 
   ```bash
   sudo systemctl restart nginx
   pm2 restart mcp-backend
   ```
5. **Check logs**: `pm2 logs mcp-backend --lines 50`
6. **Run health check**: `./monitor.sh`

## 📞 Support

If you continue to experience issues:

1. Run the monitoring script: `./monitor.sh`
2. Check the logs: `pm2 logs mcp-backend --lines 100`
3. Verify environment variables are set correctly
4. Ensure the MCP server is built and accessible
5. Check nginx configuration: `sudo nginx -t`

## 🔗 Useful Links

- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [Nginx Configuration](https://nginx.org/en/docs/)
- [DigitalOcean Droplet Management](https://docs.digitalocean.com/products/droplets/) 