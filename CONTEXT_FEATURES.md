# 🧠 Context-Aware Features Demo

This document demonstrates the new Redis-powered context-aware capabilities of your MCP React Client.

## 🚀 Getting Started

1. **Ensure Redis is running**: `redis-cli ping` should return `PONG`
2. **Start the backend**: `cd backend && npm run dev`
3. **Start the frontend**: `cd frontend && npm run dev`
4. **Open**: http://localhost:5173

## 🧪 Demo Scenarios

### 1. **Conversation Memory**
Test how the AI remembers previous interactions:

```
You: "Search for products with 'laptop' in the name"
AI: [Shows laptop products]

You: "Show me more details about the first one"
AI: [Automatically knows which product you mean from context]

You: "What was that product I looked at earlier?"
AI: [References the laptop from your previous query]
```

### 2. **Intent Recognition**
Watch how the AI detects your goals:

```
You: "I need to find a customer"
AI: [Recognizes customer_management intent, suggests search tools]

You: "Show me recent invoices"
AI: [Recognizes billing_inquiry intent, may auto-apply date filters]

You: "Calculate the total for my order"
AI: [Recognizes calculation intent, prepares math tools]
```

### 3. **Smart Date Inference**
Try these natural language date queries:

```
You: "Show me invoices from this week"
AI: [Automatically calculates current week's date range]

You: "What about estimates from this month?"
AI: [Applies current month filter automatically]

You: "Any customers added today?"
AI: [Uses today's date range]
```

### 4. **Cross-Tool Context**
See how tools share information:

```
You: "Find customer John Smith"
AI: [Searches customers, remembers John's ID]

You: "Show me his invoices"
AI: [Uses John's customer ID from previous context]

You: "Any estimates for him too?"
AI: [Continues using John's context]
```

### 5. **Smart Caching**
Notice faster responses for repeated queries:

```
You: "Search for products containing 'phone'"
AI: [First time - calls API, caches result]

You: "Search for products containing 'phone'" (again)
AI: [Second time - uses cached result, much faster]
```

### 6. **Usage Patterns**
The AI learns from your behavior:

```
After several product searches:
You: "Find something for me"
AI: [More likely to suggest product search based on your patterns]

After multiple customer queries:
You: "Help me with business data"
AI: [Prioritizes customer-related suggestions]
```

## 🔍 Technical Features Being Demonstrated

### Session Management
- Each browser session gets a unique ID
- Conversations persist for 24 hours
- Cross-tab sessions are isolated

### Context Storage
- **Messages**: Last 50 messages per session
- **Tool Usage**: Last 20 tool calls with results
- **User Preferences**: Learned patterns and settings
- **Cache**: Smart caching with TTL (5min search, 1hr data)

### Intent Detection
The AI recognizes these intents:
- `product_inquiry` - Product searches and details
- `customer_management` - Customer operations
- `billing_inquiry` - Invoice and payment queries
- `estimation` - Quote and estimate work
- `calculation` - Math and computation
- `analysis` - Text and data analysis
- `general_inquiry` - Everything else

### Context Enhancement
Tools receive enhanced arguments with:
- Recent search terms
- User intent classification
- Previous tool results
- Inferred date ranges
- Related data from recent activities

## 🛠️ Redis Data Structure

You can inspect the Redis data while testing:

```bash
# See all sessions
redis-cli KEYS "session:*"

# View a specific session
redis-cli GET "session:your-session-id"

# Check cache entries
redis-cli KEYS "cache:*"

# View tool usage patterns
redis-cli KEYS "patterns:*"
```

## 🧪 Testing Context Features

### Test 1: Memory Persistence
1. Ask: "Search for customer 'Tech Corp'"
2. Wait a moment
3. Ask: "What was that company I just searched for?"
4. ✅ Should remember "Tech Corp"

### Test 2: Tool Context Sharing
1. Ask: "Find customer 'Alice Johnson'"
2. Ask: "Show me her invoices"
3. ✅ Should use Alice's customer ID automatically

### Test 3: Date Intelligence
1. Ask: "Show me this week's estimates"
2. Check the tool arguments in browser console
3. ✅ Should see auto-calculated date range

### Test 4: Caching
1. Ask: "Search for products with 'device'"
2. Note the response time
3. Ask the same question again
4. ✅ Second request should be much faster

### Test 5: Intent Recognition
1. Ask: "I need to calculate something"
2. ✅ Should recognize `calculation` intent
3. Ask: "Find me a customer"
4. ✅ Should recognize `customer_management` intent

## 🎯 Expected Improvements

With context awareness, you should notice:

- **Faster Interactions**: Cached results and smart defaults
- **Natural Conversations**: "Show me more like that" works
- **Proactive Suggestions**: AI suggests next logical steps
- **Reduced Repetition**: No need to re-specify previous context
- **Smarter Tool Usage**: Better parameter inference
- **Pattern Learning**: Personalized experience over time

## 🔧 Troubleshooting

**Context not working?**
- Check Redis: `redis-cli ping`
- Check backend logs for Redis connection
- Verify .env has REDIS_HOST and REDIS_PORT

**Responses not cached?**
- Check Redis keys: `redis-cli KEYS "cache:*"`
- Verify TTL: `redis-cli TTL "cache:toolname:hash"`

**Sessions not persisting?**
- Check browser network tab for session ID
- Verify Redis session storage: `redis-cli KEYS "session:*"`

Enjoy exploring your new context-aware MCP application! 🚀 