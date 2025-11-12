# Expo Integration - Quick Start

## 🚀 Quick Setup Steps

### 1. Backend Changes (Already Done ✅)

The backend has been updated to support Expo apps:
- ✅ CORS configuration updated to allow Expo origins
- ✅ Mobile app support added (no-origin requests allowed)
- ✅ Local network IP support for development

### 2. Install Expo Dependencies

```bash
cd your-expo-app
npx expo install expo-constants
npm install axios
```

### 3. Create API Service

Create `src/services/api.ts` (see `EXPO_INTEGRATION_GUIDE.md` for full code)

### 4. Configure Backend URL

Create `app.config.js`:

```javascript
export default {
  expo: {
    extra: {
      backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL || "http://YOUR_LOCAL_IP:8080",
    },
  },
};
```

### 5. Find Your Local IP

```bash
# macOS/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig
```

### 6. Test Connection

```typescript
import apiService from './services/api';

// In your component
useEffect(() => {
  apiService.checkHealth()
    .then(console.log)
    .catch(console.error);
}, []);
```

## 📱 Available Endpoints

- `POST /api/query` - Send query (non-streaming)
- `GET /api/query-stream` - Server-Sent Events streaming
- `GET /api/conversations?userId=<id>` - List conversations
- `POST /api/conversations` - Save conversation
- `PUT /api/conversations/title` - Update title
- `DELETE /api/conversations` - Delete conversation
- `GET /api/health` - Health check

## 🔧 Development Tips

1. **Use ngrok for easier testing:**
   ```bash
   ngrok http 8080
   # Use the ngrok URL in your Expo app
   ```

2. **For physical devices:**
   - Ensure phone and computer are on same WiFi
   - Use your local IP (192.168.x.x) instead of localhost

3. **For production:**
   - Use HTTPS endpoints
   - Implement proper authentication
   - Restrict CORS origins

## 📚 Full Documentation

See `EXPO_INTEGRATION_GUIDE.md` for:
- Complete API service implementation
- Streaming support
- WebSocket integration
- Example React components
- Error handling
- Production considerations




