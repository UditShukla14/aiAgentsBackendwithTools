# MCP Connection Pool Size Guide

This guide helps you configure the optimal connection pool size based on your organization's needs.

## 📊 **Pool Size Recommendations by Organization Size**

### 🏢 **Small Organizations (1-10 employees)**
- **Pool Size**: 5-10 connections
- **Memory Usage**: ~250-500MB
- **Use Case**: Small teams, occasional usage

### 🏢 **Medium Organizations (11-50 employees)**
- **Pool Size**: 15-25 connections ⭐ **RECOMMENDED**
- **Memory Usage**: ~750MB-1.25GB
- **Use Case**: Regular daily usage, multiple concurrent users

### 🏢 **Large Organizations (51-200 employees)**
- **Pool Size**: 30-50 connections
- **Memory Usage**: ~1.5-2.5GB
- **Use Case**: Heavy usage, many concurrent users

### 🏢 **Enterprise (200+ employees)**
- **Pool Size**: 50-100 connections
- **Memory Usage**: ~2.5-5GB
- **Use Case**: High-volume usage, multiple departments

## 🔧 **Current Configuration**

Your current configuration is set for **Medium Organizations (25 connections)**:

```typescript
private maxConnections: number = 25; // Supports 25+ employee organizations
private connectionTimeout: number = 300000; // 5 minutes timeout
```

## 📈 **Performance Characteristics**

### **Memory Usage per Connection:**
- **MCP Server Process**: ~50-100MB
- **Node.js Backend**: ~20-30MB
- **Total per User**: ~70-130MB

### **Concurrent User Capacity:**
- **25 connections** = Up to 25 simultaneous users
- **Typical usage pattern**: 60-80% of employees use chat simultaneously
- **For 25 employees**: 15-20 concurrent users expected

## 🛠️ **How to Adjust Pool Size**

### **For Larger Organizations (50+ employees):**

1. **Edit the server configuration**:
   ```typescript
   // In backend/src/server.ts
   private maxConnections: number = 50; // Increase for larger orgs
   ```

2. **Consider server resources**:
   - **CPU**: 2-4 cores recommended
   - **RAM**: 4-8GB recommended
   - **Storage**: 20GB+ for logs and data

### **For Smaller Organizations (10 or fewer employees):**

1. **Reduce pool size for efficiency**:
   ```typescript
   private maxConnections: number = 10; // Reduce for smaller orgs
   ```

2. **Adjust timeout for faster cleanup**:
   ```typescript
   private connectionTimeout: number = 180000; // 3 minutes
   ```

## 📊 **Monitoring Pool Usage**

### **Check Current Pool Status:**
```bash
curl http://localhost:8080/api/pool-status
```

### **Expected Response:**
```json
{
  "poolStatus": {
    "activeConnections": 5,
    "maxConnections": 25,
    "queuedRequests": 0,
    "inactiveConnections": 2
  },
  "message": "Connection pool status"
}
```

### **Monitor Real-time Usage:**
```bash
# Watch pool usage in real-time
watch -n 5 'curl -s http://localhost:8080/api/pool-status | jq'

# Monitor logs for connection activity
pm2 logs mcp-backend --lines 100 -f
```

## 🎯 **Optimization Tips**

### **For High-Usage Organizations:**

1. **Increase pool size gradually**:
   - Start with 25 connections
   - Monitor usage patterns
   - Increase if you see queued requests

2. **Adjust timeout based on usage**:
   - **Active users**: 5 minutes timeout
   - **Occasional users**: 3 minutes timeout
   - **Heavy usage**: 10 minutes timeout

3. **Monitor server resources**:
   ```bash
   # Check memory usage
   free -h
   
   # Check CPU usage
   top
   
   # Check process count
   ps aux | grep node | wc -l
   ```

### **For Cost Optimization:**

1. **Reduce pool size** if usage is low
2. **Increase timeout** to reduce connection churn
3. **Monitor idle connections** and adjust accordingly

## 🚨 **Warning Signs**

### **Pool Exhaustion:**
- `queuedRequests > 0` in pool status
- Users experiencing delays
- "Connection not available" errors

### **Resource Exhaustion:**
- High memory usage (>80% of available RAM)
- High CPU usage (>80% consistently)
- Slow response times

### **Solutions:**
1. **Increase pool size** if resources allow
2. **Scale horizontally** (multiple servers)
3. **Optimize connection cleanup** (reduce timeout)

## 📋 **Deployment Checklist**

### **Before Deployment:**
- [ ] Assess organization size and usage patterns
- [ ] Calculate required server resources
- [ ] Set appropriate pool size
- [ ] Configure monitoring

### **After Deployment:**
- [ ] Monitor pool usage for 1 week
- [ ] Adjust pool size based on actual usage
- [ ] Set up alerts for pool exhaustion
- [ ] Document usage patterns

## 🔗 **Useful Commands**

```bash
# Check current pool status
curl http://localhost:8080/api/pool-status

# Monitor real-time usage
pm2 monit

# View connection logs
pm2 logs mcp-backend --lines 50

# Check server resources
htop

# Test multiple concurrent users
# (Use browser developer tools or load testing tools)
```

## 📞 **Support**

If you need help adjusting the pool size or experience issues:

1. **Check pool status**: `curl http://localhost:8080/api/pool-status`
2. **Review logs**: `pm2 logs mcp-backend --lines 100`
3. **Monitor resources**: `htop` and `free -h`
4. **Adjust configuration** based on usage patterns 