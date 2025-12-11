# Complete System Flow Analysis

## Overview
This document provides a comprehensive analysis of the complete data flow from user query → tool execution → AI processing → frontend display.

---

## Architecture Components

### 1. **Frontend** (React)
- Sends queries via WebSocket (`process_query_stream`)
- Receives streaming chunks via `query_stream` events
- Renders formatted content (tables, cards, charts)

### 2. **Backend Server** (`backend/src/server.ts`)
- Handles WebSocket connections
- Manages MCP client connections
- Processes queries with streaming
- Routes tool results to AI or directly to frontend

### 3. **Context Manager** (`backend/src/context-manager.ts`)
- Manages conversation context
- Extracts active entities (customerId, customerName, etc.)
- Caches tool results
- Records tool usage history

### 4. **MCP Server** (`mcp-server/tools.ts`)
- Defines 19 business tools
- Executes API calls to InvoiceMakerPro
- Returns structured data

### 5. **AI Model** (Anthropic Claude)
- Processes user queries
- Decides which tools to call
- Formats responses based on system prompt

---

## Complete Flow Diagram

```
┌─────────────┐
│   User      │
│  Query      │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Frontend (React)                   │
│  - Emits: process_query_stream      │
│  - Listens: query_stream            │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Backend Server (server.ts)         │
│  - Socket handler                   │
│  - processQueryStream()             │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  AI Model (Claude)                  │
│  - Analyzes query                    │
│  - Decides tools to call             │
│  - System prompt guides behavior     │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Tool Execution                     │
│  - MCP Client calls tool            │
│  - Tool executes API call            │
│  - Returns structured data          │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Context Manager                    │
│  - Records tool usage               │
│  - Updates activeEntities           │
│  - Caches results                   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Response Routing                   │
│  ┌──────────────────────────────┐   │
│  │ Path 1: Direct Pass-Through │   │
│  │ (has <table>/<card> tags)   │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ Path 2: AI Formatting        │   │
│  │ (raw JSON, needs formatting) │   │
│  └──────────────────────────────┘   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Streaming to Frontend              │
│  - text_delta chunks                │
│  - tool_result chunks               │
│  - complete event                   │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Frontend Rendering                 │
│  - Parses <table> tags              │
│  - Renders interactive tables       │
│  - Displays formatted content       │
└─────────────────────────────────────┘
```

---

## Detailed Flow Breakdown

### Phase 1: Query Reception

**Location**: `backend/src/server.ts` (lines 1438-1474)

```typescript
socket.on('process_query_stream', async (data) => {
  const { query, messageId } = data;
  const sessionId = socketToSession.get(socket.id);
  
  // Get MCP service connection
  const mcpService = await connectionPool.getConnection(sessionId);
  
  // Process query with streaming
  await mcpService.processQueryStream(query, sessionId, (chunk) => {
    socket.emit('query_stream', { messageId, chunk });
  });
});
```

**What happens**:
1. Frontend sends query via WebSocket
2. Backend retrieves session and MCP connection
3. Calls `processQueryStream()` with callback for chunks

---

### Phase 2: AI Query Analysis

**Location**: `backend/src/server.ts` → `processQueryStream()`

**Process**:
1. AI receives user query + system prompt
2. System prompt instructs AI to:
   - Call appropriate tools
   - Output tool responses EXACTLY
   - NOT add summaries or commentary
3. AI decides which tools to call
4. AI generates tool call requests

**System Prompt Key Instructions** (`backend/src/resources/prompts.ts`):
- "Tool Output = Your Output, NOTHING MORE, NOTHING LESS"
- "DO NOT describe, summarize, or rewrite data"
- "Output tool response CHARACTER FOR CHARACTER"
- Forbidden phrases: "The above", "shows", "includes", "as requested", etc.

---

### Phase 3: Tool Execution

**Location**: `backend/src/server.ts` → `processToolCallsWithStreaming()` (lines 554-821)

**For each tool call**:

```typescript
// 1. Check cache
result = await this.contextManager.getCachedResult(toolName, args);

// 2. If not cached, execute tool
if (!result) {
  // Enhance arguments with context
  const enhancedArgs = await this.contextManager.enhanceToolArguments(...);
  
  // Call MCP tool
  result = await this.mcp.callTool({
    name: toolName,
    arguments: enhancedArgs,
  });
  
  // Cache result
  await this.contextManager.cacheToolResult(...);
}

// 3. Record tool usage (updates activeEntities)
await this.contextManager.recordToolUsage(sessionId, toolName, args, result);

// 4. Send tool result to frontend
onChunk({
  type: 'tool_result',
  tool: toolName,
  result: result.content,
  cached: !!result.cached
});
```

**Special Cases**:
- `analyzeBusinessData`: Returns early with chart data
- `date-utility`: Not cached (always fresh)
- Search tools: Cached for 5 minutes
- Other tools: Cached for 1 hour

---

### Phase 4: Context Extraction

**Location**: `backend/src/context-manager.ts` → `updateActiveEntities()` (lines 323-460)

**For customer tools** (`findCustomerByName`, `searchCustomerList`):

```typescript
// Extract JSON from tool response
const content = result.content?.[0]?.text;
const data = JSON.parse(content.match(/\{[\s\S]*\}/)[0]);

// Check for data.result structure (from findCustomerByName)
if (data.result) {
  const resultData = data.result;
  if (Array.isArray(resultData)) {
    // Multiple customers - take latest
    const latest = resultData[resultData.length - 1];
    context.activeEntities.customerId = latest.id?.toString();
    context.activeEntities.customerName = latest.customer_name || latest.name;
  } else {
    // Single customer
    context.activeEntities.customerId = resultData.id?.toString();
    context.activeEntities.customerName = resultData.customer_name || resultData.name;
  }
} else {
  // Direct properties (fallback)
  context.activeEntities.customerId = data.id?.toString();
  context.activeEntities.customerName = data.name || data.customer_name;
}
```

**What gets extracted**:
- `customerId`: For future queries
- `customerName`: For display/context
- `productId`: From product searches
- Other entity IDs as needed

**Special handling**:
- After customer search, sets `awaitingAddressConfirmation = true`
- This triggers frontend to ask for address confirmation

---

### Phase 5: Response Routing

**Location**: `backend/src/server.ts` → `processToolCallsWithStreaming()` (lines 706-808)

**Three possible paths**:

#### Path 1: Direct Pass-Through (Formatted Content)
**Condition**: Tool result contains `<table>`, `<card>`, `<chart>`, or `<text>` tags

```typescript
if (hasFormattedContent) {
  // Extract formatted content
  const formattedContent = toolResults
    .flatMap(result => result.content)
    .filter(content => content.text.includes('<table>') || ...)
    .map(content => content.text)
    .join("\n\n");
  
  // Stream directly to frontend (bypass AI)
  onChunk({
    type: 'text_delta',
    delta: line + '\n',
    accumulated: accumulated.trim(),
    isFormatted: true
  });
  
  // Mark as complete, skip Claude response
  onChunk({
    type: 'complete',
    response: formattedContent,
    skipClaudeResponse: true
  });
  return; // Exit early
}
```

**Why**: Tools like `searchProductList`, `searchInvoiceList` already format data as tables. No need for AI to reformat.

#### Path 2: Verbatim Display
**Condition**: Tool result contains `[DISPLAY_VERBATIM]` flag

```typescript
if (hasVerbatimFlag) {
  // Extract verbatim content
  const verbatimContent = toolResults
    .flatMap(result => result.content)
    .filter(content => content.text.includes("[DISPLAY_VERBATIM]"))
    .map(content => content.text.replace("[DISPLAY_VERBATIM] ", ""))
    .join("\n\n");
  
  // Stream directly (bypass AI)
  // ... similar to Path 1
  return;
}
```

**Why**: Some tools want exact output without AI interpretation.

#### Path 3: AI Formatting (Default)
**Condition**: Raw JSON data, no special tags

```typescript
// Add tool results to conversation
currentMessages.push({
  role: "user",
  content: toolResults,
});

// Continue conversation - AI formats the response
await this.continueStreamingConversation(...);
```

**Why**: Tools like `findCustomerByName` return raw JSON. AI formats it based on system prompt.

---

### Phase 6: AI Response Generation

**Location**: `backend/src/server.ts` → `continueStreamingConversation()` (lines 824-1148)

**Process**:

```typescript
while (true) {
  // 1. Get AI streaming response
  const response = await this.anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    system: systemPrompt,
    messages: currentMessages, // Includes tool results
    tools: relevantTools,
    stream: true,
  });
  
  // 2. Stream response chunks
  for await (const chunk of response) {
    if (chunk.type === 'content_block_delta') {
      if (chunk.delta.type === 'text_delta') {
        streamedContent += chunk.delta.text;
        onChunk({
          type: 'text_delta',
          delta: chunk.delta.text,
          accumulated: streamedContent
        });
      }
    }
  }
  
  // 3. Check for new tool calls
  if (newToolCalls.length > 0) {
    // Recursively process new tool calls
    await this.processToolCallsWithStreaming(...);
    continue; // Loop back for AI response
  }
  
  // 4. No more tool calls - done
  break;
}
```

**Key Points**:
- Iterative: AI can call tools, get results, call more tools, etc.
- Streaming: Response chunks sent as they're generated
- System prompt ensures AI outputs tool data exactly

---

### Phase 7: Frontend Rendering

**Location**: Frontend React components (not in this repo, but inferred)

**Process**:

```typescript
// Frontend receives chunks
socket.on('query_stream', ({ messageId, chunk }) => {
  switch (chunk.type) {
    case 'tool_executing':
      // Show "Executing tool X..."
      break;
      
    case 'tool_result':
      // Show tool result (optional preview)
      break;
      
    case 'text_delta':
      // Append text to response
      setResponse(prev => prev + chunk.delta);
      break;
      
    case 'complete':
      // Final response received
      // Parse <table>, <card>, <chart> tags
      parseAndRender(chunk.response);
      break;
  }
});
```

**Rendering Logic**:
- `<table>[JSON array]</table>` → Interactive table component
- `<card>{JSON object}</card>` → Card component
- `<chart name="...">{Chart.js config}</chart>` → Chart component
- Plain text → Markdown renderer

---

## Key Design Decisions

### 1. **Why Two Response Paths?**

**Direct Pass-Through** (Path 1):
- **When**: Tools already format data (`searchProductList`, `searchInvoiceList`)
- **Why**: Faster, no AI overhead, consistent formatting
- **Trade-off**: Less flexibility

**AI Formatting** (Path 3):
- **When**: Tools return raw JSON (`findCustomerByName`)
- **Why**: AI can format based on context, user intent
- **Trade-off**: Slower, requires AI call

### 2. **Why Extract activeEntities?**

**Purpose**: 
- Remember context across queries
- "Show me their invoices" → uses remembered `customerId`
- "What's their address?" → uses remembered `customerId`

**Extraction Points**:
- After customer search → `customerId`, `customerName`
- After product search → `productId`
- After invoice/estimate search → Can extract IDs if needed

### 3. **Why Cache Tool Results?**

**Benefits**:
- Faster responses for repeated queries
- Reduced API calls to InvoiceMakerPro
- Better rate limiting

**Cache Strategy**:
- Search tools: 5 minutes (data changes frequently)
- Detail tools: 1 hour (less likely to change)
- Date utility: No cache (always needs fresh calculation)
- Analytics: No cache (complex, always fresh)

### 4. **Why System Prompt is So Strict?**

**Problem**: AI was adding summaries like "The above response contains..." instead of just outputting data.

**Solution**: Extremely explicit instructions:
- "Tool Output = Your Output"
- List of forbidden phrases
- Examples of correct vs wrong output
- Multiple reminders throughout prompt

**Result**: AI now passes through tool responses exactly.

---

## Data Flow Example: Customer Search

### User Query
```
"search for customer Reliable Leak Detection LLC"
```

### Step-by-Step Flow

1. **Frontend** → Backend
   ```
   socket.emit('process_query_stream', {
     query: "search for customer Reliable Leak Detection LLC",
     messageId: "msg-123"
   });
   ```

2. **Backend** → AI
   ```
   System Prompt: "Output tool responses exactly..."
   User Query: "search for customer Reliable Leak Detection LLC"
   ```

3. **AI** → Tool Call
   ```json
   {
     "type": "tool_use",
     "name": "findCustomerByName",
     "input": {
       "customer_name": "Reliable Leak Detection LLC"
     }
   }
   ```

4. **Backend** → MCP Tool
   ```typescript
   result = await mcp.callTool({
     name: "findCustomerByName",
     arguments: { customer_name: "Reliable Leak Detection LLC" }
   });
   ```

5. **MCP Tool** → API Call
   ```typescript
   // In tools.ts
   const searchData = await callIMPApi("/api/customer_list", {
     search: "Reliable Leak Detection LLC",
     take: 50
   });
   ```

6. **Tool** → Response
   ```json
   {
     "content": [{
       "type": "text",
       "text": "{\"result\":{\"id\":600007212,\"customer_id\":600007212,\"name\":\"Reliable Leak Detection LLC\",...}}"
     }]
   }
   ```

7. **Context Manager** → Extract Entities
   ```typescript
   // updateActiveEntities()
   data = JSON.parse(content); // { result: { id: 600007212, ... } }
   context.activeEntities.customerId = "600007212";
   context.activeEntities.customerName = "Reliable Leak Detection LLC";
   ```

8. **Backend** → Route Response
   ```typescript
   // No <table> tags, so goes to AI formatting path
   currentMessages.push({
     role: "user",
     content: toolResults // Contains raw JSON
   });
   ```

9. **AI** → Format Response
   ```
   System Prompt: "Output tool response exactly..."
   Tool Result: {"result":{"id":600007212,"name":"Reliable Leak Detection LLC",...}}
   
   AI Output: (formats JSON nicely, or passes through)
   ```

10. **Backend** → Frontend (Streaming)
    ```typescript
    onChunk({
      type: 'text_delta',
      delta: '{\n  "result": {\n    "id": 600007212,\n    ...',
      accumulated: '...'
    });
    
    onChunk({
      type: 'complete',
      response: '...',
      toolsUsed: ['findCustomerByName']
    });
    ```

11. **Frontend** → Render
    ```typescript
    // Receives complete response
    // Parses JSON
    // Displays customer details
    // Updates UI state
    ```

---

## Issues & Solutions

### Issue 1: Customer Data Not Extracted
**Problem**: `updateActiveEntities` was checking `data.id` before `data.result.id`

**Solution**: Check `data.result` first, then fallback to direct properties

### Issue 2: Generic Response Instead of Data
**Problem**: AI was summarizing instead of showing data

**Solution**: 
- Simplified tool response (removed pre-formatting)
- System prompt already instructs exact output
- Trust AI to format based on prompt

### Issue 3: Response Routing Confusion
**Problem**: When to bypass AI vs when to use AI?

**Solution**:
- Tools with `<table>` tags → Direct pass-through
- Tools with `[DISPLAY_VERBATIM]` → Direct pass-through  
- Raw JSON → AI formatting (default)

---

## Optimization Opportunities

1. **Frontend Caching**: Cache tool results on frontend for instant re-display
2. **Progressive Rendering**: Show partial results as they stream
3. **Smart Caching**: Cache based on query similarity, not just exact match
4. **Batch Tool Calls**: Call multiple tools in parallel when possible
5. **Response Compression**: Compress large tool responses before streaming

---

## Key Files Reference

| File | Purpose | Key Functions |
|------|---------|---------------|
| `backend/src/server.ts` | Main server, query processing | `processQueryStream()`, `processToolCallsWithStreaming()` |
| `backend/src/context-manager.ts` | Context management | `updateActiveEntities()`, `recordToolUsage()` |
| `backend/src/resources/prompts.ts` | System prompts | `getSystemPrompt()` |
| `mcp-server/tools.ts` | Tool definitions | `registerBusinessTools()`, `findCustomerByName()` |

---

## Conclusion

The system uses a **hybrid approach**:
- **Direct pass-through** for pre-formatted data (faster, consistent)
- **AI formatting** for raw data (flexible, contextual)
- **Context extraction** for remembering entities across queries
- **Streaming** for real-time user feedback

The key insight: **Tools return data, AI formats presentation, Frontend renders UI**. Each layer has a clear responsibility.
