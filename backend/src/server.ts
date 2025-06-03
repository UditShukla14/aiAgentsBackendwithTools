import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { Anthropic } from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dotenv from "dotenv";
import { ContextManager } from "./context-manager.js";
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Add MCP server path configuration
// Resolve __dirname in ES module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically resolve MCP server path for dev/prod
const MCP_SERVER_PATH = process.env.MCP_SERVER_PATH || (
  process.env.NODE_ENV === 'production'
    ? path.resolve(__dirname, '../../mcp-server/dist/mcp-server.js')
    : path.resolve(__dirname, '../../mcp-server/mcp-server.ts')
);


const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

const allowedOrigins = [
  "https://app.worxstream.io", // ✅ Production frontend
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173"
];

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  path: "/socket.io",
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
}

class MCPBackendService {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: AnthropicTool[] = [];
  private isConnected = false;
  private contextManager: ContextManager;
  private autoConnectRetries: number = 0;
  private maxAutoConnectRetries: number = 3;

  private readonly SYSTEM_PROMPT = `You are a helpful business assistant with access to InvoiceMakerPro tools for managing products, customers, invoices, and estimates. 

Be conversational and natural in your responses:
- For greetings (hello, hi, good morning), respond warmly and briefly
- For thanks/appreciation, simply say "You're welcome!" or similar
- For general questions, answer naturally without always pushing tool usage
- Only mention or suggest tools when the user asks something that would actually benefit from them
- Keep responses concise for simple interactions
- Be friendly and human-like, not robotic

When users ask about business data (products, customers, invoices, estimates), then use the appropriate tools to help them.

IMPORTANT: When tools return formatted content (with sections, bullet points, tables, etc.), display that content EXACTLY as provided. DO NOT summarize or rewrite formatted tool outputs. The tools are designed to provide properly formatted, detailed information that should be shown to the user as-is.

You have access to conversation context and can reference previous interactions. Use this context to:
- Provide more relevant responses based on recent conversations
- Suggest related actions based on user's recent activities
- Remember user preferences and patterns
- Avoid repeating information already provided recently

IMPORTANT CONTEXT HANDLING:
- When users use pronouns (his, her, their, this customer, that product), automatically resolve them from recent context
- If a tool requires parameters that aren't explicitly provided but are available from recent context, use them automatically
- For example: if discussing John Doe and user asks "get his address", automatically use John Doe's customer ID
- Always check recent tool results for relevant entity IDs (customer_id, product_id, etc.) before asking users to provide them
- Only ask for missing information if it's truly not available in the conversation context`;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-web", version: "1.0.0" });
    this.contextManager = new ContextManager();
    
    // Start auto-connection process
    this.initializeAutoConnect();
  }

  // ADD: Smart query classification for token optimization
  private classifyQuery(query: string): 'greeting' | 'simple' | 'business' | 'complex' {
    const lowerQuery = query.toLowerCase().trim();
    
    // Greetings and social interactions (highest token savings)
    const greetings = [
      'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
      'thanks', 'thank you', 'ty', 'thx', 'bye', 'goodbye', 'see you', 'later',
      'how are you', 'whats up', 'wassup', 'morning', 'evening'
    ];
    if (greetings.some(greeting => lowerQuery.includes(greeting)) && lowerQuery.length < 50) {
      return 'greeting';
    }
    
    // Simple questions and help requests
    const simplePatterns = [
      'what can you do', 'help me', 'what is', 'who are you', 'how do i',
      'can you help', 'what are your capabilities', 'what tools', 'how does this work'
    ];
    if (simplePatterns.some(pattern => lowerQuery.includes(pattern)) && lowerQuery.length < 100) {
      return 'simple';
    }
    
    // Business queries that need tools
    const businessKeywords = [
      'customer', 'product', 'invoice', 'estimate', 'search', 'find', 'get', 'list', 
      'show', 'display', 'fetch', 'retrieve', 'lookup', 'details', 'info', 'address',
      'email', 'phone', 'contact', 'create', 'add', 'update', 'delete'
    ];
    if (businessKeywords.some(keyword => lowerQuery.includes(keyword))) {
      return 'business';
    }
    
    // Complex analysis (multiple steps, comparisons, reports)
    const complexPatterns = [
      'compare', 'analyze', 'report', 'calculate', 'multiple', 'all customers who',
      'send email', 'generate report', 'analysis', 'summary', 'overview', 'dashboard',
      'export', 'import', 'bulk', 'batch'
    ];
    if (complexPatterns.some(pattern => lowerQuery.includes(pattern)) || lowerQuery.length > 150) {
      return 'complex';
    }
    
    return 'simple';
  }

  // ADD: Dynamic system prompts for different query types
  private getSystemPrompt(queryType: string): string {
    switch (queryType) {
      case 'greeting':
        return `You are a friendly business assistant. Respond warmly and briefly to greetings and social interactions. Keep responses short, natural, and conversational.`;
        
      case 'simple':
        return `You are a helpful business assistant. Answer questions naturally and conversationally. Provide helpful information about your capabilities when asked. Only mention specific business tools if directly relevant to the question.`;
        
      case 'business':
        return `You are a business assistant with access to InvoiceMakerPro tools for managing customers, products, invoices, and estimates. Use the appropriate tools to help with business data queries.

IMPORTANT: 
- Display tool results exactly as provided
- Use conversation context to resolve pronouns and references automatically
- Only ask for missing information if it's not available in context`;
        
      case 'complex':
        return this.SYSTEM_PROMPT; // Full prompt for complex tasks
        
      default:
        return this.SYSTEM_PROMPT;
    }
  }

  // ADD: Smart tool filtering based on query type and content
  private getRelevantTools(queryType: string, query: string): AnthropicTool[] {
    if (queryType === 'greeting' || queryType === 'simple') {
      return []; // No tools needed for greetings/simple queries
    }
    
    if (queryType === 'business') {
      // Filter tools based on query content for better token efficiency
      const lowerQuery = query.toLowerCase();
      const relevantTools = this.tools.filter(tool => {
        const toolName = tool.name.toLowerCase();
        
        // Customer-related queries
        if ((lowerQuery.includes('customer') || lowerQuery.includes('client')) && 
            toolName.includes('customer')) return true;
            
        // Product-related queries  
        if (lowerQuery.includes('product') && toolName.includes('product')) return true;
        
        // Invoice-related queries
        if (lowerQuery.includes('invoice') && toolName.includes('invoice')) return true;
        
        // Estimate-related queries
        if ((lowerQuery.includes('estimate') || lowerQuery.includes('quote')) && 
            toolName.includes('estimate')) return true;
            
        // General search/get operations
        if ((lowerQuery.includes('search') || lowerQuery.includes('find') || 
             lowerQuery.includes('get') || lowerQuery.includes('list') ||
             lowerQuery.includes('show')) && 
            (toolName.includes('search') || toolName.includes('get') || toolName.includes('list'))) return true;
            
        return false;
      });
      
      // If no specific matches, include basic search tools
      return relevantTools.length > 0 ? relevantTools : 
             this.tools.filter(tool => tool.name.toLowerCase().includes('search') || 
                                     tool.name.toLowerCase().includes('list'));
    }
    
    return this.tools; // All tools for complex queries
  }

  // ADD: Calculate max tokens based on query type
  private getMaxTokens(queryType: string): number {
    switch (queryType) {
      case 'greeting': return 100;
      case 'simple': return 300;
      case 'business': return 1500;
      case 'complex': return 2000;
      default: return 2000;
    }
  }

  private async initializeAutoConnect() {
    try {
      const serverPath = MCP_SERVER_PATH;
  
      console.log('🔄 Attempting auto-connection to MCP server at:', serverPath);
      
      // Check if file exists before attempting connection
      try {
        await import(serverPath);
      } catch (error) {
        throw new Error(`MCP server file not found at ${serverPath}. Please ensure the file exists and the path is correct.`);
      }
      
      await this.connectToServer(serverPath);
      console.log('✅ Successfully auto-connected to MCP server');
      this.autoConnectRetries = 0;
    } catch (error) {
      this.autoConnectRetries++;
      console.error(`❌ Auto-connection attempt ${this.autoConnectRetries} failed:`, error);
      
      if (this.autoConnectRetries < this.maxAutoConnectRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, this.autoConnectRetries), 10000);
        console.log(`🔄 Retrying auto-connection in ${backoffMs / 1000} seconds...`);
        setTimeout(() => this.initializeAutoConnect(), backoffMs);
      } else {
        console.error('❌ Max auto-connection retries exceeded. Manual connection will be required.');
      }
    }
  }
  

  async connectToServer(serverScriptPath: string) {
    try {
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      const isTs = serverScriptPath.endsWith(".ts");
      
      if (!isJs && !isPy && !isTs) {
        throw new Error("Server script must be a .js, .ts, or .py file");
      }
      
      let command: string;
      let args: string[];
      
      if (isPy) {
        command = process.platform === "win32" ? "python" : "python3";
        args = [serverScriptPath];
      } else if (isTs) {
        command = "npx";
        args = ["tsx", serverScriptPath];
      } else {
        command = process.execPath;
        args = [serverScriptPath];
      }

      this.transport = new StdioClientTransport({
        command,
        args,
      });
      
      await this.mcp.connect(this.transport);

      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description || "",
          input_schema: tool.inputSchema,
        };
      });
      
      this.isConnected = true;
      console.log(
        "Connected to MCP server with tools:",
        this.tools.map(({ name }) => name).join(", ")
      );
      
      return {
        success: true,
        tools: this.tools.map(({ name, description }) => ({ name, description }))
      };
    } catch (e) {
      console.error("Failed to connect to MCP server:", e);
      throw e;
    }
  }

  // UPDATED: Optimized processQuery with smart classification
  async processQuery(query: string, sessionId: string) {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    // Classify the query type for optimization
    const queryType = this.classifyQuery(query);
    console.log(`🎯 Query classified as: ${queryType} | Length: ${query.length} chars`);

    // Add user message to context
    await this.contextManager.addMessage(sessionId, 'user', query);

    // Smart context generation based on query type
    let contextInfo = '';
    let toolContext = null;
    
    if (queryType === 'business' || queryType === 'complex') {
      // Only generate full context for business/complex queries
      toolContext = await this.contextManager.generateToolContext(sessionId, query);
      
      contextInfo = `
Current conversation context:
- User intent: ${toolContext.userIntent}
- Recent queries: ${toolContext.recentQueries.slice(-2).join(', ')}`;

      const activeEntities = toolContext.activeEntities;
      if (activeEntities.customerName) {
        contextInfo += `
- Active customer: ${activeEntities.customerName}${activeEntities.customerId ? ` (ID: ${activeEntities.customerId})` : ''}`;
      }
      if (activeEntities.productName) {
        contextInfo += `
- Active product: ${activeEntities.productName}${activeEntities.productId ? ` (ID: ${activeEntities.productId})` : ''}`;
      }
    }

    // Get optimized system prompt and tools
    const systemPrompt = this.getSystemPrompt(queryType);
    const relevantTools = this.getRelevantTools(queryType, query);
    const maxTokens = this.getMaxTokens(queryType);
    
    const contextualSystemPrompt = contextInfo ? `${systemPrompt}${contextInfo}

Use this context to provide more relevant and personalized responses. When users use pronouns or references like "he", "his", "that customer", automatically resolve them from the context above.

CRITICAL: When tools return formatted output with sections, headers, bullet points, or structured data, you MUST display it exactly as provided. Never summarize or rewrite formatted tool outputs - show them verbatim.` : systemPrompt;

    // Token optimization logging
    console.log(`📊 Token optimization applied:
- Query type: ${queryType}
- System prompt: ${systemPrompt.length} chars (vs ${this.SYSTEM_PROMPT.length} full)
- Tools included: ${relevantTools.length}/${this.tools.length}
- Context info: ${contextInfo.length} chars
- Max tokens: ${maxTokens}`);

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: maxTokens,
        system: contextualSystemPrompt,
        messages,
        tools: relevantTools, // Only include relevant tools
      } as any);

      // For greetings and simple queries, return immediately (no tool processing needed)
      if (queryType === 'greeting' || queryType === 'simple') {
        const textContent = response.content
          .filter((content: any) => content.type === "text")
          .map((content: any) => content.text)
          .join("\n");
          
        await this.contextManager.addMessage(
          sessionId, 
          'assistant', 
          textContent || "No response generated."
        );
        
        console.log(`⚡ Fast-tracked ${queryType} query - no tool processing needed`);
        
        return {
          response: textContent || "No response generated.",
          toolsUsed: [],
          queryType,
          tokensOptimized: true
        };
      }

      // Continue with tool processing for business/complex queries
      let currentMessages = [...messages];
      let currentResponse = response;
      const toolUsageLog: any[] = [];

      while (true) {
        const toolUseBlocks = currentResponse.content.filter(
          (content: any) => content.type === "tool_use"
        );

        if (toolUseBlocks.length === 0) {
          // No more tool calls, return the final text response
          const textContent = currentResponse.content
            .filter((content: any) => content.type === "text")
            .map((content: any) => content.text)
            .join("\n");
          
          // Add assistant response to context (with automatic compression)
          const toolNames = toolUsageLog.map(t => t.name);
          await this.contextManager.addMessage(
            sessionId, 
            'assistant', 
            textContent || "No response generated.",
            toolNames.length > 0 ? toolNames : undefined
          );
          
          return {
            response: textContent || "No response generated.",
            toolsUsed: toolUsageLog,
            queryType,
            tokensOptimized: true
          };
        }

        // Add the assistant's response to the conversation
        currentMessages.push({
          role: "assistant",
          content: currentResponse.content,
        });

        // Process each tool use
        const toolResults: any[] = [];
        for (const toolUse of toolUseBlocks) {
          const toolName = (toolUse as any).name;
          const originalArgs = (toolUse as any).input as { [x: string]: unknown } | undefined;

          // Check cache first using the optimized caching system
          let result = await this.contextManager.getCachedResult(toolName, originalArgs || {});
          
          if (!result) {
            // Enhance tool arguments with context using the new optimized method
            const enhancedArgs = await this.contextManager.enhanceToolArguments(
              sessionId,
              toolName,
              originalArgs || {},
              query
            );

            console.log(`🧠 Context: Tool ${toolName} enhanced arguments:`, JSON.stringify(enhancedArgs, null, 2));
            toolUsageLog.push({ name: toolName, args: enhancedArgs });
            
            try {
              result = await this.mcp.callTool({
                name: toolName,
                arguments: enhancedArgs,
              });
              
              console.log("Tool result:", JSON.stringify(result, null, 2));
              
              // Cache the result using optimized caching (search results cache for 5 min, data for 1 hour)
              const cacheTime = toolName.includes('search') ? 300 : 3600;
              await this.contextManager.cacheToolResult(toolName, originalArgs || {}, result, cacheTime);
              
              // Record tool usage in context with automatic compression and summarization
              await this.contextManager.recordToolUsage(sessionId, toolName, enhancedArgs, result);
              
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`Error calling tool ${toolName}:`, error);
              
              result = {
                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                isError: true
              };
            }
          } else {
            console.log(`✅ Using cached result for ${toolName}`);
            toolUsageLog.push({ name: toolName, args: originalArgs, cached: true });
          }
          
          toolResults.push({
            type: "tool_result",
            tool_use_id: (toolUse as any).id,
            content: result.content || [{ type: "text", text: JSON.stringify(result) }],
            is_error: result.isError || false,
          });
        }

        // Add tool results to the conversation
        currentMessages.push({
          role: "user",
          content: toolResults,
        });

        // Check if any tool result has DISPLAY_VERBATIM flag
        const hasVerbatimFlag = toolResults.some(result => 
          result.content.some((content: any) => 
            content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]")
          )
        );

        // For verbatim content, bypass Claude and return directly
        if (hasVerbatimFlag) {
          const verbatimContent = toolResults
            .flatMap(result => result.content)
            .filter((content: any) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]"))
            .map((content: any) => content.text.replace("[DISPLAY_VERBATIM] ", ""))
            .join("\n\n");
          
          // Add assistant response to context with compression
          const toolNames = toolUsageLog.map(t => t.name);
          await this.contextManager.addMessage(
            sessionId, 
            'assistant', 
            verbatimContent,
            toolNames.length > 0 ? toolNames : undefined
          );
          
          return {
            response: verbatimContent,
            toolsUsed: toolUsageLog,
            queryType,
            tokensOptimized: true
          };
        }

        // Use enhanced system prompt for verbatim display
        let finalSystemPrompt = contextualSystemPrompt;
        if (hasVerbatimFlag) {
          finalSystemPrompt = `${contextualSystemPrompt}

SPECIAL INSTRUCTION: The tool result includes a [DISPLAY_VERBATIM] flag. You MUST preserve all structured data (tables, headings, lists) and ensure it is displayed using professional markdown formatting. You MAY enhance readability using bold labels, spacing, section dividers, and monospace formatting where appropriate. Do NOT alter the actual text or its meaning. Only the [DISPLAY_VERBATIM] tag should be removed.`;
        }

        // Get Claude's response to the tool results
        currentResponse = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: maxTokens,
          system: finalSystemPrompt,
          messages: currentMessages,
          tools: relevantTools,
        } as any);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error processing query:", error);
      throw new Error(`Error processing query: ${errorMessage}`);
    }
  }

  async cleanup() {
    try {
      if (this.transport) {
        await this.mcp.close();
        this.isConnected = false;
      }
      // Clean up the context manager
      await this.contextManager.cleanup();
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      tools: this.tools.map(({ name, description }) => ({ name, description }))
    };
  }
}

// Create MCP service instance
const mcpService = new MCPBackendService();

// Store session mappings for socket connections
const socketToSession = new Map<string, string>();

// Socket.IO connection handling
io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);
  
  // Create or retrieve session for this socket
  const sessionId = randomUUID();
  socketToSession.set(socket.id, sessionId);
  
  // Create session in Redis with optimized context manager
  await mcpService['contextManager'].createSession(sessionId, `user_${socket.id}`);
  
  console.log(`✅ Created optimized session ${sessionId} for socket ${socket.id}`);

  // Send current connection status
  const connectionStatus = mcpService.getConnectionStatus();
  socket.emit('connection_status', connectionStatus);
  
  // If already connected via auto-connect, send success message
  if (connectionStatus.isConnected) {
    socket.emit('connection_success', {
      message: 'Connected to MCP server',
      tools: connectionStatus.tools
    });
  }

  // Keep manual connection handler for fallback/reconnection
  socket.on('connect_server', async (data) => {
    try {
      const { serverPath } = data;
      socket.emit('connection_progress', { status: 'connecting', message: 'Connecting to MCP server...' });
      
      const result = await mcpService.connectToServer(serverPath);
      
      socket.emit('connection_success', {
        message: `Successfully connected to ${serverPath}`,
        tools: result.tools
      });
      
      // Broadcast to all clients that server is connected
      io.emit('connection_status', mcpService.getConnectionStatus());
    } catch (error) {
      socket.emit('connection_error', {
        message: error instanceof Error ? error.message : 'Failed to connect to server'
      });
    }
  });

  // Handle query processing with optimized context
  socket.on('process_query', async (data) => {
    try {
      const { query, messageId } = data;
      const sessionId = socketToSession.get(socket.id);
      
      if (!sessionId) {
        socket.emit('query_error', {
          messageId,
          message: 'Session not found. Please refresh the page.'
        });
        return;
      }
      
      socket.emit('query_progress', { 
        messageId, 
        status: 'processing', 
        message: 'Processing your query...' 
      });
      
      const result = await mcpService.processQuery(query, sessionId);
      
      socket.emit('query_response', {
        messageId,
        response: result.response,
        toolsUsed: result.toolsUsed
      });
    } catch (error) {
      socket.emit('query_error', {
        messageId: data.messageId,
        message: error instanceof Error ? error.message : 'Failed to process query'
      });
    }
  });

  // Handle context requests with optimized data
  socket.on('get_context', async (data) => {
    try {
      const sessionId = socketToSession.get(socket.id);
      if (!sessionId) {
        socket.emit('context_error', { message: 'Session not found' });
        return;
      }
      
      const context = await mcpService['contextManager'].getSession(sessionId);
      socket.emit('context_response', {
        messages: context?.messages || [],
        toolUsage: context?.toolUsageHistory || [],
        userPreferences: context?.userPreferences || {},
        activeEntities: context?.activeEntities || {}
      });
    } catch (error) {
      socket.emit('context_error', {
        message: error instanceof Error ? error.message : 'Failed to get context'
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    const sessionId = socketToSession.get(socket.id);
    if (sessionId) {
      console.log(`🧹 Cleaned up session ${sessionId} for socket ${socket.id}`);
      socketToSession.delete(socket.id);
    }
  });
});

// REST API endpoints (alternative to WebSocket)
app.get('/api/status', (req, res) => {
  const status = mcpService.getConnectionStatus();
  res.json({
    ...status,
    autoConnectRetries: mcpService['autoConnectRetries'],
    maxAutoConnectRetries: mcpService['maxAutoConnectRetries']
  });
});

// Keep manual connect endpoint for fallback/reconnection
app.post('/api/connect', async (req, res) => {
  try {
    const { serverPath } = req.body;
    const result = await mcpService.connectToServer(serverPath);
    res.json({ 
      success: true, 
      tools: result.tools,
      message: 'Manual connection successful'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection failed',
      autoConnectRetries: mcpService['autoConnectRetries']
    });
  }
});

// Add health check endpoint
app.get('/api/health', (req, res) => {
  const status = mcpService.getConnectionStatus();
  res.json({
    status: status.isConnected ? 'healthy' : 'unhealthy',
    connected: status.isConnected,
    tools: status.tools,
    autoConnectRetries: mcpService['autoConnectRetries']
  });
});

app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;
    // Create a temporary session for REST API queries
    const tempSessionId = randomUUID();
    await mcpService['contextManager'].createSession(tempSessionId, 'rest_api_user');
    
    const result = await mcpService.processQuery(query, tempSessionId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Query processing failed' 
    });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await mcpService.cleanup();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await mcpService.cleanup();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`🚀 MCP Backend Service running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔗 REST API endpoint: http://localhost:${PORT}/api`);
  console.log(`⚡ Optimized for token efficiency and performance`);
});
