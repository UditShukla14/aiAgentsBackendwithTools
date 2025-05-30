import Redis from 'ioredis';

interface ConversationContext {
  sessionId: string;
  userId: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    toolsUsed?: string[];
  }>;
  toolUsageHistory: Array<{
    toolName: string;
    args: any;
    result: any;
    timestamp: number;
  }>;
  userPreferences: Record<string, any>;
  lastActivity: number;
}

interface ToolContext {
  recentQueries: string[];
  relatedData: Record<string, any>;
  userIntent: string;
  previousResults: any[];
}

export class ContextManager {
  private redis: Redis;
  private sessionTTL = 24 * 60 * 60; // 24 hours in seconds

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
    // Update TTL on access
    await this.redis.expire(`session:${sessionId}`, this.sessionTTL);
    return context;
  }

  // Message Management
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    toolsUsed?: string[]
  ): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) return;

    context.messages.push({
      role,
      content,
      timestamp: Date.now(),
      toolsUsed,
    });

    // Keep only last 50 messages to manage memory
    if (context.messages.length > 50) {
      context.messages = context.messages.slice(-50);
    }

    context.lastActivity = Date.now();
    await this.redis.setex(
      `session:${sessionId}`,
      this.sessionTTL,
      JSON.stringify(context)
    );
  }

  // Tool Usage Tracking
  async recordToolUsage(
    sessionId: string,
    toolName: string,
    args: any,
    result: any
  ): Promise<void> {
    const context = await this.getSession(sessionId);
    if (!context) return;

    context.toolUsageHistory.push({
      toolName,
      args,
      result,
      timestamp: Date.now(),
    });

    // Keep only last 20 tool usages
    if (context.toolUsageHistory.length > 20) {
      context.toolUsageHistory = context.toolUsageHistory.slice(-20);
    }

    context.lastActivity = Date.now();
    await this.redis.setex(
      `session:${sessionId}`,
      this.sessionTTL,
      JSON.stringify(context)
    );

    // Also store tool-specific usage patterns
    await this.updateToolPatterns(toolName, args, result);
  }

  // Generate Context for Tools
  async generateToolContext(sessionId: string, currentQuery: string): Promise<ToolContext> {
    const context = await this.getSession(sessionId);
    if (!context) {
      return {
        recentQueries: [currentQuery],
        relatedData: {},
        userIntent: 'unknown',
        previousResults: [],
      };
    }

    const recentMessages = context.messages.slice(-10);
    const recentQueries = recentMessages
      .filter(m => m.role === 'user')
      .map(m => m.content);

    const recentToolUsage = context.toolUsageHistory.slice(-5);
    const previousResults = recentToolUsage.map(t => t.result);

    // Simple intent detection based on recent queries
    const userIntent = this.detectIntent([...recentQueries, currentQuery]);

    // Extract related data from recent tool usage
    const relatedData = this.extractRelatedData(recentToolUsage, currentQuery);

    return {
      recentQueries: [...recentQueries, currentQuery],
      relatedData,
      userIntent,
      previousResults,
    };
  }

  // Context-Aware Tool Argument Enhancement
  async enhanceToolArguments(
    sessionId: string,
    toolName: string,
    originalArgs: any,
    currentQuery: string
  ): Promise<any> {
    const toolContext = await this.generateToolContext(sessionId, currentQuery);
    const enhancedArgs = { ...originalArgs };

    // Extract entity references from context
    const contextEntities = this.extractEntitiesFromContext(toolContext);

    // Tool-specific context enhancement
    switch (toolName) {
      case 'searchProductList':
        enhancedArgs._context = {
          recentSearches: this.extractProductSearches(toolContext.recentQueries),
          userIntent: toolContext.userIntent,
        };
        break;

      case 'searchCustomerList':
        enhancedArgs._context = {
          recentCustomers: this.extractCustomerData(toolContext.previousResults),
          userIntent: toolContext.userIntent,
        };
        break;

      case 'searchCustomerAddress':
        // Auto-fill customer_id if missing but referenced in context
        if (!enhancedArgs.customer_id && contextEntities.lastCustomerId) {
          enhancedArgs.customer_id = contextEntities.lastCustomerId;
          console.log(`🧠 Context: Auto-filled customer_id ${contextEntities.lastCustomerId} from recent context`);
        }
        enhancedArgs._context = {
          recentCustomer: contextEntities.lastCustomerName,
          userIntent: toolContext.userIntent,
        };
        break;

      case 'searchEstimateList':
      case 'searchInvoiceList':
        // Auto-fill customer info if context suggests it
        const hasCustomerReference = this.detectPronounReference(currentQuery) || 
                                   currentQuery.toLowerCase().includes('customer');
        
        if (!enhancedArgs.search && hasCustomerReference) {
          // Try to use the most recent customer info
          const customerName = contextEntities.lastCustomerName || contextEntities.mentionedCustomer;
          if (customerName) {
            enhancedArgs.search = customerName;
            console.log(`🧠 Context: Auto-filled search with customer "${customerName}" from context reference`);
          }
        }
        
        enhancedArgs._context = {
          dateRange: this.inferDateRange(toolContext.recentQueries),
          userIntent: toolContext.userIntent,
          recentCustomer: contextEntities.lastCustomerName || contextEntities.mentionedCustomer,
          recentCustomerId: contextEntities.lastCustomerId,
        };
        break;

      case 'getProductDetails':
        // Auto-fill product_id if missing but referenced in context
        if (!enhancedArgs.product_id && contextEntities.lastProductId) {
          enhancedArgs.product_id = contextEntities.lastProductId;
          console.log(`🧠 Context: Auto-filled product_id ${contextEntities.lastProductId} from recent context`);
        }
        enhancedArgs._context = {
          recentProduct: contextEntities.lastProductName,
          userIntent: toolContext.userIntent,
        };
        break;

      default:
        enhancedArgs._context = {
          recentQueries: toolContext.recentQueries.slice(-3),
          userIntent: toolContext.userIntent,
          entities: contextEntities,
        };
    }

    return enhancedArgs;
  }

  // Extract entities (IDs, names) from recent context
  private extractEntitiesFromContext(toolContext: ToolContext): Record<string, any> {
    const entities: Record<string, any> = {};
    
    // Extract from previous tool results
    toolContext.previousResults.forEach(result => {
      if (result && result.content && Array.isArray(result.content)) {
        result.content.forEach((content: any) => {
          if (content.type === 'text' && content.text) {
            try {
              const data = JSON.parse(content.text);
              
              // Extract customer information
              if (data.result && Array.isArray(data.result)) {
                const customers = data.result.filter((item: any) => 
                  item.customer_name || item.id || item.customer_id);
                if (customers.length > 0) {
                  const lastCustomer = customers[customers.length - 1];
                  entities.lastCustomerId = lastCustomer.id || lastCustomer.customer_id;
                  entities.lastCustomerName = lastCustomer.customer_name || lastCustomer.name;
                  entities.lastCustomerEmail = lastCustomer.email;
                }
              }
              
              // Extract single customer details
              if (data.result && data.result.customer_name) {
                entities.lastCustomerId = data.result.id || data.result.customer_id;
                entities.lastCustomerName = data.result.customer_name;
                entities.lastCustomerEmail = data.result.email;
              }
              
              // Extract product information
              if (data.result && Array.isArray(data.result)) {
                const products = data.result.filter((item: any) => 
                  item.product_name || item.name);
                if (products.length > 0) {
                  const lastProduct = products[products.length - 1];
                  entities.lastProductId = lastProduct.id || lastProduct.product_id;
                  entities.lastProductName = lastProduct.product_name || lastProduct.name;
                }
              }
              
              // Extract invoice/estimate information
              if (data.result && Array.isArray(data.result)) {
                const documents = data.result.filter((item: any) => 
                  item.invoice_number || item.estimate_number);
                if (documents.length > 0) {
                  const lastDoc = documents[documents.length - 1];
                  entities.lastDocumentId = lastDoc.id;
                  entities.lastDocumentNumber = lastDoc.invoice_number || lastDoc.estimate_number;
                  entities.lastDocumentCustomer = lastDoc.customer_name;
                }
              }
              
            } catch (e) {
              // Not JSON, try to extract names from text directly
              const text = content.text.toLowerCase();
              
              // Look for customer mentions in text
              const customerMatch = text.match(/customer.*?([a-z]+ [a-z]+)/i);
              if (customerMatch) {
                entities.mentionedCustomer = customerMatch[1];
              }
            }
          }
        });
      }
    });
    
    // Also extract from recent conversation messages
    const recentMessages = toolContext.recentQueries.slice(-5);
    recentMessages.forEach(message => {
      const lowerMsg = message.toLowerCase();
      
      // Extract customer names mentioned in conversation
      const customerPatterns = [
        /customer named ([a-z]+ [a-z]+)/i,
        /find.*?([a-z]+ [a-z]+)/i,
        /looking for ([a-z]+ [a-z]+)/i,
        /about ([a-z]+ [a-z]+)/i
      ];
      
      customerPatterns.forEach(pattern => {
        const match = message.match(pattern);
        if (match && match[1] && match[1].length > 3) { // Avoid short false matches
          entities.mentionedCustomer = match[1];
          console.log(`🧠 Context: Found customer name "${match[1]}" in conversation`);
        }
      });
    });
    
    return entities;
  }

  // Cache Management
  async cacheToolResult(toolName: string, args: any, result: any, ttl: number = 300): Promise<void> {
    const cacheKey = `cache:${toolName}:${this.hashArgs(args)}`;
    await this.redis.setex(cacheKey, ttl, JSON.stringify(result));
  }

  async getCachedResult(toolName: string, args: any): Promise<any | null> {
    const cacheKey = `cache:${toolName}:${this.hashArgs(args)}`;
    const cached = await this.redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  // Private Helper Methods
  private async updateToolPatterns(toolName: string, args: any, result: any): Promise<void> {
    const key = `patterns:${toolName}`;
    const pattern = { args, result, timestamp: Date.now() };
    
    await this.redis.lpush(key, JSON.stringify(pattern));
    await this.redis.ltrim(key, 0, 49); // Keep last 50 patterns
    await this.redis.expire(key, 7 * 24 * 60 * 60); // 7 days
  }

  private detectIntent(queries: string[]): string {
    const recentQuery = queries.join(' ').toLowerCase();
    
    if (recentQuery.includes('product') || recentQuery.includes('item')) return 'product_inquiry';
    if (recentQuery.includes('customer') || recentQuery.includes('client')) return 'customer_management';
    if (recentQuery.includes('invoice') || recentQuery.includes('bill')) return 'billing_inquiry';
    if (recentQuery.includes('estimate') || recentQuery.includes('quote')) return 'estimation';
    if (recentQuery.includes('calculate') || recentQuery.includes('math')) return 'calculation';
    if (recentQuery.includes('analyze') || recentQuery.includes('text')) return 'analysis';
    
    return 'general_inquiry';
  }

  private extractRelatedData(toolUsage: any[], currentQuery: string): Record<string, any> {
    const data: Record<string, any> = {};
    
    toolUsage.forEach(usage => {
      if (usage.toolName === 'searchProductList' && usage.result) {
        data.recentProducts = usage.result;
      }
      if (usage.toolName === 'searchCustomerList' && usage.result) {
        data.recentCustomers = usage.result;
      }
    });

    return data;
  }

  private extractProductSearches(queries: string[]): string[] {
    return queries
      .filter(q => q.toLowerCase().includes('product') || q.toLowerCase().includes('search'))
      .slice(-3);
  }

  private extractCustomerData(results: any[]): any[] {
    return results
      .filter(r => r && (r.customer_name || r.customers))
      .slice(-3);
  }

  private inferDateRange(queries: string[]): { from?: string; to?: string } {
    const dateRange: { from?: string; to?: string } = {};
    const recentQuery = queries.join(' ').toLowerCase();
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    console.log(`🧠 Context: Processing date query: "${recentQuery}"`);
    console.log(`🧠 Context: Today is: ${today.toISOString().split('T')[0]}`);
    
    // Handle "today"
    if (recentQuery.includes('today') && !recentQuery.includes('till today')) {
      const todayStr = today.toISOString().split('T')[0];
      dateRange.from = todayStr;
      dateRange.to = todayStr;
    }
    // Handle "yesterday" or "last day"
    else if (recentQuery.includes('yesterday') || recentQuery.includes('last day')) {
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      dateRange.from = yesterdayStr;
      dateRange.to = yesterdayStr;
    }
    // Handle "last week till today" or "last week to today"
    else if (recentQuery.includes('last week') && (recentQuery.includes('till today') || recentQuery.includes('to today'))) {
      const lastWeekStart = new Date(today);
      lastWeekStart.setDate(today.getDate() - today.getDay() - 7); // Go back to start of last week
      dateRange.from = lastWeekStart.toISOString().split('T')[0];
      dateRange.to = today.toISOString().split('T')[0]; // Till today
    }
    // Handle "this week"
    else if (recentQuery.includes('this week')) {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      dateRange.from = weekStart.toISOString().split('T')[0];
    }
    // Handle "last week" (just last week, not till today)
    else if (recentQuery.includes('last week')) {
      const lastWeekEnd = new Date(today);
      lastWeekEnd.setDate(today.getDate() - today.getDay() - 1);
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
      dateRange.from = lastWeekStart.toISOString().split('T')[0];
      dateRange.to = lastWeekEnd.toISOString().split('T')[0];
    }
    // Handle "this month"
    else if (recentQuery.includes('this month')) {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      dateRange.from = monthStart.toISOString().split('T')[0];
    }
    // Handle "last month"
    else if (recentQuery.includes('last month')) {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      dateRange.from = lastMonth.toISOString().split('T')[0];
      dateRange.to = lastMonthEnd.toISOString().split('T')[0];
    }
    // Handle "last X days"
    else if (recentQuery.match(/last (\d+) days?/)) {
      const match = recentQuery.match(/last (\d+) days?/);
      if (match) {
        const days = parseInt(match[1]);
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - days);
        dateRange.from = startDate.toISOString().split('T')[0];
        dateRange.to = today.toISOString().split('T')[0];
      }
    }
    // Handle explicit date ranges like "20may to 29may" or "may 20 to may 29"
    else if (recentQuery.match(/(\d{1,2})(\w{3,9})\s*to\s*(\d{1,2})(\w{3,9})/)) {
      const match = recentQuery.match(/(\d{1,2})(\w{3,9})\s*to\s*(\d{1,2})(\w{3,9})/);
      if (match) {
        const [, fromDay, fromMonth, toDay, toMonth] = match;
        const currentYear = today.getFullYear();
        
        try {
          const fromDate = this.parseFlexibleDate(fromDay, fromMonth, currentYear);
          const toDate = this.parseFlexibleDate(toDay, toMonth, currentYear);
          
          if (fromDate && toDate) {
            dateRange.from = fromDate;
            dateRange.to = toDate;
          }
        } catch (e) {
          console.log('Date parsing error:', e);
        }
      }
    }
    
    if (dateRange.from || dateRange.to) {
      console.log(`🧠 Context: Calculated date range:`, dateRange);
      console.log(`🧠 Context: Will send to API - from_date: "${dateRange.from}", to_date: "${dateRange.to}"`);
    } else {
      console.log(`🧠 Context: No date range inferred from query`);
    }
    
    return dateRange;
  }

  // Helper method to parse flexible date formats
  private parseFlexibleDate(day: string, month: string, year: number): string | null {
    const monthMap: { [key: string]: number } = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11
    };

    const monthName = month.toLowerCase();
    const monthNumber = monthMap[monthName];
    
    if (monthNumber !== undefined) {
      const date = new Date(year, monthNumber, parseInt(day));
      return date.toISOString().split('T')[0];
    }
    
    return null;
  }

  private hashArgs(args: any): string {
    return Buffer.from(JSON.stringify(args)).toString('base64').slice(0, 32);
  }

  // Cleanup
  async cleanup(): Promise<void> {
    await this.redis.quit();
  }

  // Improved pronoun and reference detection
  private detectPronounReference(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const pronouns = [
      'his', 'her', 'their', 'its',
      'he', 'she', 'they', 'it',
      'this customer', 'that customer', 'the customer',
      'this client', 'that client', 'the client',
      'this person', 'that person',
      'him', 'them'
    ];
    
    return pronouns.some(pronoun => lowerQuery.includes(pronoun));
  }
} 