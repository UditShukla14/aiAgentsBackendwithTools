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
import { SYSTEM_PROMPT, GREETING_PROMPT, SIMPLE_PROMPT, BUSINESS_PROMPT } from './resources/prompts.js';
import { greetings, dateKeywords, simplePatterns, businessKeywords, complexPatterns, allowedOrigins } from './resources/staticData.js';
// Utility to remove internal IDs from user-facing text
function filterInternalIds(text) {
    // Remove lines containing internal IDs (id, customer_id, product_id, invoice_id, etc.)
    return text.replace(/\b(id|customer_id|product_id|invoice_id|estimate_id|user_id|quickbook_customer_id|handshake_key|assign_employee_user_id)\b\s*[:=]\s*['"\d\w-]+,?/gi, '')
        .replace(/\b(id|customer_id|product_id|invoice_id|estimate_id|user_id|quickbook_customer_id|handshake_key|assign_employee_user_id)\b\s*[:=]\s*['"\d\w-]+/gi, '')
        .replace(/\n\s*\n/g, '\n') // Remove extra blank lines
        .replace(/\{\s*,/g, '{') // Remove leading commas in objects
        .replace(/,\s*\}/g, '}'); // Remove trailing commas in objects
}
// Utility to format address responses for end users
function formatAddressResponse(text) {
    // Remove [DISPLAY_VERBATIM]
    let cleaned = text.replace('[DISPLAY_VERBATIM]', '').trim();
    // If it looks like an address block, format it nicely
    if (/address[:]?/i.test(cleaned)) {
        // Try to split after 'Address:' or on the next line
        const match = cleaned.match(/(.*Address:?)([\s\S]*)/i);
        if (match) {
            const label = match[1].trim();
            let address = match[2].trim();
            // If address is empty, try to get the next line
            if (!address && cleaned.includes('\n')) {
                address = cleaned.split('\n').slice(1).join('\n').trim();
            }
            // Split address by commas, trim, and join as lines
            const lines = address.split(',').map(line => line.trim()).filter(Boolean);
            return `${label}\n${lines.join('\n')}`;
        }
    }
    return cleaned;
}
dotenv.config();
// Add MCP server path configuration
// Resolve __dirname in ES module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Dynamically resolve MCP server path for dev/prod
const MCP_SERVER_PATH = process.env.MCP_SERVER_PATH || (process.env.NODE_ENV === 'production'
    ? path.resolve(__dirname, '../../mcp-server/dist/mcp-server.js')
    : path.resolve(__dirname, '../../mcp-server/mcp-server.ts'));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
}
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
app.use(express.json());
// Add rate limiting status endpoint
app.get('/api/rate-limit-status', (req, res) => {
    const status = globalRateLimiter.getStatus();
    res.json({
        rateLimit: status,
        message: `Current API usage: ${status.currentRequests}/${status.maxRequests} requests per ${status.timeWindow / 1000}s window`,
        queueLength: status.queueLength
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
    constructor() {
        this.anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY,
        });
        this.mcp = new Client({ name: "mcp-client-web", version: "1.0.0" });
        this.contextManager = new ContextManager();
        // Start auto-connection process
        this.initializeAutoConnect();
    }
    // Smart query classification for token optimization
    classifyQuery(query) {
        const lowerQuery = query.toLowerCase().trim();
        // 1. Business queries that need tools (check first!)
        if (businessKeywords.some(keyword => lowerQuery.includes(keyword))) {
            return 'business';
        }
        // 2. Date-related queries
        if (dateKeywords.some(keyword => lowerQuery.includes(keyword))) {
            return 'business';
        }
        // 3. Complex analysis (multiple steps, comparisons, reports)
        if (complexPatterns.some(pattern => lowerQuery.includes(pattern)) || lowerQuery.length > 150) {
            return 'complex';
        }
        // 4. Simple questions and help requests (but not date/business/complex)
        if (simplePatterns.some(pattern => lowerQuery.includes(pattern)) && lowerQuery.length < 100) {
            return 'simple';
        }
        // 5. Greetings and social interactions (require full match or near-exact match)
        if (greetings.some(greeting => lowerQuery === greeting || lowerQuery.startsWith(greeting + ' ') || lowerQuery.endsWith(' ' + greeting))) {
            return 'greeting';
        }
        return 'simple';
    }
    // Dynamic system prompts for different query types
    getSystemPrompt(queryType) {
        switch (queryType) {
            case 'greeting':
                return GREETING_PROMPT;
            case 'simple':
                return SIMPLE_PROMPT;
            case 'business':
                return BUSINESS_PROMPT;
            case 'complex':
                return SYSTEM_PROMPT; // Full prompt for complex tasks
            default:
                return SYSTEM_PROMPT;
        }
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
                const keywords = ['delivery', 'delivery board', 'delivery schedule', 'delivery tracking', 'delivery planning', 'delivery logistics', 'delivery daily', 'delivery weekly', 'delivery monthly', 'delivery yearly', 'delivery board', 'delivery schedule', 'delivery tracking', 'delivery planning', 'delivery logistics', 'delivery daily', 'delivery weekly', 'delivery monthly', 'delivery yearly', 'deliveries'];
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
    // Calculate max tokens based on query type
    getMaxTokens(queryType) {
        switch (queryType) {
            case 'greeting': return 100;
            case 'simple': return 300;
            case 'business': return 1500;
            case 'complex': return 2000;
            default: return 2000;
        }
    }
    async initializeAutoConnect() {
        try {
            const serverPath = MCP_SERVER_PATH;
            console.log('🔄 Attempting auto-connection to MCP server at:', serverPath);
            // Check if file exists before attempting connection
            try {
                await import(serverPath);
            }
            catch (error) {
                throw new Error(`MCP server file not found at ${serverPath}. Please ensure the file exists and the path is correct.`);
            }
            await this.connectToServer(serverPath);
            console.log('✅ Successfully auto-connected to MCP server');
            this.autoConnectRetries = 0;
        }
        catch (error) {
            this.autoConnectRetries++;
            console.error(`❌ Auto-connection attempt ${this.autoConnectRetries} failed:`, error);
            if (this.autoConnectRetries < this.maxAutoConnectRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, this.autoConnectRetries), 10000);
                console.log(`🔄 Retrying auto-connection in ${backoffMs / 1000} seconds...`);
                setTimeout(() => this.initializeAutoConnect(), backoffMs);
            }
            else {
                console.error('❌ Max auto-connection retries exceeded. Manual connection will be required.');
            }
        }
    }
    async connectToServer(serverScriptPath) {
        try {
            const isJs = serverScriptPath.endsWith(".js");
            const isPy = serverScriptPath.endsWith(".py");
            const isTs = serverScriptPath.endsWith(".ts");
            if (!isJs && !isPy && !isTs) {
                throw new Error("Server script must be a .js, .ts, or .py file");
            }
            let command;
            let args;
            if (isPy) {
                command = process.platform === "win32" ? "python" : "python3";
                args = [serverScriptPath];
            }
            else if (isTs) {
                command = "npx";
                args = ["tsx", serverScriptPath];
            }
            else {
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
            console.log("Connected to MCP server with tools:", this.tools.map(({ name }) => name).join(", "));
            return {
                success: true,
                tools: this.tools.map(({ name, description }) => ({ name, description }))
            };
        }
        catch (e) {
            console.error("Failed to connect to MCP server:", e);
            throw e;
        }
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
                contextInfo += `\n- Active customer: ${activeEntities.customerName}`;
            }
            if (activeEntities.productName) {
                contextInfo += `\n- Active product: ${activeEntities.productName}`;
            }
        }
        // Get optimized system prompt and tools
        const systemPrompt = this.getSystemPrompt(queryType);
        const relevantTools = this.getRelevantTools(queryType, query);
        const maxTokens = this.getMaxTokens(queryType);
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
                model: "claude-3-5-sonnet-20241022",
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
            let result = await this.contextManager.getCachedResult(toolName, originalArgs || {});
            if (!result || toolName === 'date-utility') { // Skip cache for date-utility
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
                    const cacheTime = toolName.includes('search') ? 300 :
                        toolName === 'date-utility' ? 0 : 3600; // Don't cache date-utility
                    if (cacheTime > 0) {
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
            // After getting the result for a customer search tool, set last customer context
            if ((toolName === 'findCustomerByName' || toolName === 'searchCustomerList') && result && result.content && result.content[0] && result.content[0].text) {
                const rawText = result.content[0].text;
                console.log('[DEBUG] Raw tool result text:', rawText);
                let data = null;
                try {
                    // Try to extract JSON object from the string
                    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        data = JSON.parse(jsonMatch[0]);
                        console.log('[DEBUG] Extracted and parsed JSON:', data);
                    }
                    else {
                        console.log('[DEBUG] No JSON object found in tool result text');
                    }
                    if (data) {
                        // Use data.result if present
                        const dataForSummary = data.result || data;
                        const customerName = dataForSummary.customer_name || dataForSummary.name || '';
                        if (customerName) {
                            // Set the address confirmation flag in context
                            const sessionContext = await this.contextManager.getSession(sessionId);
                            if (sessionContext) {
                                sessionContext.activeEntities.customerId = dataForSummary.id?.toString() || dataForSummary.customer_id?.toString();
                                sessionContext.activeEntities.customerName = customerName;
                                sessionContext.activeEntities.awaitingAddressConfirmation = true;
                                sessionContext.activeEntities.awaitingAddressCustomerId = sessionContext.activeEntities.customerId;
                                await this.contextManager.saveContext(sessionId, sessionContext);
                                console.log('[DEBUG] Setting address confirmation flag for customerId:', sessionContext.activeEntities.customerId);
                                console.log('[DEBUG] After customer search, activeEntities:', JSON.stringify(sessionContext.activeEntities, null, 2));
                            }
                            // Build a customer summary (customize as needed)
                            const summary = [
                                `Customer: ${customerName}`,
                                dataForSummary.email ? `Email: ${dataForSummary.email}` : null,
                                dataForSummary.phone ? `Phone: ${dataForSummary.phone}` : null,
                                dataForSummary.type_of_customer ? `Type: ${dataForSummary.type_of_customer}` : null,
                                dataForSummary.status_name ? `Status: ${dataForSummary.status_name}` : null
                            ].filter(Boolean).join('\n');
                            // Combine summary and prompt
                            const addressPrompt = 'Would you like to see this customer’s address? (yes/no)';
                            const combinedMessage = `${summary}\n\n${addressPrompt}`;
                            // DEBUG LOGGING
                            console.log('[DEBUG] ===== CUSTOMER SEARCH RESPONSE =====');
                            console.log('[DEBUG] Summary:', summary);
                            console.log('[DEBUG] Address prompt:', addressPrompt);
                            console.log('[DEBUG] Combined message:', combinedMessage);
                            console.log('[DEBUG] Combined message length:', combinedMessage.length);
                            console.log('[DEBUG] ======================================');
                            // Send both together
                            await this.contextManager.addMessage(sessionId, 'assistant', combinedMessage);
                            onChunk({
                                type: 'complete',
                                response: combinedMessage,
                                toolsUsed: [toolName],
                                queryType: 'business',
                                tokensOptimized: true
                            });
                            return;
                        }
                    }
                }
                catch (e) {
                    console.log('[DEBUG] Failed to parse extracted JSON:', e);
                }
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
                    model: "claude-3-5-sonnet-20241022",
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
                    await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(streamedContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim(), toolUsageLog.length > 0 ? toolUsageLog.map(t => t.name) : undefined);
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
    // ORIGINAL: Non-streaming version (kept for compatibility)
    async processQuery(query, sessionId) {
        if (!this.isConnected) {
            throw new Error("Not connected to MCP server");
        }
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
                contextInfo += `\n- Active customer: ${activeEntities.customerName}`;
            }
            if (activeEntities.productName) {
                contextInfo += `\n- Active product: ${activeEntities.productName}`;
            }
        }
        // Get optimized system prompt and tools
        const systemPrompt = this.getSystemPrompt(queryType);
        const relevantTools = this.getRelevantTools(queryType, query);
        const maxTokens = this.getMaxTokens(queryType);
        // Build dynamic context string
        const activeEntities = toolContext?.activeEntities;
        const dynamicContext = activeEntities && activeEntities.customerName
            ? `The customer "${activeEntities.customerName}" was found via a secure business tool. It is authorized to display their business address.`
            : '';
        const contextualSystemPrompt = systemPrompt.replace('[CONTEXT_PLACEHOLDER]', dynamicContext);
        // Token optimization logging
        console.log(`📊 Token optimization applied:
- Query type: ${queryType}
- System prompt: ${systemPrompt.length} chars (vs ${SYSTEM_PROMPT.length} full)
- Tools included: ${relevantTools.length}/${this.tools.length}
- Context info: ${contextInfo.length} chars
- Max tokens: ${maxTokens}`);
        const messages = [
            {
                role: "user",
                content: query,
            },
        ];
        try {
            const response = await globalRateLimiter.execute(() => RetryManager.retryWithExponentialBackoff(() => this.anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: maxTokens,
                system: contextualSystemPrompt,
                messages,
                tools: relevantTools,
            })));
            // For greetings and simple queries, return immediately (no tool processing needed)
            if (queryType === 'greeting' || queryType === 'simple') {
                const textContent = response.content
                    .filter((content) => content.type === "text")
                    .map((content) => content.text)
                    .join("\n");
                await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(textContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim());
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
            const toolUsageLog = [];
            while (true) {
                const toolUseBlocks = currentResponse.content.filter((content) => content.type === "tool_use");
                if (toolUseBlocks.length === 0) {
                    // No more tool calls, return the final text response
                    const textContent = currentResponse.content
                        .filter((content) => content.type === "text")
                        .map((content) => content.text)
                        .join("\n");
                    // Add assistant response to context (with automatic compression)
                    const toolNames = toolUsageLog.map(t => t.name);
                    await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(textContent || "No response generated.").replace('[DISPLAY_VERBATIM]', '').trim(), toolNames.length > 0 ? toolNames : undefined);
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
                const toolResults = [];
                for (const toolUse of toolUseBlocks) {
                    const toolName = toolUse.name;
                    const originalArgs = toolUse.input;
                    // Check cache first using the optimized caching system
                    let result = await this.contextManager.getCachedResult(toolName, originalArgs || {});
                    if (!result || toolName === 'date-utility') { // Skip cache for date-utility
                        // Enhance tool arguments with context using the new optimized method
                        const enhancedArgs = await this.contextManager.enhanceToolArguments(sessionId, toolName, originalArgs || {}, query);
                        console.log(`🧠 Context: Tool ${toolName} enhanced arguments:`, JSON.stringify(enhancedArgs, null, 2));
                        toolUsageLog.push({ name: toolName, args: enhancedArgs });
                        try {
                            result = await this.mcp.callTool({
                                name: toolName,
                                arguments: enhancedArgs,
                            });
                            console.log("Tool result:", JSON.stringify(result, null, 2));
                            // Cache the result using optimized caching (search results cache for 5 min, data for 1 hour)
                            const cacheTime = toolName.includes('search') ? 300 :
                                toolName === 'date-utility' ? 0 : 3600; // Don't cache date-utility
                            if (cacheTime > 0) {
                                await this.contextManager.cacheToolResult(toolName, originalArgs || {}, result, cacheTime);
                            }
                            // Record tool usage in context with automatic compression and summarization
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
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
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
                const hasVerbatimFlag = toolResults.some(result => result.content.some((content) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]")));
                // For verbatim content, bypass Claude and return directly
                if (hasVerbatimFlag) {
                    const verbatimContent = toolResults
                        .flatMap(result => result.content)
                        .filter((content) => content.type === "text" && content.text.includes("[DISPLAY_VERBATIM]"))
                        .map((content) => content.text.replace("[DISPLAY_VERBATIM] ", ""))
                        .join("\n\n");
                    // Add assistant response to context with compression
                    const toolNames = toolUsageLog.map(t => t.name);
                    await this.contextManager.addMessage(sessionId, 'assistant', filterInternalIds(verbatimContent).replace('[DISPLAY_VERBATIM]', '').trim(), toolNames.length > 0 ? toolNames : undefined);
                    return {
                        response: verbatimContent,
                        toolsUsed: toolUsageLog,
                        queryType,
                        tokensOptimized: true
                    };
                }
                // Get Claude's response to the tool results
                currentResponse = await globalRateLimiter.execute(() => RetryManager.retryWithExponentialBackoff(() => this.anthropic.messages.create({
                    model: "claude-3-5-sonnet-20241022",
                    max_tokens: maxTokens,
                    system: contextualSystemPrompt,
                    messages: currentMessages,
                    tools: relevantTools,
                })));
            }
        }
        catch (error) {
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
// Create MCP service instance
const mcpService = new MCPBackendService();
// Store session mappings for socket connections
const socketToSession = new Map();
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
    // KEEP: Original non-streaming handler for backward compatibility
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
    }
    catch (error) {
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
    await mcpService['contextManager'].createSession(tempSessionId, 'sse_user');
    try {
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
    res.end();
});
// KEEP: Original non-streaming query endpoint
app.post('/api/query', async (req, res) => {
    try {
        const { query } = req.body;
        // Create a temporary session for REST API queries
        const tempSessionId = randomUUID();
        await mcpService['contextManager'].createSession(tempSessionId, 'rest_api_user');
        const result = await mcpService.processQuery(query, tempSessionId);
        res.json({ success: true, ...result });
    }
    catch (error) {
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
    console.log(`⚡ Streaming support enabled for real-time responses`);
    console.log(`🎯 Optimized for token efficiency and performance`);
});
