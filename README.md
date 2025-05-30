# MCP React Client with Context-Aware AI

A full-stack web application that provides a React-based interface for interacting with Model Context Protocol (MCP) servers, now enhanced with **Redis-powered context awareness** for intelligent, memory-driven conversations.

## 🧠 **NEW: Context-Aware Features**

### What's New:
- **🔄 Conversation Memory**: AI remembers your previous questions and responses
- **🎯 Intent Recognition**: Smart detection of what you're trying to accomplish
- **🔗 Cross-Tool Context**: Tools share information for better results
- **⚡ Smart Caching**: Faster responses with intelligent result caching
- **📊 Usage Patterns**: AI learns from your interaction patterns

### Context Intelligence Examples:
1. **Follow-up Questions**: "Show me more customers like that" (remembers previous search)
2. **Date Inference**: "Show me this week's invoices" (automatically applies date range)
3. **Related Suggestions**: AI suggests next actions based on recent activities
4. **Smart Defaults**: Tools pre-fill parameters based on your patterns

## 🏗️ Architecture

```
┌─────────────────┐    WebSocket/HTTP    ┌─────────────────┐    MCP Protocol    ┌─────────────────┐
│   React Client  │ ◄─────────────────► │  Backend Server │ ◄─────────────────► │   MCP Server    │
│   (Frontend)    │                     │   (Express +    │                    │   (Weather)     │
└─────────────────┘                     │    Redis)       │                    └─────────────────┘
                                        └─────────────────┘
                                                │
                                                ▼
                                        ┌─────────────────┐    ┌─────────────────┐
                                        │  Anthropic API  │    │  Redis Context  │
                                        │    (Claude)     │    │    Storage      │
                                        └─────────────────┘    └─────────────────┘
```

## 🚀 Features

- **Modern React UI**: Beautiful, responsive interface with real-time chat
- **WebSocket Communication**: Real-time bidirectional communication
- **MCP Integration**: Full Model Context Protocol support
- **AI-Powered**: Claude AI integration for intelligent responses
- **🧠 Context-Aware Tools**: Redis-powered conversation memory and context
- **Tool Orchestration**: Dynamic tool discovery and execution
- **TypeScript**: Full type safety across the entire stack
- **Error Handling**: Comprehensive error handling and user feedback
- **⚡ Performance Caching**: Smart caching of API responses and tool results

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Anthropic API key
- **Redis** (for context awareness)

## 🛠️ Setup

### 1. Install Redis

**macOS:**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

**Windows:**
Use WSL2 or Docker to run Redis.

### 2. Clone and Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 3. Environment Configuration

Create a `.env` file in the `backend` directory:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
PORT=8080
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 4. Build the Backend

```bash
cd backend
npm run build
```

## 🚀 Running the Application

### Start the Backend Server

```bash
cd backend
npm run dev
```

The backend will start on `http://localhost:8080`

### Start the Frontend

In a new terminal:

```bash
cd frontend
npm run dev
```

The frontend will start on `http://localhost:5173`

### MCP Server

The weather MCP server is included in the `mcp-server` directory and will be automatically started by the backend when you connect to it through the UI.

## 🎯 Usage

1. **Open the Application**: Navigate to `http://localhost:5173`
2. **Connect to MCP Server**: 
   - The default path `../mcp-server/mcp-server.ts` should work out of the box
   - Click "Connect" to establish connection
3. **Start Chatting**: Once connected, you can ask questions like:
   - "What's the weather in London?"
   - "Show me the forecast for Paris"
   - "Calculate 15 * 24 + 100"
   - "Analyze this text: Hello world, this is a sample text."

## 🔧 Available Scripts

### Backend
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## 🌤️ MCP Server (Multi-Tool)

The included MCP server provides these tool categories:

### Weather Tools:
- **get-alerts**: Get weather alerts for any US state
- **get-forecast**: Get weather forecast for coordinates

### Utility Tools:
- **calculate**: Perform mathematical calculations
- **analyze-text**: Analyze text for statistics and readability

## 🏗️ Project Structure

```
mcp-react-client/
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── components/      # React components
│   │   └── ...
│   └── package.json
├── backend/                  # Express backend
│   ├── src/
│   │   └── server.ts       # Main server file
│   ├── server/
│   │   └── mcp-client.ts   # MCP client utilities
│   └── package.json
├── mcp-server/              # MCP server with multiple tools
│   ├── mcp-server.ts       # Main MCP server file
│   ├── tools.ts            # Tool definitions (modular)
│   ├── tsconfig.json       # TypeScript configuration
│   └── package.json        # Dependencies and scripts
└── README.md
```

### Adding New Tools

To add new tools to the MCP server:

1. **Add your tool function** in `mcp-server/tools.ts`
2. **Create a new category function** (e.g., `registerDatabaseTools`)
3. **Import and call** it in the `registerAllTools` function
4. **Restart the server** to see your new tools

Example:
```typescript
export function registerDatabaseTools(server: McpServer) {
  server.tool(
    "query-db",
    "Query a database",
    { query: z.string().describe("SQL query to execute") },
    async ({ query }) => {
      // Your database logic here
      return { content: [{ type: "text", text: "Query result" }] };
    }
  );
}
```

## 🛡️ Error Handling

The application includes comprehensive error handling:

- **Connection Errors**: Clear feedback when backend/MCP connections fail
- **Query Errors**: Detailed error messages for failed queries
- **Type Safety**: Full TypeScript coverage prevents runtime errors
- **Graceful Degradation**: UI remains functional even with partial failures

## 🔧 Configuration

### Frontend Configuration

You can configure the frontend by setting environment variables:

- `VITE_BACKEND_URL` - Backend server URL (default: `http://localhost:8080`)
- `VITE_DEFAULT_MCP_SERVER_PATH` - Default MCP server path

### Backend Configuration

- `