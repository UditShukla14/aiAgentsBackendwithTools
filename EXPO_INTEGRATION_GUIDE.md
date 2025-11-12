# Expo App Integration Guide

This guide explains how to connect your Expo React Native app to the MCP Backend Service.

## 📋 Backend Analysis

### Current Backend Architecture

The backend is an Express.js server with the following features:
- **REST API endpoints** for query processing and conversation management
- **WebSocket support** (Socket.IO) for real-time communication
- **Server-Sent Events (SSE)** for streaming responses
- **CORS configuration** for web origins
- **No authentication** (uses userId/sessionId for conversation management)

### Available API Endpoints

#### Health & Status
- `GET /api/health` - Health check endpoint
- `GET /api/status?sessionId=<id>` - Get connection status
- `GET /api/rate-limit-status` - Rate limiting status
- `GET /api/pool-status` - Connection pool status

#### Query Processing
- `POST /api/query` - Send a query and get full response (non-streaming)
- `GET /api/query-stream?query=<query>&sessionId=<id>` - Server-Sent Events streaming
- WebSocket: `ws://<host>:<port>/socket.io` - Real-time bidirectional communication

#### Conversations
- `GET /api/conversations?userId=<userId>` - List all conversations for a user
- `GET /api/conversations/:sessionId?userId=<userId>` - Get a specific conversation
- `POST /api/conversations` - Save a conversation
- `PUT /api/conversations/title` - Update conversation title
- `DELETE /api/conversations` - Delete a conversation

#### Connection Management
- `POST /api/connect` - Manual MCP server connection

## 🔧 Backend Changes Required

### 1. Update CORS Configuration

The backend currently only allows specific web origins. We need to add support for Expo apps.

**File: `backend/src/resources/staticData.ts`**

```typescript
export const allowedOrigins = [
  "https://app.worxstream.io", // Production frontend
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
  // Add Expo support
  "exp://localhost:8081",      // Expo Go (development)
  "exp://192.168.*.*:8081",    // Expo Go (LAN)
  "*"                           // Allow all origins for mobile (or be more specific)
];
```

**Note:** For production, you should use specific origins or implement proper authentication instead of allowing all origins.

### 2. Update CORS Middleware

**File: `backend/src/server.ts`**

The current CORS configuration should work, but you may want to make it more flexible:

```typescript
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || 
        allowedOrigins.includes("*") ||
        origin.includes("exp://") ||
        origin.includes("expo://")) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["DNT", "User-Agent", "X-Requested-With", "If-Modified-Since", "Cache-Control", "Content-Type", "Range", "Authorization"],
  exposedHeaders: ["Content-Length", "Content-Range"]
}));
```

## 📱 Expo App Implementation

### 1. Install Required Dependencies

```bash
cd your-expo-app
npx expo install expo-constants
npm install axios
# For WebSocket support (optional)
npm install socket.io-client
```

### 2. Create API Service

Create `src/services/api.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';
import Constants from 'expo-constants';

// Get backend URL from environment or use default
const getBackendUrl = () => {
  // For development, use your local IP or ngrok URL
  // For production, use your deployed backend URL
  return Constants.expoConfig?.extra?.backendUrl || 
         process.env.EXPO_PUBLIC_BACKEND_URL || 
         'http://localhost:8080';
};

class APIService {
  private client: AxiosInstance;
  private baseURL: string;

  constructor() {
    this.baseURL = getBackendUrl();
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('[API] Response error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  // Health check
  async checkHealth(): Promise<any> {
    const response = await this.client.get('/api/health');
    return response.data;
  }

  // Send query (non-streaming)
  async sendQuery(query: string, sessionId?: string): Promise<any> {
    const response = await this.client.post('/api/query', {
      query,
      sessionId: sessionId || this.generateSessionId(),
    });
    return response.data;
  }

  // Get conversations
  async getConversations(userId: string): Promise<any> {
    const response = await this.client.get('/api/conversations', {
      params: { userId },
    });
    return response.data;
  }

  // Get single conversation
  async getConversation(userId: string, sessionId: string): Promise<any> {
    const response = await this.client.get(`/api/conversations/${sessionId}`, {
      params: { userId },
    });
    return response.data;
  }

  // Save conversation
  async saveConversation(
    userId: string,
    sessionId: string,
    messages: any[],
    title?: string
  ): Promise<any> {
    const response = await this.client.post('/api/conversations', {
      userId,
      sessionId,
      messages,
      title,
    });
    return response.data;
  }

  // Update conversation title
  async updateConversationTitle(
    userId: string,
    sessionId: string,
    title: string
  ): Promise<any> {
    const response = await this.client.put('/api/conversations/title', {
      userId,
      sessionId,
      title,
    });
    return response.data;
  }

  // Delete conversation
  async deleteConversation(userId: string, sessionId: string): Promise<any> {
    const response = await this.client.delete('/api/conversations', {
      data: { userId, sessionId },
    });
    return response.data;
  }

  // Generate session ID
  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get base URL
  getBaseURL(): string {
    return this.baseURL;
  }
}

export default new APIService();
```

### 3. Create Streaming Service (Optional)

For Server-Sent Events streaming, create `src/services/streaming.ts`:

```typescript
import { EventSourcePolyfill } from 'event-source-polyfill';
import Constants from 'expo-constants';

const getBackendUrl = () => {
  return Constants.expoConfig?.extra?.backendUrl || 
         process.env.EXPO_PUBLIC_BACKEND_URL || 
         'http://localhost:8080';
};

export class StreamingService {
  private baseURL: string;

  constructor() {
    this.baseURL = getBackendUrl();
  }

  async streamQuery(
    query: string,
    sessionId: string,
    onChunk: (chunk: string) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<void> {
    const url = `${this.baseURL}/api/query-stream?query=${encodeURIComponent(query)}&sessionId=${sessionId}`;
    
    const eventSource = new EventSourcePolyfill(url, {
      headers: {
        'Accept': 'text/event-stream',
      },
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'text_delta' && data.delta) {
          onChunk(data.delta);
        } else if (data.type === 'complete') {
          onComplete();
          eventSource.close();
        } else if (data.type === 'error') {
          onError(new Error(data.error));
          eventSource.close();
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    eventSource.onerror = (error) => {
      onError(new Error('Stream connection error'));
      eventSource.close();
    };
  }
}

export default new StreamingService();
```

**Note:** You'll need to install `event-source-polyfill`:
```bash
npm install event-source-polyfill
```

### 4. Create WebSocket Service (Optional)

For real-time bidirectional communication, create `src/services/websocket.ts`:

```typescript
import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';

const getBackendUrl = () => {
  const url = Constants.expoConfig?.extra?.backendUrl || 
              process.env.EXPO_PUBLIC_BACKEND_URL || 
              'http://localhost:8080';
  // Convert http:// to ws:// for WebSocket
  return url.replace(/^http/, 'ws');
};

export class WebSocketService {
  private socket: Socket | null = null;
  private baseURL: string;

  constructor() {
    this.baseURL = getBackendUrl();
  }

  connect(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.baseURL, {
        path: '/socket.io',
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      });

      this.socket.on('connect', () => {
        console.log('WebSocket connected');
        this.socket?.emit('join_session', sessionId);
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
      });
    });
  }

  sendQuery(query: string, sessionId: string): void {
    if (!this.socket || !this.socket.connected) {
      throw new Error('WebSocket not connected');
    }
    this.socket.emit('query', { query, sessionId });
  }

  onMessage(callback: (data: any) => void): void {
    this.socket?.on('response', callback);
  }

  onError(callback: (error: any) => void): void {
    this.socket?.on('error', callback);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export default new WebSocketService();
```

**Note:** For WebSocket support in Expo, you may need:
```bash
npm install socket.io-client
```

### 5. Example React Component

Create `src/components/ChatScreen.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import apiService from '../services/api';
import { StreamingService } from '../services/streaming';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [userId] = useState('expo-user-1'); // In production, get from auth

  useEffect(() => {
    // Generate session ID on mount
    setSessionId(apiService.generateSessionId());
    
    // Load previous conversations (optional)
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      const data = await apiService.getConversations(userId);
      // Handle conversations list
      console.log('Conversations:', data);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Option 1: Non-streaming (simple)
      const response = await apiService.sendQuery(input, sessionId);
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.response || 'No response',
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Save conversation
      await apiService.saveConversation(
        userId,
        sessionId,
        [...messages, userMessage, assistantMessage]
      );
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessageStreaming = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    const assistantMessage: Message = { role: 'assistant', content: '' };
    setMessages(prev => [...prev, assistantMessage]);
    const messageIndex = messages.length + 1;

    const streamingService = new StreamingService();
    
    try {
      await streamingService.streamQuery(
        input,
        sessionId,
        (chunk) => {
          // Update the last message with streaming chunks
          setMessages(prev => {
            const updated = [...prev];
            updated[messageIndex].content += chunk;
            return updated;
          });
        },
        (error) => {
          console.error('Streaming error:', error);
          setLoading(false);
        },
        async () => {
          setLoading(false);
          // Save conversation after streaming completes
          const finalMessages = [...messages, userMessage, assistantMessage];
          await apiService.saveConversation(userId, sessionId, finalMessages);
        }
      );
    } catch (error) {
      console.error('Error starting stream:', error);
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(item, index) => index.toString()}
        renderItem={({ item }) => (
          <View style={[
            styles.messageContainer,
            item.role === 'user' ? styles.userMessage : styles.assistantMessage
          ]}>
            <Text style={styles.messageText}>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type your message..."
          multiline
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={loading}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  messageContainer: {
    padding: 12,
    marginVertical: 4,
    marginHorizontal: 8,
    borderRadius: 8,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007AFF',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#E5E5EA',
  },
  messageText: {
    color: '#000',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
```

## 🔐 Configuration

### Environment Variables

Create `app.config.js` in your Expo project root:

```javascript
export default {
  expo: {
    name: "MCP Client",
    slug: "mcp-client",
    version: "1.0.0",
    extra: {
      // For development, use your local IP or ngrok URL
      // For production, use your deployed backend URL
      backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL || "http://YOUR_LOCAL_IP:8080",
    },
  },
};
```

### Network Configuration

For development, you'll need to:

1. **Find your local IP address:**
   ```bash
   # macOS/Linux
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Windows
   ipconfig
   ```

2. **Update backend URL** in your Expo app to use your local IP:
   ```
   http://192.168.1.XXX:8080
   ```

3. **Or use ngrok** for easier development:
   ```bash
   ngrok http 8080
   ```
   Then use the ngrok URL in your Expo app.

## 🚀 Testing

1. **Start your backend:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Test health endpoint:**
   ```bash
   curl http://localhost:8080/api/health
   ```

3. **Run your Expo app:**
   ```bash
   npx expo start
   ```

## ⚠️ Important Notes

1. **CORS**: The backend needs to allow your Expo app's origin. Update `allowedOrigins` in `backend/src/resources/staticData.ts`.

2. **Network Access**: For physical devices, ensure your phone and computer are on the same network, or use ngrok/tunneling.

3. **HTTPS in Production**: For production, use HTTPS endpoints. Consider using services like:
   - ngrok (development)
   - Cloudflare Tunnel
   - Your own domain with SSL

4. **Authentication**: The current backend doesn't have authentication. For production, consider adding:
   - JWT tokens
   - API keys
   - OAuth integration

5. **Error Handling**: Implement proper error handling and retry logic for network requests.

6. **Offline Support**: Consider implementing offline message queuing for better UX.

## 📚 Additional Resources

- [Expo Networking Guide](https://docs.expo.dev/guides/using-custom-native-code/#networking)
- [Axios Documentation](https://axios-http.com/docs/intro)
- [Socket.IO Client Documentation](https://socket.io/docs/v4/client-api/)




