// server.ts - Backend service for MCP React UI
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

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173", "https://app.worxstream.io"],
    methods: ["GET", "POST"]
  }
});

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:5173", "https://app.worxstream.io"],
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

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

  async processQuery(query: string, sessionId: string) {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    // Add user message to context
    await this.contextManager.addMessage(sessionId, 'user', query);

    // Generate context for the conversation
    const toolContext = await this.contextManager.generateToolContext(sessionId, query);
    
    // Extract entities for context information
    const contextEntities = await this.contextManager['extractEntitiesFromContext'](toolContext);
    
    // Build contextual information for system prompt
    let contextInfo = `
Current conversation context:
- User intent: ${toolContext.userIntent}
- Recent queries: ${toolContext.recentQueries.slice(-3).join(', ')}
- Previous tool results available: ${toolContext.previousResults.length > 0 ? 'Yes' : 'No'}`;

    // Add specific entity context if available
    if (contextEntities.lastCustomerName) {
      contextInfo += `
- Last discussed customer: ${contextEntities.lastCustomerName}${contextEntities.lastCustomerId ? ` (ID: ${contextEntities.lastCustomerId})` : ''}`;
    }
    if (contextEntities.lastProductName) {
      contextInfo += `
- Last discussed product: ${contextEntities.lastProductName}${contextEntities.lastProductId ? ` (ID: ${contextEntities.lastProductId})` : ''}`;
    }
    if (contextEntities.mentionedCustomer) {
      contextInfo += `
- Recently mentioned: ${contextEntities.mentionedCustomer}`;
    }

    // Enhance system prompt with context
    const contextualSystemPrompt = `${this.SYSTEM_PROMPT}
${contextInfo}

Use this context to provide more relevant and personalized responses. When users use pronouns or references like "he", "his", "that customer", automatically resolve them from the context above.

CRITICAL: When tools return formatted output with sections, headers, bullet points, or structured data, you MUST display it exactly as provided. Never summarize or rewrite formatted tool outputs - show them verbatim.`;

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: query,
      },
    ];

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        system: contextualSystemPrompt,
        messages,
        tools: this.tools,
      } as any);

      // Handle tool use in a loop to support multi-turn tool interactions
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
          
          // Add assistant response to context
          const toolNames = toolUsageLog.map(t => t.name);
          await this.contextManager.addMessage(
            sessionId, 
            'assistant', 
            textContent || "No response generated.",
            toolNames.length > 0 ? toolNames : undefined
          );
          
          return {
            response: textContent || "No response generated.",
            toolsUsed: toolUsageLog
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

          // Check cache first
          let result = await this.contextManager.getCachedResult(toolName, originalArgs || {});
          
          if (!result) {
            // Enhance tool arguments with context
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
              
              // Cache the result (5 minutes for search results, longer for data)
              const cacheTime = toolName.includes('search') ? 300 : 3600;
              await this.contextManager.cacheToolResult(toolName, originalArgs || {}, result, cacheTime);
              
              // Record tool usage in context
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
            console.log(`Using cached result for ${toolName}`);
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
          
          // Add assistant response to context
          const toolNames = toolUsageLog.map(t => t.name);
          await this.contextManager.addMessage(
            sessionId, 
            'assistant', 
            verbatimContent,
            toolNames.length > 0 ? toolNames : undefined
          );
          
          return {
            response: verbatimContent,
            toolsUsed: toolUsageLog
          };
        }

        // Use special system prompt for verbatim display
        let finalSystemPrompt = contextualSystemPrompt;
        if (hasVerbatimFlag) {
          finalSystemPrompt = `${contextualSystemPrompt}

SPECIAL INSTRUCTION: The tool result includes a [DISPLAY_VERBATIM] flag. You MUST preserve all structured data (tables, headings, lists) and ensure it is displayed using professional markdown formatting. You MAY enhance readability using bold labels, spacing, section dividers, and monospace formatting where appropriate. Do NOT alter the actual text or its meaning. Only the [DISPLAY_VERBATIM] tag should be removed.
`;
        }

        // Get Claude's response to the tool results
        currentResponse = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          system: finalSystemPrompt,
          messages: currentMessages,
          tools: this.tools,
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
  
  // Create session in Redis
  await mcpService['contextManager'].createSession(sessionId, `user_${socket.id}`);
  
  console.log(`Created session ${sessionId} for socket ${socket.id}`);

  // Send current connection status
  socket.emit('connection_status', mcpService.getConnectionStatus());

  // Handle server connection requests
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

  // Handle query processing
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

  // Handle context requests
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
        userPreferences: context?.userPreferences || {}
      });
    } catch (error) {
      socket.emit('context_error', {
        message: error instanceof Error ? error.message : 'Failed to get context'
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const sessionId = socketToSession.get(socket.id);
    if (sessionId) {
      console.log(`Cleaned up session ${sessionId} for socket ${socket.id}`);
      socketToSession.delete(socket.id);
    }
  });
});

// REST API endpoints (alternative to WebSocket)
app.get('/api/status', (req, res) => {
  res.json(mcpService.getConnectionStatus());
});

app.post('/api/connect', async (req, res) => {
  try {
    const { serverPath } = req.body;
    const result = await mcpService.connectToServer(serverPath);
    res.json({ success: true, tools: result.tools });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection failed' 
    });
  }
});

app.post('/api/query', async (req, res) => {
  try {
    const { query } = req.body;
    const result = await mcpService.processQuery(query, randomUUID());
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
  console.log(`MCP Backend Service running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`REST API endpoint: http://localhost:${PORT}/api`);
});