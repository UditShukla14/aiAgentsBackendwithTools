import Redis from 'ioredis';

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolsUsed?: string[];
  summary?: string; // For compressed older messages
}

interface ToolUsageRecord {
  toolName: string;
  args: any;
  resultSummary?: string; // Store summary instead of full result
  resultIds?: string[]; // Store only IDs from results
  timestamp: number;
}

interface ConversationContext {
  sessionId: string;
  userId: string;
  messages: ConversationMessage[];
  toolUsageHistory: ToolUsageRecord[];
  activeEntities: {
    customerId?: string;
    customerName?: string;
    productId?: string;
    productName?: string;
    lastUpdated: number;
    // Add these for address confirmation flow
    awaitingAddressConfirmation?: boolean;
    awaitingAddressCustomerId?: string;
  };
  userPreferences: Record<string, any>;
  lastActivity: number;
}

export class ContextManager {
  private redis: Redis;
  private sessionTTL = 24 * 60 * 60; // 24 hours
  private maxMessages = 15; // Reduced from 50
  private maxToolHistory = 5; // Reduced from 20
  private messageCompressionThreshold = 10; // Compress after 10 messages

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis');
    });

    this.redis.on('error', (err) => {
      console.error('❌ Redis connection error:', err);
    });
  }

  // Session Management
  async createSession(sessionId: string, userId: string = 'anonymous'): Promise<void> {
    const context: ConversationContext = {
      sessionId,
      userId,
      messages: [],
      toolUsageHistory: [],
      activeEntities: { lastUpdated: Date.now() },
      userPreferences: {},
      lastActivity: Date.now(),
    };

    await this.redis.setex(
      `session:${sessionId}`,
      this.sessionTTL,
      JSON.stringify(context)
    );
  }

  async getSession(sessionId: string): Promise<ConversationContext | null> {
    const data = await this.redis.get(`session:${sessionId}`);
    if (!data) return null;
    
    const context = JSON.parse(data) as ConversationContext;
    await this.redis.expire(`session:${sessionId}`, this.sessionTTL);
    return context;
  }

  // Optimized Message Management
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    toolsUsed?: string[]
  ): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) return;

    // Compress content if it's too long
    const compressedContent = this.compressContent(content);

    context.messages.push({
      role,
      content: compressedContent,
      timestamp: Date.now(),
      toolsUsed,
    });

    // Apply intelligent pruning
    context.messages = this.pruneMessages(context.messages);

    context.lastActivity = Date.now();
    await this.saveContext(sessionId, context);
  }

  // Intelligent message pruning
  private pruneMessages(messages: ConversationMessage[]): ConversationMessage[] {
    if (messages.length <= this.maxMessages) return messages;

    // Keep system messages and recent messages
    const systemMessages = messages.filter(m => m.role === 'system').slice(-2);
    const recentMessages = messages.filter(m => m.role !== 'system').slice(-this.maxMessages);

    // Compress older messages into summaries
    const olderMessages = messages.slice(0, -this.maxMessages);
    const summary = this.summarizeMessages(olderMessages);

    if (summary) {
      return [
        {
          role: 'system',
          content: `Previous conversation summary: ${summary}`,
          timestamp: Date.now(),
          summary: summary
        },
        ...systemMessages,
        ...recentMessages
      ];
    }

    return [...systemMessages, ...recentMessages];
  }

  // Compress long content
  private compressContent(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) return content;

    // Extract key information
    const keyInfo = this.extractKeyInformation(content);
    if (keyInfo.length < content.length * 0.7) {
      return keyInfo;
    }

    // If still too long, truncate intelligently
    return content.substring(0, maxLength - 20) + '... [truncated]';
  }

  // Extract key information from content
  private extractKeyInformation(content: string): string {
    // Remove redundant whitespace
    let compressed = content.replace(/\s+/g, ' ').trim();

    // Remove common filler phrases
    const fillerPhrases = [
      'I understand that',
      'Let me help you with',
      'Based on the search results',
      'Here\'s what I found',
      'According to the data',
    ];

    fillerPhrases.forEach(phrase => {
      compressed = compressed.replace(new RegExp(phrase + '[^.]*\\.\\s*', 'gi'), '');
    });

    // Extract JSON data more efficiently
    const jsonMatch = compressed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        // Keep only essential fields
        const essential = this.extractEssentialData(data);
        compressed = compressed.replace(jsonMatch[0], JSON.stringify(essential));
      } catch (e) {
        // Not valid JSON, continue
      }
    }

    return compressed;
  }

  // Extract only essential data from results
  private extractEssentialData(data: any): any {
    if (Array.isArray(data)) {
      return data.slice(0, 3).map(item => ({
        id: item.id,
        name: item.name || item.customer_name || item.product_name,
        key_field: item.invoice_number || item.estimate_number || item.email
      }));
    }

    // For single objects, keep only key fields
    const essential: any = {};
    const keyFields = ['id', 'name', 'customer_name', 'product_name', 'email', 
                      'invoice_number', 'estimate_number', 'total', 'status'];
    
    keyFields.forEach(field => {
      if (data[field] !== undefined) {
        essential[field] = data[field];
      }
    });

    return essential;
  }

  // Optimized Tool Usage Recording
  async recordToolUsage(
    sessionId: string,
    toolName: string,
    args: any,
    result: any
  ): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) return;

    // Extract and store only essential information
    const resultSummary = this.summarizeToolResult(toolName, result);
    const resultIds = this.extractIdsFromResult(result);

    context.toolUsageHistory.push({
      toolName,
      args: this.compressArgs(args), // Compress args too
      resultSummary,
      resultIds,
      timestamp: Date.now(),
    });

    // Keep only recent tool usage
    if (context.toolUsageHistory.length > this.maxToolHistory) {
      context.toolUsageHistory = context.toolUsageHistory.slice(-this.maxToolHistory);
    }

    // Update active entities
    this.updateActiveEntities(context, toolName, result);

    context.lastActivity = Date.now();
    await this.saveContext(sessionId, context);

    // Cache result separately for quick access
    await this.cacheToolResult(toolName, args, result);
  }

  // Compress tool arguments
  private compressArgs(args: any): any {
    const compressed = { ...args };
    // Remove context metadata
    delete compressed._context;
    // Keep only essential fields
    return compressed;
  }

  // Summarize tool results instead of storing full data
  private summarizeToolResult(toolName: string, result: any): string {
    if (!result || !result.content) return '';

    try {
      const content = result.content[0]?.text;
      if (!content) return '';

      const data = JSON.parse(content);
      const resultData = data.result;

      if (Array.isArray(resultData)) {
        return `Found ${resultData.length} ${toolName.replace('search', '').replace('List', '')}(s)`;
      } else if (resultData && typeof resultData === 'object') {
        const key = resultData.name || resultData.customer_name || resultData.product_name;
        return key ? `Found: ${key}` : 'Found 1 result';
      }
    } catch (e) {
      return 'Result processed';
    }

    return '';
  }

  // Extract IDs for reference
  private extractIdsFromResult(result: any): string[] {
    const ids: string[] = [];
    
    try {
      const content = result.content?.[0]?.text;
      if (!content) return ids;

      const data = JSON.parse(content);
      const resultData = data.result;

      if (Array.isArray(resultData)) {
        resultData.forEach((item: any) => {
          if (item.id) ids.push(item.id.toString());
        });
      } else if (resultData?.id) {
        ids.push(resultData.id.toString());
      }
    } catch (e) {
      // Ignore parsing errors
    }

    return ids.slice(0, 5); // Keep max 5 IDs
  }

  // Update active entities efficiently
  private updateActiveEntities(context: ConversationContext, toolName: string, result: any): void {
    try {
      const content = result.content?.[0]?.text;
      console.log('updateActiveEntities toolName:', toolName);
      console.log('updateActiveEntities raw result:', JSON.stringify(result));
      console.log('updateActiveEntities content:', content);
      if (!content) return;

      let data: any = null;
      try {
        // Try to extract JSON object from the string
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
          console.log('updateActiveEntities extracted JSON:', data);
        } else {
          data = null;
          console.log('updateActiveEntities: no JSON object found in content');
        }
      } catch (e) {
        data = null;
        console.log('updateActiveEntities: failed to parse extracted JSON');
      }

      if (data && (toolName.includes('Customer') || toolName.includes('customer'))) {
        context.activeEntities.customerId = data.id?.toString() || data.customer_id?.toString();
        context.activeEntities.customerName = data.name || data.customer_name;
        context.activeEntities.lastUpdated = Date.now();
        console.log('updateActiveEntities: set customerId and customerName:', context.activeEntities.customerId, context.activeEntities.customerName);
      }
      // If data is parsed and has result, update as before
      if (data && data.result) {
        const resultData = data.result;
        if (toolName.includes('Customer') && resultData) {
          if (Array.isArray(resultData) && resultData.length > 0) {
            const latest = resultData[resultData.length - 1];
            context.activeEntities.customerId = latest.id?.toString();
            context.activeEntities.customerName = latest.customer_name || latest.name;
          } else if (resultData.id) {
            context.activeEntities.customerId = resultData.id.toString();
            context.activeEntities.customerName = resultData.customer_name || resultData.name;
          }
          context.activeEntities.lastUpdated = Date.now();
        }
        if (toolName.includes('Product') && resultData) {
          if (Array.isArray(resultData) && resultData.length > 0) {
            const latest = resultData[resultData.length - 1];
            context.activeEntities.productId = latest.id?.toString();
            context.activeEntities.productName = latest.product_name || latest.name;
          } else if (resultData.id) {
            context.activeEntities.productId = resultData.id.toString();
            context.activeEntities.productName = resultData.product_name || resultData.name;
          }
          context.activeEntities.lastUpdated = Date.now();
        }
      } else if (/customer/i.test(toolName) && /customer/i.test(content)) {
        // Try to match: ...: Customer Name. OR ...- Customer Name.
        let match = content.match(/[:\-]\s*([A-Za-z0-9 .,&'-]+)\./);
        if (!match) {
          // Try to match: ...: Customer Name (end of string)
          match = content.match(/[:\-]\s*([A-Za-z0-9 .,&'-]+)$/);
        }
        if (match) {
          context.activeEntities.customerName = match[1].trim();
          context.activeEntities.lastUpdated = Date.now();
        }
        // Try to extract customer ID if present (e.g., 'Customer ID: 600005804')
        const idMatch = content.match(/customer id[:\-]?\s*(\d+)/i);
        if (idMatch) {
          context.activeEntities.customerId = idMatch[1];
          context.activeEntities.lastUpdated = Date.now();
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  // Optimized context generation
  async generateToolContext(sessionId: string, currentQuery: string): Promise<any> {
    const context = await this.getSession(sessionId);
    if (!context) {
      return {
        recentQueries: [currentQuery],
        activeEntities: {},
        userIntent: 'unknown',
      };
    }

    // Get only essential recent queries
    const recentMessages = context.messages.slice(-5);
    const recentQueries = recentMessages
      .filter(m => m.role === 'user')
      .map(m => m.content.substring(0, 100)); // Limit query length

    const userIntent = this.detectIntent([...recentQueries, currentQuery]);

    return {
      recentQueries: [...recentQueries, currentQuery],
      activeEntities: context.activeEntities,
      userIntent,
    };
  }

  // Simplified argument enhancement
  async enhanceToolArguments(
    sessionId: string,
    toolName: string,
    originalArgs: any,
    currentQuery: string
  ): Promise<any> {
    const context = await this.getSession(sessionId);
    if (!context) return originalArgs;

    const enhancedArgs = { ...originalArgs };
    const hasReference = this.detectPronounReference(currentQuery);

    if (
      hasReference &&
      context.activeEntities.customerId &&
      (!enhancedArgs.customer_id && !enhancedArgs.id) &&
      /(customer|address|contact|details|info|find)/i.test(toolName)
    ) {
      // Try both possible argument names
      if ('customer_id' in enhancedArgs || toolName.toLowerCase().includes('customer')) {
        enhancedArgs.customer_id = context.activeEntities.customerId;
      } else {
        enhancedArgs.id = context.activeEntities.customerId;
      }
      console.log(`🧠 Auto-filled customer_id/id: ${context.activeEntities.customerId} for tool: ${toolName}`);
    }

    // Existing logic for other entities
    switch (toolName) {
      case 'searchEstimateList':
      case 'searchInvoiceList':
        if (!enhancedArgs.search && hasReference && context.activeEntities.customerName) {
          enhancedArgs.search = context.activeEntities.customerName;
          console.log(`🧠 Auto-filled search: ${context.activeEntities.customerName}`);
        }
        break;
      case 'getProductDetails':
        if (!enhancedArgs.product_id && hasReference && context.activeEntities.productId) {
          enhancedArgs.product_id = context.activeEntities.productId;
          console.log(`🧠 Auto-filled product_id: ${context.activeEntities.productId}`);
        }
        break;
    }

    return enhancedArgs;
  }

  // Summarize messages for compression
  private summarizeMessages(messages: ConversationMessage[]): string {
    if (messages.length === 0) return '';

    const topics = new Set<string>();
    const entities = new Set<string>();

    messages.forEach(msg => {
      // Extract topics
      if (msg.content.includes('customer')) topics.add('customers');
      if (msg.content.includes('product')) topics.add('products');
      if (msg.content.includes('invoice')) topics.add('invoices');
      if (msg.content.includes('estimate')) topics.add('estimates');

      // Extract entity names
      const names = msg.content.match(/[A-Z][a-z]+ [A-Z][a-z]+/g);
      if (names) names.forEach(name => entities.add(name));
    });

    const summary = `Discussed ${Array.from(topics).join(', ')}`;
    const entityList = Array.from(entities).slice(0, 3).join(', ');
    
    return entityList ? `${summary} regarding ${entityList}` : summary;
  }

  // Save context with compression
  public async saveContext(sessionId: string, context: ConversationContext): Promise<void> {
    // Remove old entity data if not recently used
    const entityAge = Date.now() - context.activeEntities.lastUpdated;
    if (entityAge > 10 * 60 * 1000) { // 10 minutes
      context.activeEntities = { lastUpdated: Date.now() };
    }

    await this.redis.setex(
      `session:${sessionId}`,
      this.sessionTTL,
      JSON.stringify(context)
    );
  }

  // Keep other helper methods but optimize them...
  private detectIntent(queries: string[]): string {
    const recentQuery = queries.slice(-3).join(' ').toLowerCase();
    
    if (recentQuery.includes('product')) return 'product_inquiry';
    if (recentQuery.includes('customer')) return 'customer_management';
    if (recentQuery.includes('invoice')) return 'billing_inquiry';
    if (recentQuery.includes('estimate')) return 'estimation';
    
    return 'general_inquiry';
  }

  private detectPronounReference(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const pronouns = ['his', 'her', 'their', 'this', 'that', 'the same'];
    return pronouns.some(pronoun => lowerQuery.includes(pronoun));
  }

  private inferDateRange(queries: string[]): { from?: string; to?: string } {
    const dateRange: { from?: string; to?: string } = {};
    const query = queries.join(' ').toLowerCase();
    const today = new Date();
    
    // Helper function to format date as YYYY-MM-DD
    const formatDate = (date: Date): string => {
      return date.toISOString().split('T')[0];
    };
    
    // Only handle very basic patterns, let Claude handle the rest
    if (query.includes('today')) {
      dateRange.from = dateRange.to = formatDate(today);
    } else if (query.includes('yesterday')) {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      dateRange.from = dateRange.to = formatDate(yesterday);
    } else if (query.includes('tomorrow')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      dateRange.from = dateRange.to = formatDate(tomorrow);
    }
    // For all other expressions, let Claude handle them in the tool calls
    // This keeps the context manager simple and leverages Claude's understanding
    
    return dateRange;
  }

  // Cache management remains the same
  async cacheToolResult(toolName: string, args: any, result: any, ttl: number = 300): Promise<void> {
    const cacheKey = `cache:${toolName}:${this.hashArgs(args)}`;
    await this.redis.setex(cacheKey, ttl, JSON.stringify(result));
  }

  async getCachedResult(toolName: string, args: any): Promise<any | null> {
    const cacheKey = `cache:${toolName}:${this.hashArgs(args)}`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  private hashArgs(args: any): string {
    return Buffer.from(JSON.stringify(args)).toString('base64').slice(0, 32);
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
  }
}