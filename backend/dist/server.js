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
import { globalRateLimiter, RetryManager } from "./rate-limiter.js";
import { SYSTEM_PROMPT } from './resources/prompts.js';
import { allowedOrigins } from './resources/staticData.js';
import { filterInternalIds, classifyQuery, getSystemPrompt, getMaxTokens } from "./server-util.js";
import { pathToFileURL } from 'url';
import { saveConversation, getConversations, getConversation, deleteConversation, updateConversationTitle } from './conversation-db.js';
dotenv.config();
// Add MCP server path configuration
// Resolve __dirname in ES module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Dynamically resolve MCP server path for dev/prod
const MCP_SERVER_PATH = process.env.MCP_SERVER_PATH || (process.env.NODE_ENV === 'production'
    ? path.resolve(__dirname, '../../mcp-server/dist/mcp-server.js')
    : path.resolve(__dirname, '../../mcp-server/mcp-server.ts'));
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in the environment");
}
const anthropic = new Anthropic({ apiKey: anthropicApiKey });
// Model name configuration - default to standard Claude 3.5 Sonnet
const ANTHROPIC_MODEL = "claude-3-haiku-20240307";
async function generateSummaryWithClaude(chartJson) {
    const prompt = `
You are an expert business analyst. Given the following sales analytics data as JSON, write a concise, insightful summary for a business user. Highlight key metrics, trends, and any notable insights.\n\nData:\n${JSON.stringify(chartJson, null, 2)}\n\nSummary:`;
    const response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }]
    });
    return response.content?.[0]?.text?.trim() || "";
}
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST", "OPTIONS"],
        credentials: true,
        allowedHeaders: ["DNT", "User-Agent", "X-Requested-With", "If-Modified-Since", "Cache-Control", "Content-Type", "Range", "Authorization"]
    }
});
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, Postman, curl)
        if (!origin) {
            return callback(null, true);
        }
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // Allow Expo origins (exp://, expo://)
        if (origin.includes('exp://') || origin.includes('expo://')) {
            return callback(null, true);
        }
        // Allow local network IPs for development (192.168.x.x, 10.x.x.x, etc.)
        if (process.env.NODE_ENV !== 'production') {
            const localNetworkPattern = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost|127\.0\.0\.1)/;
            if (localNetworkPattern.test(origin)) {
                return callback(null, true);
            }
        }
        // For production, you might want to be more strict
        // For now, allow all origins (can be restricted later with proper auth)
        callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["DNT", "User-Agent", "X-Requested-With", "If-Modified-Since", "Cache-Control", "Content-Type", "Range", "Authorization"],
    exposedHeaders: ["Content-Length", "Content-Range"]
}));
app.use(express.json());
// Add rate limiting status endpoint
app.get('/api/rate-limit-status', (req, res) => {
    const status = globalRateLimiter.getStatus();
    res.json({
        rateLimit: status,
        message: `Current API usage: ${status.currentRequests}/${status.maxRequests} requests per ${status.timeWindow / 1000}s window`,
        queueLength: status.queueLength,
        poolStatus: connectionPool.getPoolStatus()
    });
});
// Add connection pool status endpoint
app.get('/api/pool-status', (req, res) => {
    res.json({
        poolStatus: connectionPool.getPoolStatus(),
        message: 'Connection pool status'
    });
});
// Add socket connection test endpoint
app.get('/api/socket-test', (req, res) => {
    res.json({
        socketConnections: io.engine.clientsCount,
        sessions: socketToSession.size,
        message: 'Socket.IO status'
    });
});
class MCPBackendService {
    mcp;
    anthropic;
    transport = null;
    tools = [];
    isConnected = false;
    contextManager;
    autoConnectRetries = 0;
    maxAutoConnectRetries = 3;
    StdioClientTransport = StdioClientTransport;
    constructor() {
        this.anthropic = new Anthropic({
            apiKey: anthropicApiKey,
        });
        this.mcp = new Client({
            name: "mcp-client-web",
            version: "1.0.0",
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                elicitation: {} // Enable elicitation support for interactive workflows
            }
        });
        this.contextManager = new ContextManager();
        // Start auto-connection process using external function
        initializeAutoConnect(this, MCP_SERVER_PATH);
    }
    // Smart tool filtering based on query type and content
    getRelevantTools(queryType, query) {
        const lowerQuery = query.toLowerCase();
        // Always return all tools for tool-related queries
        if (lowerQuery.includes('tool') || lowerQuery.includes('capability') ||
            lowerQuery.includes('what can you do') || lowerQuery.includes('help')) {
            return this.tools;
        }
        if (queryType === 'greeting' || queryType === 'simple') {
            return []; // No tools needed for greetings/simple queries
        }
        if (queryType === 'business') {
            // --- PRIORITY: Analytics/Sales queries ---
            const analyticsKeywords = [
                'total sale', 'sales for customer', 'revenue', 'total revenue', 'analyze', 'analytics', 'total sales', 'customer sales', 'customer revenue', 'sales analysis', 'sales analytics', 'sales report', 'sales summary'
            ];
            if (analyticsKeywords.some(keyword => lowerQuery.includes(keyword)) ||
                (lowerQuery.includes('sales') && lowerQuery.includes('customer'))) {
                return this.tools.filter(tool => tool.name.toLowerCase().includes('analyzebusinessdata'));
            }
            // Filter tools based on query content for better token efficiency
            const relevantTools = this.tools.filter(tool => {
                const toolName = tool.name.toLowerCase();
                // Date-related queries - ALWAYS include date calculation tool for ANY date expression
                const dateKeywords = [
                    'yesterday', 'today', 'tomorrow', 'last', 'this', 'next', 'past', 'ago',
                    'date', 'time', 'period', 'range', 'week', 'month', 'year', 'days',
                    'quarter', 'decade', 'century', 'morning', 'afternoon', 'evening',
                    'night', 'dawn', 'dusk', 'noon', 'midnight', 'hour', 'minute', 'second',
                    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
                    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
                    'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr',
                    'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
                ];
                if (dateKeywords.some(keyword => lowerQuery.includes(keyword))) {
                    if (toolName === 'date-utility')
                        return true;
                }
                const keywords = ['delivery', 'delivery board', 'delivery schedule', 'delivery tracking', 'delivery planning', 'delivery logistics', 'delivery daily', 'delivery weekly', 'delivery monthly', 'delivery yearly', 'delivery board', 'delivery schedule', 'delivery tracking', 'delivery planning', 'delivery logistics', 'delivery daily', 'delivery weekly', 'delivery monthly', 'delivery yearly', 'deliveries', 'deliver'];
                // Delivery board queries
                if (keywords.some(keyword => lowerQuery.includes(keyword)) && toolName.includes('delivery'))
                    return true;
                // Customer-related queries
                if ((lowerQuery.includes('customer') || lowerQuery.includes('client')) &&
                    toolName.includes('customer'))
                    return true;
                // Specific customer name searches
                if (lowerQuery.includes('by name') || lowerQuery.includes('named') ||
                    (lowerQuery.includes('customer') && lowerQuery.includes('name'))) {
                    if (toolName.includes('findCustomerByName'))
                        return true;
                }
                // Product-related queries  
                if (lowerQuery.includes('product') && toolName.includes('product'))
                    return true;
                // Invoice-related queries
                if (lowerQuery.includes('invoice') && toolName.includes('invoice'))
                    return true;
                // Estimate-related queries
                if ((lowerQuery.includes('estimate') || lowerQuery.includes('quote')) &&
                    toolName.includes('estimate'))
                    return true;
                // General search/get operations
                if ((lowerQuery.includes('search') || lowerQuery.includes('find') ||
                    lowerQuery.includes('get') || lowerQuery.includes('list') ||
                    lowerQuery.includes('show')) &&
                    (toolName.includes('search') || toolName.includes('get') || toolName.includes('list')))
                    return true;
                return false;
            });
            // If no specific matches, include basic search tools and date tool
            if (relevantTools.length === 0) {
                return this.tools.filter(tool => {
                    const toolName = tool.name.toLowerCase();
                    return toolName.includes('search') ||
                        toolName.includes('list') ||
                        toolName === 'date-utility';
                });
            }
            return relevantTools;
        }
        return this.tools; // All tools for complex queries
    }
    // NEW: Streaming version of processQuery
    async processQueryStream(query, sessionId, onChunk) {
        if (!this.isConnected) {
            throw new Error("Not connected to MCP server");
        }
        // Check for yes/no address confirmation
        const context = await this.contextManager.getSession(sessionId);
        if (query.trim().toLowerCase() === 'yes') {
            if (context?.activeEntities.awaitingAddressConfirmation) {
                console.log('Address confirmation YES detected, calling address tool...');
                const customerId = context.activeEntities.awaitingAddressCustomerId;
                if (customerId) {
                    // Call the address tool with the stored customerId
                    const addressResult = await this.mcp.callTool({
                        name: 'searchCustomerAddress',
                        arguments: { customer_id: customerId },
                    });
                    const addressContent = Array.isArray(addressResult.content) ? addressResult.content : [];
                    const addressText = addressContent[0]?.text?.trim() || '';
                    console.log('[DEBUG] Raw address tool result:', addressText);
                    let formattedAddress = '';
                    if (!addressText || addressText.toLowerCase().includes('no address')) {
                        formattedAddress = 'No address found for this customer.';
                    }
                    else {
                        formattedAddress = filterInternalIds(addressText.replace('[DISPLAY_VERBATIM]', '').trim());
                    }
                    await this.contextManager.addMessage(sessionId, 'assistant', formattedAddress);
                    onChunk({
                        type: 'complete',
                        response: formattedAddress,
                        toolsUsed: ['searchCustomerAddress'],
                        queryType: 'business',
                        tokensOptimized: true
                    });
                    // Clear the flag
                    context.activeEntities.awaitingAddressConfirmation = false;
                    context.activeEntities.awaitingAddressCustomerId = undefined;
                    await this.contextManager.saveContext(sessionId, context);
                    return;
                }
            }
            else {
                // Fallback for out-of-context 'yes'
                console.log('Received "yes" but no address confirmation flag set. Sending fallback message.');
                const fallbackMsg = "Sorry, I’m not sure what you’re saying ‘yes’ to. Please search for a customer first.";
                await this.contextManager.addMessage(sessionId, 'assistant', fallbackMsg);
                onChunk({
                    type: 'complete',
                    response: fallbackMsg,
                    toolsUsed: [],
                    queryType: 'simple',
                    tokensOptimized: true
                });
                return;
            }
        }
        const queryType = classifyQuery(query);
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
                contextInfo += `\n- Active customer: ${activeEntities.customerName}`;
            }
            if (activeEntities.productName) {
                contextInfo += `\n- Active product: ${activeEntities.productName}`;
            }
        }
        // Get optimized system prompt and tools
        const systemPrompt = getSystemPrompt(queryType);
        const relevantTools = this.getRelevantTools(queryType, query);
        const maxTokens = getMaxTokens(queryType);
        // Build dynamic context string
        const activeEntities = toolContext?.activeEntities;
        const dynamicContext = activeEntities && activeEntities.customerName
            ? `The customer "${activeEntities.customerName}" was found via a secure business tool. It is authorized to display their business address.`
            : '';
        const contextualSystemPrompt = systemPrompt.replace('[CONTEXT_PLACEHOLDER]', dynamicContext);
        // Prepare messages
        const messages = [
            {
                role: "user",
                content: query,
            },
        ];
        console.log(`📊 Token optimization applied:
- Query type: ${queryType}
- System prompt: ${contextualSystemPrompt.length} chars (vs ${SYSTEM_PROMPT.length} full)
- Tools included: ${relevantTools.length}/${this.tools.length}
- Context info: ${contextInfo.length} chars
- Max tokens: ${maxTokens}`);
        try {
            onChunk({
                type: 'query_start',
                queryType,
                tokensOptimized: true,
                toolsAvailable: relevantTools.length
            });
            // Use rate limiting and retry logic for API calls
            const response = await globalRateLimiter.execute(() => RetryManager.retryWithExponentialBackoff(() => this.anthropic.messages.create({
                model: ANTHROPIC_MODEL,
                max_tokens: maxTokens,
                system: contextualSystemPrompt,
                messages,
                tools: relevantTools,
                stream: true,
            })));
            let streamedContent = '';
            let toolCalls = [];
            let currentToolCall = null;
            // Handle streaming response
            for await (const chunk of response) {
                if (chunk.type === 'message_start') {
                    onChunk({
                        type: 'message_start',
                        queryType,
                        tokensOptimized: true
                    });
                }
                else if (chunk.type === 'content_block_start') {
                    if (chunk.content_block.type === 'text') {
                        onChunk({
                            type: 'content_start',
                            contentType: 'text'
                        });
                    }
                    else if (chunk.content_block.type === 'tool_use') {
                        currentToolCall = {
                            id: chunk.content_block.id,
                            name: chunk.content_block.name,
                            input: {}
                        };
                        onChunk({
                            type: 'tool_start',
                            tool: {
                                name: chunk.content_block.name,
                                id: chunk.content_block.id
                            }
                        });
                    }
                }
                else if (chunk.type === 'content_block_delta') {
                    if (chunk.delta.type === 'text_delta') {
                        streamedContent += chunk.delta.text;
                        onChunk({
                            type: 'text_delta',
                            delta: chunk.delta.text,
                            accumulated: streamedContent
                        });
                    }
                    else if (chunk.delta.type === 'input_json_delta') {
                        if (currentToolCall) {
                            try {
                                const partialInput = JSON.parse(currentToolCall.inputJson + chunk.delta.partial_json);
                                currentToolCall.input = partialInput;
                            }
                            catch (e) {
                                // JSON might be incomplete, store for next chunk
                                currentToolCall.inputJson = (currentToolCall.inputJson || '') + chunk.delta.partial_json;
                            }
                        }
                        onChunk({
                            type: 'tool_input_delta',
                            delta: chunk.delta.partial_json
                        });
                    }
                }
                else if (chunk.type === 'content_block_stop') {
                    if (currentToolCall) {
                        try {
                            if (currentToolCall.inputJson) {
                                try {
                                    // Only parse if it looks like valid JSON (starts with { and ends with })
                                    const trimmed = currentToolCall.inputJson.trim();
                                    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                                        currentToolCall.input = JSON.parse(trimmed);
                                    }
                                    else {
                                        // Incomplete JSON, skip parsing for now
                                        console.warn('[WARN] Skipping parse of incomplete tool input JSON:', currentToolCall.inputJson);
                                    }
                                }
                                catch (e) {
                                    console.error('[ERROR] Failed to parse tool input JSON:', currentToolCall.inputJson, e);
                                }
                            }
                        }
                        catch (e) {
                            console.error('Failed to parse tool input JSON:', e);
                        }
                        toolCalls.push(currentToolCall);
                        currentToolCall = null;
                    }
                }
                else if (chunk.type === 'message_delta') {
                    if (chunk.delta.stop_reason) {
                        onChunk({
                            type: 'message_delta',
                            stopReason: chunk.delta.stop_reason
                        });
                    }
                }
                else if (chunk.type === 'message_stop') {
                    break;
                }
            }
            // For greetings and simple queries, finish here
            if (queryType === 'greeting' || queryType === 'simple') {
                await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim());
                onChunk({
                    type: 'complete',
                    response: filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim(),
                    toolsUsed: [],
                    queryType,
                    tokensOptimized: true
                });
                return;
            }
            // If there are tool calls, process them
            if (toolCalls.length > 0) {
                await this.processToolCallsWithStreaming(toolCalls, streamedContent, messages, contextualSystemPrompt, relevantTools, maxTokens, sessionId, query, onChunk);
            }
            else {
                // No tool calls, just return the streamed content
                await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim());
                onChunk({
                    type: 'complete',
                    response: filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim(),
                    toolsUsed: [],
                    queryType,
                    tokensOptimized: true
                });
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error processing query:", error);
            onChunk({
                type: 'error',
                error: `Error processing query: ${errorMessage}`
            });
        }
    }
    // Helper method to handle tool calls with streaming
    // Helper method to handle tool calls with streaming - UPDATED
    async processToolCallsWithStreaming(toolCalls, initialContent, currentMessages, systemPrompt, relevantTools, maxTokens, sessionId, originalQuery, onChunk) {
        const toolUsageLog = [];
        // Add the assistant's response with tool calls to the conversation
        const assistantContent = [];
        if (initialContent) {
            assistantContent.push({
                type: "text",
                text: initialContent
            });
        }
        // Add tool calls to the content
        for (const toolCall of toolCalls) {
            assistantContent.push({
                type: "tool_use",
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input
            });
        }
        currentMessages.push({
            role: "assistant",
            content: assistantContent,
        });
        // Process each tool call
        const toolResults = [];
        for (const toolCall of toolCalls) {
            const toolName = toolCall.name;
            const originalArgs = toolCall.input;
            onChunk({
                type: 'tool_executing',
                tool: toolName,
                args: originalArgs
            });
            // Check cache first
            let result = null;
            if (toolName !== 'analyzeBusinessData') {
                result = await this.contextManager.getCachedResult(toolName, originalArgs || {});
            }
            if (!result || toolName === 'date-utility') { // Skip cache for date-utility and analytics
                // Enhance tool arguments with context
                const enhancedArgs = await this.contextManager.enhanceToolArguments(sessionId, toolName, originalArgs || {}, originalQuery);
                console.log(`🧠 Context: Tool ${toolName} enhanced arguments:`, JSON.stringify(enhancedArgs, null, 2));
                toolUsageLog.push({ name: toolName, args: enhancedArgs });
                try {
                    result = await this.mcp.callTool({
                        name: toolName,
                        arguments: enhancedArgs,
                    });
                    console.log("Tool result:", JSON.stringify(result, null, 2));
                    // Cache the result (but NOT for analyzeBusinessData)
                    const cacheTime = toolName.includes('search') ? 300 :
                        toolName === 'date-utility' ? 0 : 3600; // Don't cache date-utility
                    if (cacheTime > 0 && toolName !== 'analyzeBusinessData') {
                        await this.contextManager.cacheToolResult(toolName, originalArgs || {}, result, cacheTime);
                    }
                    // Always record tool usage (which updates activeEntities) with the raw tool result
                    await this.contextManager.recordToolUsage(sessionId, toolName, enhancedArgs, result);
                    // Refresh context after tool usage
                    const sessionContext = await this.contextManager.getSession(sessionId);
                    if (toolName === 'findCustomerByName' || toolName === 'searchCustomerList') {
                        if (sessionContext && sessionContext.activeEntities.customerId) {
                            console.log('[DEBUG] Setting address confirmation flag for customerId:', sessionContext.activeEntities.customerId);
                            sessionContext.activeEntities.awaitingAddressConfirmation = true;
                            sessionContext.activeEntities.awaitingAddressCustomerId = sessionContext.activeEntities.customerId;
                            await this.contextManager.saveContext(sessionId, sessionContext);
                            console.log('[DEBUG] After customer search, activeEntities:', JSON.stringify(sessionContext.activeEntities, null, 2));
                        }
                        else {
                            console.log('[DEBUG] Not setting flag: sessionContext or customerId missing', sessionContext);
                        }
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`Error calling tool ${toolName}:`, error);
                    result = {
                        content: [{ type: "text", text: `Error: ${errorMessage}` }],
                        isError: true
                    };
                }
            }
            else {
                console.log(`✅ Using cached result for ${toolName}`);
                toolUsageLog.push({ name: toolName, args: originalArgs, cached: true });
            }
            onChunk({
                type: 'tool_result',
                tool: toolName,
                result: result.content || [{ type: "text", text: JSON.stringify(result) }],
                cached: !!result.cached
            });
            toolResults.push({
                type: "tool_result",
                tool_use_id: toolCall.id,
                content: result.content || [{ type: "text", text: JSON.stringify(result) }],
                is_error: result.isError || false,
            });
            // Special handling for analyzeBusinessData: generate summary and send both chart and summary
            if (toolName === "analyzeBusinessData" &&
                result.content &&
                Array.isArray(result.content) &&
                result.content[0]?.type === "text") {
                try {
                    const chartJson = JSON.parse(result.content[0].text);
                    onChunk({
                        type: "complete",
                        response: `[DISPLAY_VERBATIM]${JSON.stringify(chartJson, null, 2)}`,
                        toolsUsed: [toolName]
                    });
                    return;
                }
                catch (e) {
                    onChunk({
                        type: "complete",
                        response: result.content[0].text,
                        toolsUsed: [toolName]
                    });
                    return;
                }
            }
        }
        // Check if tool results contain formatted content with tags (<table>, <card>, <chart>, <text>)
        const CUSTOM_TAGS = ['<table>', '<card>', '<chart>', '<text>'];
        const hasFormattedContent = toolResults.some(result => result.content.some((content) => {
            if (content.type === "text") {
                return CUSTOM_TAGS.some(tag => content.text.includes(tag));
            }
            return false;
        }));
        // If tool results already have formatted tags (from search/product tools),
        // extract and send directly WITHOUT asking Claude to respond again
        if (hasFormattedContent) {
            const formattedContent = toolResults
                .flatMap(result => result.content)
                .filter((content) => content.type === "text" && CUSTOM_TAGS.some(tag => content.text.includes(tag)))
                .map((content) => content.text)
                .join("\n\n");
            if (formattedContent) {
                // Stream the formatted content with tags
                const lines = formattedContent.split('\n');
                let accumulated = '';
                for (const line of lines) {
                    accumulated += line + '\n';
                    onChunk({
                        type: 'text_delta',
                        delta: line + '\n',
                        accumulated: accumulated.trim(),
                        isFormatted: true
                    });
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
                await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(formattedContent).replace('[DISPLAY_VERBATIM]', '').trim(), toolUsageLog.length > 0 ? toolUsageLog.map(t => t.name) : undefined);
                onChunk({
                    type: 'complete',
                    response: filterInternalIds(formattedContent).replace('[DISPLAY_VERBATIM]', '').trim(),
                    toolsUsed: toolUsageLog,
                    skipClaudeResponse: true
                });
                return;
            }
        }
        // Add tool results to the conversation
        currentMessages.push({
            role: "user",
            content: toolResults,
        });
        // Check if any tool result has DISPLAY_VERBATIM flag
        const hasVerbatimFlag = toolResults.some(result => result.content.some((content) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]")));
        // For verbatim content, bypass Claude and return directly
        if (hasVerbatimFlag) {
            const verbatimContent = toolResults
                .flatMap(result => result.content)
                .filter((content) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]"))
                .map((content) => content.text.replace("[DISPLAY_VERBATIM] ", ""))
                .join("\n\n");
            // Stream the verbatim content
            const lines = verbatimContent.split('\n');
            let accumulated = '';
            for (const line of lines) {
                accumulated += line + '\n';
                onChunk({
                    type: 'text_delta',
                    delta: line + '\n',
                    accumulated: accumulated.trim(),
                    isVerbatim: true
                });
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(verbatimContent).replace('[DISPLAY_VERBATIM]', '').trim(), toolUsageLog.length > 0 ? toolUsageLog.map(t => t.name) : undefined);
            onChunk({
                type: 'complete',
                response: filterInternalIds(verbatimContent).replace('[DISPLAY_VERBATIM]', '').trim(),
                toolsUsed: toolUsageLog
            });
            return;
        }
        // **CRITICAL FIX: Continue processing iteratively like the non-streaming version**
        await this.continueStreamingConversation(currentMessages, systemPrompt, relevantTools, maxTokens, sessionId, originalQuery, toolUsageLog, onChunk);
    }
    // **NEW METHOD: Handle iterative conversation with streaming**
    async continueStreamingConversation(currentMessages, systemPrompt, relevantTools, maxTokens, sessionId, originalQuery, toolUsageLog, onChunk) {
        while (true) {
            try {
                // Get Claude's streaming response to the tool results
                const response = await globalRateLimiter.execute(() => RetryManager.retryWithExponentialBackoff(() => this.anthropic.messages.create({
                    model: ANTHROPIC_MODEL,
                    max_tokens: maxTokens,
                    system: systemPrompt,
                    messages: currentMessages,
                    tools: relevantTools,
                    stream: true,
                })));
                let streamedContent = '';
                let newToolCalls = [];
                let currentToolCall = null;
                // Handle streaming response
                for await (const chunk of response) {
                    if (chunk.type === 'content_block_start') {
                        if (chunk.content_block.type === 'text') {
                            // Text content starting
                        }
                        else if (chunk.content_block.type === 'tool_use') {
                            currentToolCall = {
                                id: chunk.content_block.id,
                                name: chunk.content_block.name,
                                input: {}
                            };
                            onChunk({
                                type: 'tool_start',
                                tool: {
                                    name: chunk.content_block.name,
                                    id: chunk.content_block.id
                                }
                            });
                        }
                    }
                    else if (chunk.type === 'content_block_delta') {
                        if (chunk.delta.type === 'text_delta') {
                            streamedContent += chunk.delta.text;
                            onChunk({
                                type: 'text_delta',
                                delta: chunk.delta.text,
                                accumulated: streamedContent
                            });
                        }
                        else if (chunk.delta.type === 'input_json_delta') {
                            if (currentToolCall) {
                                try {
                                    const partialInput = JSON.parse((currentToolCall.inputJson || '') + chunk.delta.partial_json);
                                    currentToolCall.input = partialInput;
                                }
                                catch (e) {
                                    // JSON might be incomplete, store for next chunk
                                    currentToolCall.inputJson = (currentToolCall.inputJson || '') + chunk.delta.partial_json;
                                }
                            }
                            onChunk({
                                type: 'tool_input_delta',
                                delta: chunk.delta.partial_json
                            });
                        }
                    }
                    else if (chunk.type === 'content_block_stop') {
                        if (currentToolCall) {
                            try {
                                if (currentToolCall.inputJson) {
                                    try {
                                        // Only parse if it looks like valid JSON (starts with { and ends with })
                                        const trimmed = currentToolCall.inputJson.trim();
                                        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                                            currentToolCall.input = JSON.parse(trimmed);
                                        }
                                        else {
                                            // Incomplete JSON, skip parsing for now
                                            console.warn('[WARN] Skipping parse of incomplete tool input JSON:', currentToolCall.inputJson);
                                        }
                                    }
                                    catch (e) {
                                        console.error('[ERROR] Failed to parse tool input JSON:', currentToolCall.inputJson, e);
                                    }
                                }
                            }
                            catch (e) {
                                console.error('Failed to parse tool input JSON:', e);
                            }
                            newToolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }
                    }
                    else if (chunk.type === 'message_stop') {
                        break;
                    }
                }
                // If no more tool calls, we're done
                if (newToolCalls.length === 0) {
                    // Final response - save to context and complete
                    await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim());
                    onChunk({
                        type: 'complete',
                        response: filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim(),
                        toolsUsed: toolUsageLog
                    });
                    return;
                }
                // Add the assistant's response with new tool calls to the conversation
                const assistantContent = [];
                if (streamedContent) {
                    assistantContent.push({
                        type: "text",
                        text: streamedContent
                    });
                }
                // Add new tool calls to the content
                for (const toolCall of newToolCalls) {
                    assistantContent.push({
                        type: "tool_use",
                        id: toolCall.id,
                        name: toolCall.name,
                        input: toolCall.input
                    });
                }
                currentMessages.push({
                    role: "assistant",
                    content: assistantContent,
                });
                // Process the new tool calls
                const toolResults = [];
                for (const toolCall of newToolCalls) {
                    const toolName = toolCall.name;
                    const originalArgs = toolCall.input;
                    onChunk({
                        type: 'tool_executing',
                        tool: toolName,
                        args: originalArgs
                    });
                    // Check cache first
                    let result = await this.contextManager.getCachedResult(toolName, originalArgs || {});
                    if (!result) {
                        // Enhance tool arguments with context
                        const enhancedArgs = await this.contextManager.enhanceToolArguments(sessionId, toolName, originalArgs || {}, originalQuery);
                        console.log(`🧠 Context: Tool ${toolName} enhanced arguments:`, JSON.stringify(enhancedArgs, null, 2));
                        toolUsageLog.push({ name: toolName, args: enhancedArgs });
                        try {
                            result = await this.mcp.callTool({
                                name: toolName,
                                arguments: enhancedArgs,
                            });
                            console.log("Tool result:", JSON.stringify(result, null, 2));
                            // Cache the result
                            const cacheTime = toolName.includes('search') ? 300 : 3600;
                            await this.contextManager.cacheToolResult(toolName, originalArgs || {}, result, cacheTime);
                            // Record tool usage in context
                            await this.contextManager.recordToolUsage(sessionId, toolName, enhancedArgs, result);
                        }
                        catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            console.error(`Error calling tool ${toolName}:`, error);
                            result = {
                                content: [{ type: "text", text: `Error: ${errorMessage}` }],
                                isError: true
                            };
                        }
                    }
                    else {
                        console.log(`✅ Using cached result for ${toolName}`);
                        toolUsageLog.push({ name: toolName, args: originalArgs, cached: true });
                    }
                    onChunk({
                        type: 'tool_result',
                        tool: toolName,
                        result: result.content || [{ type: "text", text: JSON.stringify(result) }],
                        cached: !!result.cached
                    });
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolCall.id,
                        content: result.content || [{ type: "text", text: JSON.stringify(result) }],
                        is_error: result.isError || false,
                    });
                }
                // Check if tool results contain formatted content with tags (<table>, <card>, <chart>, <text>)
                const CUSTOM_TAGS_V2 = ['<table>', '<card>', '<chart>', '<text>'];
                const hasFormattedContent2 = toolResults.some(result => result.content.some((content) => {
                    if (content.type === "text") {
                        return CUSTOM_TAGS_V2.some(tag => content.text.includes(tag));
                    }
                    return false;
                }));
                // If tool results already have formatted tags, send directly WITHOUT Claude response
                if (hasFormattedContent2) {
                    const formattedContent = toolResults
                        .flatMap(result => result.content)
                        .filter((content) => content.type === "text" && CUSTOM_TAGS_V2.some(tag => content.text.includes(tag)))
                        .map((content) => content.text)
                        .join("\n\n");
                    if (formattedContent) {
                        // Stream the formatted content with tags
                        const lines = formattedContent.split('\n');
                        let accumulated = '';
                        for (const line of lines) {
                            accumulated += line + '\n';
                            onChunk({
                                type: 'text_delta',
                                delta: line + '\n',
                                accumulated: accumulated.trim(),
                                isFormatted: true
                            });
                            await new Promise(resolve => setTimeout(resolve, 5));
                        }
                        await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(formattedContent).replace('[DISPLAY_VERBATIM]', '').trim(), toolUsageLog.length > 0 ? toolUsageLog.map(t => t.name) : undefined);
                        onChunk({
                            type: 'complete',
                            response: filterInternalIds(formattedContent).replace('[DISPLAY_VERBATIM]', '').trim(),
                            toolsUsed: toolUsageLog,
                            skipClaudeResponse: true
                        });
                        return;
                    }
                }
                // Add tool results to the conversation
                currentMessages.push({
                    role: "user",
                    content: toolResults,
                });
                // Check for verbatim content
                const hasVerbatimFlag = toolResults.some(result => result.content.some((content) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]")));
                if (hasVerbatimFlag) {
                    const verbatimContent = toolResults
                        .flatMap(result => result.content)
                        .filter((content) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]"))
                        .map((content) => content.text.replace("[DISPLAY_VERBATIM] ", ""))
                        .join("\n\n");
                    // Stream the verbatim content
                    const lines = verbatimContent.split('\n');
                    let accumulated = '';
                    for (const line of lines) {
                        accumulated += line + '\n';
                        onChunk({
                            type: 'text_delta',
                            delta: line + '\n',
                            accumulated: accumulated.trim(),
                            isVerbatim: true
                        });
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(verbatimContent).replace('[DISPLAY_VERBATIM]', '').trim(), toolUsageLog.length > 0 ? toolUsageLog.map(t => t.name) : undefined);
                    onChunk({
                        type: 'complete',
                        response: filterInternalIds(verbatimContent).replace('[DISPLAY_VERBATIM]', '').trim(),
                        toolsUsed: toolUsageLog
                    });
                    return;
                }
                // Continue the loop to handle the next iteration
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error("Error in streaming conversation:", error);
                onChunk({
                    type: 'error',
                    error: `Error in conversation: ${errorMessage}`
                });
                return;
            }
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
        }
        catch (error) {
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
// Accepts MCPBackendService instance and MCP_SERVER_PATH as arguments
async function initializeAutoConnect(mcpServiceInstance, MCP_SERVER_PATH) {
    try {
        const serverPath = MCP_SERVER_PATH;
        console.log('🔄 Attempting auto-connection to MCP server at:', serverPath);
        // Check if file exists before attempting connection
        try {
            await import(pathToFileURL(serverPath).href);
        }
        catch (error) {
            console.error("Dynamic import failed with error:", error);
            throw new Error(`MCP server file not found at ${serverPath}. Please ensure the file exists and the path is correct. Original error: ${error}`);
        }
        await connectToServer(mcpServiceInstance, serverPath);
        console.log('✅ Successfully auto-connected to MCP server');
        mcpServiceInstance.autoConnectRetries = 0;
    }
    catch (error) {
        mcpServiceInstance.autoConnectRetries++;
        console.error(`❌ Auto-connection attempt ${mcpServiceInstance.autoConnectRetries} failed:`, error);
        if (mcpServiceInstance.autoConnectRetries < mcpServiceInstance.maxAutoConnectRetries) {
            const backoffMs = Math.min(1000 * Math.pow(2, mcpServiceInstance.autoConnectRetries), 10000);
            console.log(`🔄 Retrying auto-connection in ${backoffMs / 1000} seconds...`);
            setTimeout(() => initializeAutoConnect(mcpServiceInstance, MCP_SERVER_PATH), backoffMs);
        }
        else {
            console.error('❌ Max auto-connection retries exceeded. Manual connection will be required.');
        }
    }
}
// Accepts MCPBackendService instance and serverScriptPath as arguments
async function connectToServer(mcpServiceInstance, serverScriptPath) {
    try {
        const isJs = serverScriptPath.endsWith('.js');
        const isPy = serverScriptPath.endsWith('.py');
        const isTs = serverScriptPath.endsWith('.ts');
        if (!isJs && !isPy && !isTs) {
            throw new Error('Server script must be a .js, .ts, or .py file');
        }
        let command;
        let args;
        if (isPy) {
            command = process.platform === 'win32' ? 'python' : 'python3';
            args = [serverScriptPath];
        }
        else if (isTs) {
            command = 'npx';
            args = ['tsx', serverScriptPath];
        }
        else {
            command = process.execPath;
            args = [serverScriptPath];
        }
        mcpServiceInstance.transport = new mcpServiceInstance.StdioClientTransport({
            command,
            args,
        });
        await mcpServiceInstance.mcp.connect(mcpServiceInstance.transport);
        const toolsResult = await mcpServiceInstance.mcp.listTools();
        mcpServiceInstance.tools = toolsResult.tools.map((tool) => {
            return {
                name: tool.name,
                description: tool.description || '',
                input_schema: tool.inputSchema,
            };
        });
        mcpServiceInstance.isConnected = true;
        console.log('Connected to MCP server with tools:', mcpServiceInstance.tools.map(({ name }) => name).join(', '));
        return {
            success: true,
            tools: mcpServiceInstance.tools.map(({ name, description }) => ({ name, description })),
        };
    }
    catch (e) {
        console.error('Failed to connect to MCP server:', e);
        throw e;
    }
}
// Create MCP service instance
const mcpService = new MCPBackendService();
// Store session mappings for socket connections
const socketToSession = new Map();
// Connection pool for handling multiple users
class MCPConnectionPool {
    pool = new Map();
    maxConnections = 25; // Increased for 25+ employee organizations
    connectionQueue = [];
    connectionTimeout = 300000; // 5 minutes timeout
    lastActivity = new Map();
    async getConnection(sessionId) {
        // Check if we already have a connection for this session
        if (this.pool.has(sessionId)) {
            const connection = this.pool.get(sessionId);
            // Update last activity
            this.lastActivity.set(sessionId, Date.now());
            return connection;
        }
        // Check if we can create a new connection
        if (this.pool.size < this.maxConnections) {
            const connection = new MCPBackendService();
            this.pool.set(sessionId, connection);
            this.lastActivity.set(sessionId, Date.now());
            return connection;
        }
        // Try to clean up inactive connections first
        await this.cleanupInactiveConnections();
        // Check again after cleanup
        if (this.pool.size < this.maxConnections) {
            const connection = new MCPBackendService();
            this.pool.set(sessionId, connection);
            this.lastActivity.set(sessionId, Date.now());
            return connection;
        }
        // Wait for a connection to become available
        return new Promise((resolve, reject) => {
            this.connectionQueue.push({ resolve, reject });
        });
    }
    async releaseConnection(sessionId) {
        const connection = this.pool.get(sessionId);
        if (connection) {
            // Clean up the connection
            await connection.cleanup();
            this.pool.delete(sessionId);
            this.lastActivity.delete(sessionId);
            // Process queued requests
            if (this.connectionQueue.length > 0) {
                const nextRequest = this.connectionQueue.shift();
                if (nextRequest) {
                    const newConnection = new MCPBackendService();
                    this.pool.set(sessionId, newConnection);
                    this.lastActivity.set(sessionId, Date.now());
                    nextRequest.resolve(newConnection);
                }
            }
        }
    }
    async cleanupInactiveConnections() {
        const now = Date.now();
        const inactiveSessions = [];
        // Find inactive connections
        for (const [sessionId, lastActivity] of this.lastActivity.entries()) {
            if (now - lastActivity > this.connectionTimeout) {
                inactiveSessions.push(sessionId);
            }
        }
        // Clean up inactive connections
        for (const sessionId of inactiveSessions) {
            await this.releaseConnection(sessionId);
        }
        if (inactiveSessions.length > 0) {
            console.log(`🧹 Cleaned up ${inactiveSessions.length} inactive connections`);
        }
    }
    getPoolStatus() {
        return {
            activeConnections: this.pool.size,
            maxConnections: this.maxConnections,
            queuedRequests: this.connectionQueue.length,
            inactiveConnections: Array.from(this.lastActivity.entries())
                .filter(([_, lastActivity]) => Date.now() - lastActivity > this.connectionTimeout).length
        };
    }
}
const connectionPool = new MCPConnectionPool();
// Periodic cleanup of inactive connections (every 2 minutes)
setInterval(async () => {
    try {
        await connectionPool['cleanupInactiveConnections']();
    }
    catch (error) {
        console.error('Error during periodic connection cleanup:', error);
    }
}, 120000); // 2 minutes
// Socket.IO connection handling
io.on('connection', async (socket) => {
    console.log(`🔌 New socket connection: ${socket.id}`);
    // Create or retrieve session for this socket
    const sessionId = randomUUID();
    socketToSession.set(socket.id, sessionId);
    try {
        console.log(`📋 Setting up session: ${sessionId} for socket: ${socket.id}`);
        // Get connection for this session
        const mcpService = await connectionPool.getConnection(sessionId);
        console.log(`✅ Got MCP service for session: ${sessionId}`);
        // Create session in Redis with optimized context manager
        await mcpService['contextManager'].createSession(sessionId, `user_${socket.id}`);
        console.log(`✅ Created Redis session for: ${sessionId}`);
        // Send current connection status
        const connectionStatus = mcpService.getConnectionStatus();
        console.log(`📊 Connection status for ${sessionId}:`, connectionStatus);
        socket.emit('connection_status', connectionStatus);
        // If already connected via auto-connect, send success message
        if (connectionStatus.isConnected) {
            console.log(`🎉 MCP server connected for session: ${sessionId}`);
            socket.emit('connection_success', {
                message: 'Connected to MCP server',
                tools: connectionStatus.tools
            });
        }
        else {
            console.log(`⏳ MCP server not yet connected for session: ${sessionId}`);
            socket.emit('connection_pending', {
                message: 'Connecting to MCP server...',
                autoConnectRetries: mcpService['autoConnectRetries']
            });
        }
    }
    catch (error) {
        console.error(`❌ Error setting up socket connection for ${sessionId}:`, error);
        socket.emit('connection_error', {
            message: error instanceof Error ? error.message : 'Failed to setup connection'
        });
    }
    // Keep manual connection handler for fallback/reconnection
    socket.on('connect_server', async (data) => {
        try {
            const sessionId = socketToSession.get(socket.id);
            if (!sessionId) {
                socket.emit('connection_error', { message: 'Session not found' });
                return;
            }
            const { serverPath } = data;
            socket.emit('connection_progress', { status: 'connecting', message: 'Connecting to MCP server...' });
            const mcpService = await connectionPool.getConnection(sessionId);
            const result = await connectToServer(mcpService, serverPath);
            socket.emit('connection_success', {
                message: `Successfully connected to ${serverPath}`,
                tools: result.tools
            });
            // Broadcast to all clients that server is connected
            const connectionStatus = mcpService.getConnectionStatus();
            io.emit('connection_status', connectionStatus);
        }
        catch (error) {
            socket.emit('connection_error', {
                message: error instanceof Error ? error.message : 'Failed to connect to server'
            });
        }
    });
    // NEW: Handle streaming query processing
    socket.on('process_query_stream', async (data) => {
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
            // Get connection for this session
            const mcpService = await connectionPool.getConnection(sessionId);
            // Use streaming version
            await mcpService.processQueryStream(query, sessionId, (chunk) => {
                socket.emit('query_stream', {
                    messageId,
                    chunk
                });
            });
        }
        catch (error) {
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
            const mcpService = await connectionPool.getConnection(sessionId);
            const context = await mcpService['contextManager'].getSession(sessionId);
            socket.emit('context_response', {
                messages: context?.messages || [],
                toolUsage: context?.toolUsageHistory || [],
                userPreferences: context?.userPreferences || {},
                activeEntities: context?.activeEntities || {}
            });
        }
        catch (error) {
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
            await connectionPool.releaseConnection(sessionId);
        }
    });
});
// REST API endpoints (alternative to WebSocket)
app.get('/api/status', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || randomUUID();
        const mcpService = await connectionPool.getConnection(sessionId);
        const status = mcpService.getConnectionStatus();
        res.json({
            ...status,
            autoConnectRetries: mcpService['autoConnectRetries'],
            maxAutoConnectRetries: mcpService['maxAutoConnectRetries'],
            poolStatus: connectionPool.getPoolStatus()
        });
    }
    catch (error) {
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to get status',
            poolStatus: connectionPool.getPoolStatus()
        });
    }
});
// Conversation API endpoints
app.get('/api/conversations', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        const conversations = await getConversations(userId);
        res.json({ conversations });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch conversations' });
    }
});
// Get a single conversation
app.get('/api/conversations/:sessionId', async (req, res) => {
    try {
        const userId = req.query.userId;
        const sessionId = req.params.sessionId;
        if (!userId || !sessionId) {
            return res.status(400).json({ error: 'Missing userId or sessionId' });
        }
        const conversation = await getConversation(userId, sessionId);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json({ conversation });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch conversation' });
    }
});
app.post('/api/conversations', async (req, res) => {
    try {
        const { userId, sessionId, messages, title } = req.body;
        if (!userId || !sessionId || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Missing userId, sessionId, or messages' });
        }
        await saveConversation(userId, sessionId, messages, title);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save conversation' });
    }
});
app.delete('/api/conversations', async (req, res) => {
    try {
        const { userId, sessionId } = req.body;
        if (!userId || !sessionId) {
            return res.status(400).json({ error: 'Missing userId or sessionId' });
        }
        await deleteConversation(userId, sessionId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete conversation' });
    }
});
// NEW: Update conversation title endpoint
app.put('/api/conversations/title', async (req, res) => {
    try {
        const { userId, sessionId, title } = req.body;
        if (!userId || !sessionId || !title) {
            return res.status(400).json({ error: 'Missing userId, sessionId, or title' });
        }
        await updateConversationTitle(userId, sessionId, title);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update conversation title' });
    }
});
// Keep manual connect endpoint for fallback/reconnection
app.post('/api/connect', async (req, res) => {
    try {
        const { serverPath, sessionId } = req.body;
        const tempSessionId = sessionId || randomUUID();
        const mcpService = await connectionPool.getConnection(tempSessionId);
        const result = await connectToServer(mcpService, serverPath);
        res.json({
            success: true,
            tools: result.tools,
            message: 'Manual connection successful',
            sessionId: tempSessionId
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Connection failed',
            poolStatus: connectionPool.getPoolStatus()
        });
    }
});
// Add health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || randomUUID();
        const mcpService = await connectionPool.getConnection(sessionId);
        const status = mcpService.getConnectionStatus();
        res.json({
            status: status.isConnected ? 'healthy' : 'unhealthy',
            connected: status.isConnected,
            tools: status.tools,
            autoConnectRetries: mcpService['autoConnectRetries'],
            poolStatus: connectionPool.getPoolStatus()
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Health check failed',
            poolStatus: connectionPool.getPoolStatus()
        });
    }
});
// NEW: Server-Sent Events endpoint for streaming
app.get('/api/query-stream', async (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.status(400).json({ error: 'Query parameter is required' });
    }
    // Set up SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });
    const tempSessionId = randomUUID();
    try {
        const mcpService = await connectionPool.getConnection(tempSessionId);
        await mcpService['contextManager'].createSession(tempSessionId, 'sse_user');
        await mcpService.processQueryStream(query, tempSessionId, (chunk) => {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });
    }
    catch (error) {
        res.write(`data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`);
    }
    finally {
        // Clean up the connection
        await connectionPool.releaseConnection(tempSessionId);
        res.end();
    }
});
// REPLACE with streaming version for /api/query
app.post('/api/query', async (req, res) => {
    const tempSessionId = randomUUID();
    try {
        const { query } = req.body;
        // Create a temporary session for REST API queries
        const mcpService = await connectionPool.getConnection(tempSessionId);
        await mcpService['contextManager'].createSession(tempSessionId, 'rest_api_user');
        let fullResponse = '';
        let errorOccurred = false;
        await mcpService.processQueryStream(query, tempSessionId, (chunk) => {
            if (chunk.type === 'text_delta') {
                fullResponse += chunk.delta;
            }
            else if (chunk.type === 'complete') {
                fullResponse += chunk.response || '';
            }
            else if (chunk.type === 'error') {
                errorOccurred = true;
                res.status(500).json({ success: false, error: chunk.error });
            }
        });
        if (!errorOccurred) {
            res.json({ success: true, response: fullResponse });
        }
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Query processing failed'
        });
    }
    finally {
        // Clean up the connection
        await connectionPool.releaseConnection(tempSessionId);
    }
});
// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    // Clean up all connections in the pool
    const poolStatus = connectionPool.getPoolStatus();
    console.log(`Cleaning up ${poolStatus.activeConnections} active connections...`);
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    // Clean up all connections in the pool
    const poolStatus = connectionPool.getPoolStatus();
    console.log(`Cleaning up ${poolStatus.activeConnections} active connections...`);
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
const PORT = parseInt(process.env.PORT || '8080', 10);
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 MCP Backend Service running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`🔗 REST API endpoint: http://localhost:${PORT}/api`);
    console.log(`⚡ Streaming support enabled for real-time responses`);
    console.log(`🎯 Optimized for token efficiency and performance`);
});
