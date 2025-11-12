// tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Shared utility functions (used by multiple tools)
export const SHARED_UTILITIES = {
  // Date utility functions
  date: {
    addDays: (date: Date, days: number): Date => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    },
    
    addMonths: (date: Date, months: number): Date => {
      const result = new Date(date);
      result.setMonth(result.getMonth() + months);
      return result;
    },
    
    getWeekStart: (date: Date): Date => {
      const result = new Date(date);
      const day = result.getDay();
      const diff = result.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
      result.setDate(diff);
      return result;
    },
    
    getWeekEnd: (date: Date): Date => {
      const start = SHARED_UTILITIES.date.getWeekStart(date);
      return SHARED_UTILITIES.date.addDays(start, 6);
    },
    
    getCurrentQuarter: (date: Date): number => {
      return Math.floor(date.getMonth() / 3) + 1;
    },
    
    getQuarterRange: (year: number, quarter: number) => {
      const startMonth = (quarter - 1) * 3;
      return {
        start: new Date(year, startMonth, 1),
        end: new Date(year, startMonth + 3, 0)
      };
    },
    
    getLastQuarterRange: (date: Date) => {
      const currentQuarter = SHARED_UTILITIES.date.getCurrentQuarter(date);
      const lastQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
      const year = currentQuarter === 1 ? date.getFullYear() - 1 : date.getFullYear();
      return SHARED_UTILITIES.date.getQuarterRange(year, lastQuarter);
    },
    
    getNextQuarterRange: (date: Date) => {
      const currentQuarter = SHARED_UTILITIES.date.getCurrentQuarter(date);
      const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
      const year = currentQuarter === 4 ? date.getFullYear() + 1 : date.getFullYear();
      return SHARED_UTILITIES.date.getQuarterRange(year, nextQuarter);
    },
    
    extractNumber: (str: string): number | null => {
      const match = str.match(/\d+/);
      return match ? parseInt(match[0]) : null;
    },
    
    formatDate: (date: Date, formatStr?: string): string => {
      if (!formatStr || formatStr === 'ISO') {
        return date.toISOString().split('T')[0];
      }
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      return formatStr
        .replace('YYYY', String(year))
        .replace('MM', month)
        .replace('DD', day);
    },
    
    parseNaturalLanguageDate: (dateExpression: string): { start: string, end: string } | null => {
      if (!dateExpression) return null;
      
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      
      // Normalize the expression
      const expr = dateExpression.toLowerCase().trim();
      
      // Create a structured interpretation based on common patterns
      const dateInterpretation: Record<string, { start: Date, end: Date }> = {
        // Relative time expressions
        'today': { start: now, end: now },
        'yesterday': { 
          start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
          end: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        },
        'tomorrow': { 
          start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
          end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        },
        
        // Week expressions
        'this week': {
          start: SHARED_UTILITIES.date.getWeekStart(now),
          end: SHARED_UTILITIES.date.getWeekEnd(now)
        },
        'last week': {
          start: SHARED_UTILITIES.date.getWeekStart(SHARED_UTILITIES.date.addDays(now, -7)),
          end: SHARED_UTILITIES.date.getWeekEnd(SHARED_UTILITIES.date.addDays(now, -7))
        },
        'next week': {
          start: SHARED_UTILITIES.date.getWeekStart(SHARED_UTILITIES.date.addDays(now, 7)),
          end: SHARED_UTILITIES.date.getWeekEnd(SHARED_UTILITIES.date.addDays(now, 7))
        },
        
        // Month expressions
        'this month': {
          start: new Date(currentYear, currentMonth, 1),
          end: new Date(currentYear, currentMonth + 1, 0)
        },
        'last month': {
          start: new Date(currentYear, currentMonth - 1, 1),
          end: new Date(currentYear, currentMonth, 0)
        },
        'next month': {
          start: new Date(currentYear, currentMonth + 1, 1),
          end: new Date(currentYear, currentMonth + 2, 0)
        },
        
        // Quarter expressions
        'this quarter': SHARED_UTILITIES.date.getQuarterRange(currentYear, SHARED_UTILITIES.date.getCurrentQuarter(now)),
        'last quarter': SHARED_UTILITIES.date.getLastQuarterRange(now),
        'next quarter': SHARED_UTILITIES.date.getNextQuarterRange(now),
        
        // Year expressions
        'this year': {
          start: new Date(currentYear, 0, 1),
          end: new Date(currentYear, 11, 31)
        },
        'last year': {
          start: new Date(currentYear - 1, 0, 1),
          end: new Date(currentYear - 1, 11, 31)
        },
        'next year': {
          start: new Date(currentYear + 1, 0, 1),
          end: new Date(currentYear + 1, 11, 31)
        }
      };
      
      // Check for exact matches first
      if (expr in dateInterpretation) {
        const range = dateInterpretation[expr];
        return {
          start: SHARED_UTILITIES.date.formatDate(range.start),
          end: SHARED_UTILITIES.date.formatDate(range.end)
        };
      }
      
      // Handle "last X days/weeks/months" patterns
      if (expr.includes('last') && expr.includes('days')) {
        const days = SHARED_UTILITIES.date.extractNumber(expr) || 30;
        return {
          start: SHARED_UTILITIES.date.formatDate(SHARED_UTILITIES.date.addDays(now, -days)),
          end: SHARED_UTILITIES.date.formatDate(now)
        };
      }
      
      if (expr.includes('last') && expr.includes('weeks')) {
        const weeks = SHARED_UTILITIES.date.extractNumber(expr) || 1;
        return {
          start: SHARED_UTILITIES.date.formatDate(SHARED_UTILITIES.date.addDays(now, -weeks * 7)),
          end: SHARED_UTILITIES.date.formatDate(now)
        };
      }
      
      if (expr.includes('last') && expr.includes('months')) {
        const months = SHARED_UTILITIES.date.extractNumber(expr) || 1;
        return {
          start: SHARED_UTILITIES.date.formatDate(SHARED_UTILITIES.date.addMonths(now, -months)),
          end: SHARED_UTILITIES.date.formatDate(now)
        };
      }
      
      // Handle "next X days/weeks/months" patterns
      if (expr.includes('next') && expr.includes('days')) {
        const days = SHARED_UTILITIES.date.extractNumber(expr) || 30;
        return {
          start: SHARED_UTILITIES.date.formatDate(now),
          end: SHARED_UTILITIES.date.formatDate(SHARED_UTILITIES.date.addDays(now, days))
        };
      }
      
      // Handle quarter expressions like "Q1 2025"
      const quarterMatch = expr.match(/q([1-4])\s*(\d{4})/);
      if (quarterMatch) {
        const quarter = parseInt(quarterMatch[1]);
        const year = parseInt(quarterMatch[2]);
        const range = SHARED_UTILITIES.date.getQuarterRange(year, quarter);
        return {
          start: SHARED_UTILITIES.date.formatDate(range.start),
          end: SHARED_UTILITIES.date.formatDate(range.end)
        };
      }
      
      // Handle year expressions like "2024"
      const yearMatch = expr.match(/^(\d{4})$/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        return {
          start: SHARED_UTILITIES.date.formatDate(new Date(year, 0, 1)),
          end: SHARED_UTILITIES.date.formatDate(new Date(year, 11, 31))
        };
      }
      
      // Try to parse as a regular date
      const singleDate = new Date(dateExpression);
      if (!isNaN(singleDate.getTime())) {
        const dateStr = SHARED_UTILITIES.date.formatDate(singleDate);
        return { start: dateStr, end: dateStr };
      }
      
      return null;
    }
  },
  
  // Comprehensive API utilities (shared between all tools)
  api: {
    // Customer-related APIs
    customers: {
      // Get customer list with search and filters
      getList: async (params: {
        search?: string;
        take?: number;
        skip?: number;
        status?: string;
      } = {}) => {
        return await callIMPApi("/api/customer_list", {
          take: params.take || 1000,
          ...(params.search && { search: params.search }),
          ...(params.skip && { skip: params.skip }),
          ...(params.status && { status: params.status })
        });
      },
      
      // Get customer details by ID
      getDetails: async (customerId: string | number) => {
        return await callIMPApi("/api/customer_details", {
          customer_id: customerId
        });
      },
      
      // Search customers by name or other criteria
      search: async (searchTerm: string, take: number = 1000) => {
        return await callIMPApi("/api/customer_list", {
          search: searchTerm,
          take
        });
      }
    },
    
    // Estimate-related APIs
    estimates: {
      // Get estimate list with comprehensive filters
      getList: async (params: {
        search?: string;
        from_date?: string;
        to_date?: string;
        take?: number;
        skip?: number;
        status?: string;
        customer_id?: string | number;
      } = {}) => {
        return await callIMPApi("/api/estimate/list", {
          take: params.take || 1000,
          ...(params.search && { search: params.search }),
          ...(params.from_date && { from_date: params.from_date }),
          ...(params.to_date && { to_date: params.to_date }),
          ...(params.skip && { skip: params.skip }),
          ...(params.status && { status: params.status }),
          ...(params.customer_id && { customer_id: params.customer_id })
        });
      },
      
      // Get estimate details by ID
      getDetails: async (estimateId: string | number) => {
        return await callIMPApi("/api/estimate_details", {
          estimate_id: estimateId
        });
      },
      
      // Search estimates by customer name or other criteria
      search: async (searchTerm: string, params: {
        from_date?: string;
        to_date?: string;
        take?: number;
      } = {}) => {
        return await callIMPApi("/api/estimate/list", {
          search: searchTerm,
          take: params.take || 1000,
          ...(params.from_date && { from_date: params.from_date }),
          ...(params.to_date && { to_date: params.to_date })
        });
      }
    },
    
    // Invoice-related APIs
    invoices: {
      // Get invoice list with comprehensive filters
      getList: async (params: {
        search?: string;
        from_date?: string;
        to_date?: string;
        take?: number;
        skip?: number;
        status?: string;
        customer_id?: string | number;
        get_all?: boolean;
      } = {}) => {
        return await callIMPApi("/api/invoice_list", {
          take: params.take || 1000,
          ...(params.search && { search: params.search }),
          ...(params.from_date && { from_date: params.from_date }),
          ...(params.to_date && { to_date: params.to_date }),
          ...(params.skip && { skip: params.skip }),
          ...(params.status && { status: params.status }),
          ...(params.customer_id && { customer_id: params.customer_id }),
          ...(params.get_all && { get_all: params.get_all })
        });
      },
      
      // Get invoice details by ID
      getDetails: async (invoiceId: string | number) => {
        return await callIMPApi("/api/invoice_details", {
          invoice_id: invoiceId
        });
      },
      
      // Search invoices by customer name or other criteria
      search: async (searchTerm: string, params: {
        from_date?: string;
        to_date?: string;
        take?: number;
      } = {}) => {
        return await callIMPApi("/api/invoice_list", {
          search: searchTerm,
          take: params.take || 1000,
          ...(params.from_date && { from_date: params.from_date }),
          ...(params.to_date && { to_date: params.to_date })
        });
      }
    },
    
    // Task-related APIs
    tasks: {
      // Get task list with comprehensive filters
      getList: async (params: {
        object_name?: string;
        object_id?: string | number;
        filter?: string;
        page?: number;
        take?: number;
        search?: string;
        employee_name?: string;
        show_all?: boolean;
      } = {}) => {
        return await callIMPApi("/api/task_list", {
          take: params.take || 20,
          ...(params.object_name && { object_name: params.object_name }),
          ...(params.object_id && { object_id: params.object_id }),
          ...(params.filter && { filter: params.filter }),
          ...(params.page && { page: params.page }),
          ...(params.search && { search: params.search }),
          ...(params.show_all && { show_all: params.show_all })
        });
      },
      
      // Get task details by ID
      getDetails: async (taskId: string | number) => {
        return await callIMPApi("/api/task_details", {
          task_id: taskId
        });
      },
      
      // Get task details by custom number
      getDetailsByCustomNumber: async (customNumber: string) => {
        return await callIMPApi("/api/task_details", {
          custom_number: customNumber
        });
      }
    },
    
    // Product-related APIs
    products: {
      // Get product list with search and filters
      getList: async (params: {
        search?: string;
        take?: number;
        skip?: number;
        category?: string;
        status?: string;
      } = {}) => {
        return await callIMPApi("/api/product_list", {
          take: params.take || 1000,
          ...(params.search && { search: params.search }),
          ...(params.skip && { skip: params.skip }),
          ...(params.category && { category: params.category }),
          ...(params.status && { status: params.status })
        });
      },
      
      // Get product details by ID
      getDetails: async (productId: string | number) => {
        return await callIMPApi("/api/product_details", {
          product_id: productId
        });
      },
      
      // Search products by name or other criteria
      search: async (searchTerm: string, take: number = 1000) => {
        return await callIMPApi("/api/product_list", {
          search: searchTerm,
          take
        });
      }
    },
    
    // Employee-related APIs
    employees: {
      // Get employee list
      getList: async (params: {
        search?: string;
        take?: number;
        skip?: number;
        role?: string;
      } = {}) => {
        return await callIMPApi("/api/employee_list", {
          take: params.take || 1000,
          ...(params.search && { search: params.search }),
          ...(params.skip && { skip: params.skip }),
          ...(params.role && { role: params.role })
        });
      },
      
      // Get employee details by ID
      getDetails: async (employeeId: string | number) => {
        return await callIMPApi("/api/employee_details", {
          employee_id: employeeId
        });
      }
    },
    
    // Analytics and reporting APIs
    analytics: {
      // Get sales analytics data
      getSalesData: async (params: {
        from_date?: string;
        to_date?: string;
        customer_id?: string | number;
        include_estimates?: boolean;
        include_invoices?: boolean;
      } = {}) => {
        return await callIMPApi("/api/analytics/sales", {
          ...(params.from_date && { from_date: params.from_date }),
          ...(params.to_date && { to_date: params.to_date }),
          ...(params.customer_id && { customer_id: params.customer_id }),
          ...(params.include_estimates && { include_estimates: params.include_estimates }),
          ...(params.include_invoices && { include_invoices: params.include_invoices })
        });
      },
      
      // Get customer analytics data
      getCustomerData: async (customerId: string | number, params: {
        from_date?: string;
        to_date?: string;
      } = {}) => {
        return await callIMPApi("/api/analytics/customer", {
          customer_id: customerId,
          ...(params.from_date && { from_date: params.from_date }),
          ...(params.to_date && { to_date: params.to_date })
        });
      }
    },
    
    // Utility APIs
    utils: {
      // Get company information
      getCompanyInfo: async () => {
        return await callIMPApi("/api/company_info");
      },
      
      // Get user information
      getUserInfo: async () => {
        return await callIMPApi("/api/user_info");
      },
      
      // Get system status
      getSystemStatus: async () => {
        return await callIMPApi("/api/system_status");
      }
    }
  }
};

// Static data for MCP server tools

export const BASE_URL = "https://app.invoicemakerpro.com";
export const HARDCODED_TOKEN = "SERVICESEERS_EAAAEAcaEROsO6yeAPYugIlrKsouynS5f0iDnXQ";
export const HARDCODED_ROLE = "company";

export const REQUIRED_FIELDS = {
  token: HARDCODED_TOKEN,
  role: HARDCODED_ROLE,
  user_id: "800002269",
  company_id: 500001290,
  imp_session_id: "13064|8257622c-1c29-4097-86ec-fb1bf9c7b745",
};

export const RATE_LIMIT = {
  maxRequests: 10, // Max requests per window
  windowMs: 60000, // 1 minute window
  retryDelay: 1000, // 1 second between retries
  maxRetries: 3
}; 

let requestCount = 0;
let lastResetTime = Date.now();

export async function callIMPApi(endpoint: string, additionalParams: Record<string, any> = {}) {
  // Rate limiting check
  const now = Date.now();
  if (now - lastResetTime > RATE_LIMIT.windowMs) {
    requestCount = 0;
    lastResetTime = now;
  }
  
  if (requestCount >= RATE_LIMIT.maxRequests) {
    const waitTime = RATE_LIMIT.windowMs - (now - lastResetTime);
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds before making another request.`);
  }
  
  requestCount++;

  const params = new URLSearchParams();
  
  // Add all required fields
  Object.entries(REQUIRED_FIELDS).forEach(([key, value]) => {
    params.append(key, String(value));
  });
  
  // Add additional parameters
  Object.entries(additionalParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });

  const url = `${BASE_URL}${endpoint}?${params}`;

  // Retry logic with exponential backoff
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= RATE_LIMIT.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "MCP-Client/1.0"
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      // Handle specific error codes
      if (response.status === 529) {
        throw new Error("Server is overloaded. Please try again in a few moments.");
      }
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : RATE_LIMIT.retryDelay * (attempt + 1);
        throw new Error(`Rate limited by server. Please wait ${Math.ceil(waitTime / 1000)} seconds.`);
      }
      
      if (response.status === 503) {
        throw new Error("Service temporarily unavailable. Please try again later.");
      }

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Add delay between successful requests to prevent overwhelming the server
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return data;
      
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.name === 'AbortError') {
        throw new Error("Request timed out. Please try again.");
      }
      
      if (error.message.includes("Server is overloaded") || 
          error.message.includes("Rate limited") ||
          error.message.includes("Service temporarily unavailable")) {
        if (attempt < RATE_LIMIT.maxRetries) {
          const delay = RATE_LIMIT.retryDelay * Math.pow(2, attempt); // Exponential backoff
          console.log(`Retrying request in ${delay}ms (attempt ${attempt + 1}/${RATE_LIMIT.maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // For other errors, don't retry
      break;
    }
  }
  
  throw lastError || new Error("Request failed after all retry attempts");
} 

export function registerUtilityTools(server: McpServer) {
  server.tool(
    "calculate",
    "Perform basic mathematical calculations",
    {
      expression: z.string().describe("Mathematical expression to evaluate (e.g., '2 + 3 * 4')"),
    },
    async ({ expression }) => {
      try {
        const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
        const result = Function(`"use strict"; return (${sanitized})`)();
        return { content: [{ type: "text", text: `${expression} = ${result}` }] };
      } catch {
        return { content: [{ type: "text", text: `Error calculating "${expression}": Invalid expression` }] };
      }
    }
  );

  server.tool(
    "analyze-text",
    "Analyze text for word count, character count, and readability",
    {
      text: z.string().describe("Text to analyze"),
    },
    async ({ text }) => {
      const wordCount = text.trim().split(/\s+/).length;
      const charCount = text.length;
      const charCountNoSpaces = text.replace(/\s/g, '').length;
      const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim()).length;

      const avgWordsPerSentence = sentenceCount ? (wordCount / sentenceCount).toFixed(1) : "0";
      const avgCharsPerWord = wordCount ? (charCountNoSpaces / wordCount).toFixed(1) : "0";

      return {
        content: [
          {
            type: "text",
            text: `Text Analysis Results:\n- Word count: ${wordCount}\n- Character count: ${charCount} (${charCountNoSpaces} without spaces)\n- Sentence count: ${sentenceCount}\n- Average words per sentence: ${avgWordsPerSentence}\n- Average characters per word: ${avgCharsPerWord}`,
          },
        ],
      };
    }
  );

  server.tool(
    "date-utility",
    "Perform date calculations, validation, and formatting operations. Use 'parse' operation for natural language expressions like 'last 30 days', 'this month', 'Q1 2025'",
    {
      operation: z.enum(['validate', 'format', 'add', 'subtract', 'difference', 'parse']).describe("Type of date operation to perform"),
      date: z.string().optional().describe("Date to work with (YYYY-MM-DD format or natural language)"),
      format: z.string().optional().describe("Output format for date formatting (e.g., 'MM/DD/YYYY', 'DD-MM-YYYY', 'ISO')"),
      amount: z.number().optional().describe("Number of units to add/subtract"),
      unit: z.enum(['days', 'weeks', 'months', 'years']).optional().describe("Time unit for add/subtract operations"),
      date2: z.string().optional().describe("Second date for difference calculation"),
    },
    async ({ operation, date, format, amount, unit, date2 }) => {
      try {
        const today = new Date();
        
        // Helper function to interpret natural language date expressions using structured logic
        const interpretDateExpression = (expression: string): { start: Date, end: Date } => {
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth();
          const currentDate = now.getDate();
          
          // Normalize the expression
          const expr = expression.toLowerCase().trim();
          
          // Create a structured interpretation based on common patterns
          const dateInterpretation = {
            // Relative time expressions
            'today': { start: now, end: now },
            'yesterday': { 
              start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
              end: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
            },
            'tomorrow': { 
              start: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
              end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
            },
            
            // Week expressions
            'this week': {
              start: getWeekStart(now),
              end: getWeekEnd(now)
            },
            'last week': {
              start: getWeekStart(addDays(now, -7)),
              end: getWeekEnd(addDays(now, -7))
            },
            'next week': {
              start: getWeekStart(addDays(now, 7)),
              end: getWeekEnd(addDays(now, 7))
            },
            
            // Month expressions
            'this month': {
              start: new Date(currentYear, currentMonth, 1),
              end: new Date(currentYear, currentMonth + 1, 0)
            },
            'last month': {
              start: new Date(currentYear, currentMonth - 1, 1),
              end: new Date(currentYear, currentMonth, 0)
            },
            'next month': {
              start: new Date(currentYear, currentMonth + 1, 1),
              end: new Date(currentYear, currentMonth + 2, 0)
            },
            
            // Quarter expressions
            'this quarter': getQuarterRange(currentYear, getCurrentQuarter(now)),
            'last quarter': getLastQuarterRange(now),
            'next quarter': getNextQuarterRange(now),
            
            // Year expressions
            'this year': {
              start: new Date(currentYear, 0, 1),
              end: new Date(currentYear, 11, 31)
            },
            'last year': {
              start: new Date(currentYear - 1, 0, 1),
              end: new Date(currentYear - 1, 11, 31)
            },
            'next year': {
              start: new Date(currentYear + 1, 0, 1),
              end: new Date(currentYear + 1, 11, 31)
            }
          };
          
          // Check for exact matches first
          if (expr in dateInterpretation) {
            return dateInterpretation[expr as keyof typeof dateInterpretation];
          }
          
          // Handle "last X days/weeks/months" patterns
          if (expr.includes('last') && expr.includes('days')) {
            const days = extractNumber(expr) || 30;
            return {
              start: addDays(now, -days),
              end: now
            };
          }
          
          if (expr.includes('last') && expr.includes('weeks')) {
            const weeks = extractNumber(expr) || 1;
            return {
              start: addDays(now, -weeks * 7),
              end: now
            };
          }
          
          if (expr.includes('last') && expr.includes('months')) {
            const months = extractNumber(expr) || 1;
            return {
              start: addMonths(now, -months),
              end: now
            };
          }
          
          // Handle "next X days/weeks/months" patterns
          if (expr.includes('next') && expr.includes('days')) {
            const days = extractNumber(expr) || 30;
            return {
              start: now,
              end: addDays(now, days)
            };
          }
          
          // Handle quarter expressions like "Q1 2025"
          const quarterMatch = expr.match(/q([1-4])\s*(\d{4})/);
          if (quarterMatch) {
            const quarter = parseInt(quarterMatch[1]);
            const year = parseInt(quarterMatch[2]);
            return getQuarterRange(year, quarter);
          }
          
          // Handle year expressions like "2024"
          const yearMatch = expr.match(/^(\d{4})$/);
          if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            return {
              start: new Date(year, 0, 1),
              end: new Date(year, 11, 31)
            };
          }
          
          // Try to parse as a regular date
          const singleDate = new Date(expression);
          if (!isNaN(singleDate.getTime())) {
            return { start: singleDate, end: singleDate };
          }
          
          // If all else fails, use Claude's understanding through contextual clues
          throw new Error(`Unable to interpret date expression: "${expression}". Please provide a more specific date expression.`);
        };
        
        // Helper functions
        const addDays = (date: Date, days: number): Date => {
          const result = new Date(date);
          result.setDate(result.getDate() + days);
          return result;
        };
        
        const addMonths = (date: Date, months: number): Date => {
          const result = new Date(date);
          result.setMonth(result.getMonth() + months);
          return result;
        };
        
        const getWeekStart = (date: Date): Date => {
          const result = new Date(date);
          const day = result.getDay();
          const diff = result.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
          result.setDate(diff);
          return result;
        };
        
        const getWeekEnd = (date: Date): Date => {
          const start = getWeekStart(date);
          return addDays(start, 6);
        };
        
        const getCurrentQuarter = (date: Date): number => {
          return Math.floor(date.getMonth() / 3) + 1;
        };
        
        const getQuarterRange = (year: number, quarter: number) => {
          const startMonth = (quarter - 1) * 3;
          return {
            start: new Date(year, startMonth, 1),
            end: new Date(year, startMonth + 3, 0)
          };
        };
        
        const getLastQuarterRange = (date: Date) => {
          const currentQuarter = getCurrentQuarter(date);
          const lastQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
          const year = currentQuarter === 1 ? date.getFullYear() - 1 : date.getFullYear();
          return getQuarterRange(year, lastQuarter);
        };
        
        const getNextQuarterRange = (date: Date) => {
          const currentQuarter = getCurrentQuarter(date);
          const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
          const year = currentQuarter === 4 ? date.getFullYear() + 1 : date.getFullYear();
          return getQuarterRange(year, nextQuarter);
        };
        
        const extractNumber = (str: string): number | null => {
          const match = str.match(/\d+/);
          return match ? parseInt(match[0]) : null;
        };
        
        const formatDate = (date: Date, formatStr?: string): string => {
          if (!formatStr || formatStr === 'ISO') {
            return date.toISOString().split('T')[0];
          }
          
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          
          return formatStr
            .replace('YYYY', String(year))
            .replace('MM', month)
            .replace('DD', day);
        };
        
        const parseDate = (dateStr: string): Date | null => {
          // Try ISO format first
          const isoDate = new Date(dateStr);
          if (!isNaN(isoDate.getTime())) return isoDate;
          
          // Try natural language
          const lowerDate = dateStr.toLowerCase();
          if (lowerDate === 'today') return today;
          if (lowerDate === 'yesterday') return addDays(today, -1);
          if (lowerDate === 'tomorrow') return addDays(today, 1);
          
          return null;
        };
  
        // Handle operations
        switch (operation) {
          case 'parse':
            if (!date) {
              return { content: [{ type: "text", text: "Error: Date expression required for parsing" }] };
            }
            
            // First try simple date parsing
            const simpleDate = parseDate(date);
            if (simpleDate) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    input: date,
                    parsed_date: formatDate(simpleDate),
                    components: {
                      year: simpleDate.getFullYear(),
                      month: simpleDate.getMonth() + 1,
                      day: simpleDate.getDate(),
                      day_of_week: simpleDate.getDay(),
                      day_name: simpleDate.toLocaleDateString('en-US', { weekday: 'long' }),
                      month_name: simpleDate.toLocaleDateString('en-US', { month: 'long' })
                    },
                    human_readable: simpleDate.toLocaleDateString(),
                    iso_string: simpleDate.toISOString()
                  }, null, 2)
                }]
              };
            }
            
            // Try natural language interpretation
            const { start: startDate, end: endDate } = interpretDateExpression(date);
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  expression: date,
                  start_date: formatDate(startDate),
                  end_date: formatDate(endDate),
                  start_date_formatted: startDate.toLocaleDateString(),
                  end_date_formatted: endDate.toLocaleDateString(),
                  days_duration: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
                  interpretation: `Interpreted "${date}" as date range from ${formatDate(startDate)} to ${formatDate(endDate)}`
                }, null, 2)
              }]
            };
  
          // ... rest of the operations remain the same
          case 'validate':
            if (!date) {
              return { content: [{ type: "text", text: "Error: Date parameter required for validation" }] };
            }
            const parsedDate = parseDate(date);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  date: date,
                  is_valid: parsedDate !== null,
                  parsed_date: parsedDate ? formatDate(parsedDate) : null,
                  error: parsedDate === null ? "Could not parse date" : null
                }, null, 2)
              }]
            };
  
          // ... other cases remain the same
          default:
            return { content: [{ type: "text", text: "Error: Unknown operation" }] };
        }
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );


}

export function registerBusinessTools(server: McpServer) {
  server.tool(
    "searchProductList",
    "Search for products by name, SKU, or description. Use this for general product searches or when looking for multiple products. Returns a list of matching products that is to be shown to use if asked for list of products.",
    {
      search: z.string().describe("Search query for product name, SKU, or description"),
      mode: z.enum(["lite", "full"]).default("lite").describe("Response mode - lite for basic info, full for detailed info"),
      fulfilment_origin_id: z.number().default(6).describe("Fulfilment origin ID"),
      page: z.number().optional().describe("Page number for pagination"),
      take: z.number().optional().describe("Number of items per page"),
    },
    async ({ search, mode, fulfilment_origin_id, page, take }) => {
      try {
        const data = await callIMPApi("/api/company_product_and_service_list", {
          search,
          mode,
          fulfilment_origin_id,
          ...(page && { page }),
          ...(take && { take })
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching products: ${data.message}` }] };
        }

        const products = data.result || [];
        
        // Format products as clean array for TABLE rendering in UI
        const productArray = products.map((product: any) => ({
          "Product Name": product.product_name || product.name,
          "SKU": product.sku || product.product_sku || '-',
          "Category": product.category || product.product_category || '-',
          "Price": product.selling_price ? `$${parseFloat(product.selling_price).toFixed(2)}` : '-',
          "Status": product.status || product.product_status || 'Active'
        }));

        // Return combined message: table + summary
        const summary = `Found ${products.length} product${products.length !== 1 ? 's' : ''} matching "${search}".`;
        
        return {
          content: [
            {
              type: "text",
              text: `<table>${JSON.stringify(productArray)}</table>\n\n${summary}`
            }
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Get Product Details Tool
  server.tool(
    "getProductDetails",
    "Get detailed product information using product ID  from the company database",
    {
      product_id: z.number().describe("Product ID number"),
      token_check: z.boolean().default(false).describe("Whether to perform token check"),
    },
    async ({ product_id,  token_check = false }) => {
      try {
        const data = await callIMPApi("/api/get_company_product", {
          product_id,
         
          token_check
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching product details: ${data.message}` }] };
        }
  
        return {
          content: [
            {
              type: "text",
              text: `Product Details (ID: ${product_id}):\n\n${JSON.stringify(data.result || data.data || data, null, 2)}\n\n📋 This product information includes detailed specifications and customer-specific data.`,
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Search Estimate List Tool
  server.tool(
    "searchEstimateList",
    "Get list of estimates with optional filtering by date range, search term, and status",
    {
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
      search: z.string().optional().describe("Search term for estimate number, customer name, etc."),
      status: z.string().optional().describe("Filter by status: 'open', 'closed', 'accepted', 'rejected', 'draft', 'sent', etc."),
      take: z.number().default(25).describe("Number of estimates to return (default: 25)"),
      skip: z.number().optional().describe("Number of estimates to skip for pagination"),
    },
    async ({ from_date, to_date, search, status, take = 25, skip }) => {
      try {
        // Enhanced date cleaning and validation
        const cleanDate = (date: string | undefined): string | undefined => {
          if (!date) return undefined;
          return date.trim();
        };
  
        let cleanFromDate = cleanDate(from_date);
        let cleanToDate = cleanDate(to_date);
  
        // Enhanced date validation function
        const validateDate = (dateStr: string): { isValid: boolean; error?: string; parsedDate?: Date } => {
          // Check ISO format first
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return { isValid: true, parsedDate: date };
            }
          }
          
          // Check other common formats
          const formats = [
            /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY or M/D/YYYY
            /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-DD-YYYY or M-D-YYYY
            /^\d{4}\/\d{1,2}\/\d{1,2}$/, // YYYY/MM/DD or YYYY/M/D
          ];
          
          for (const format of formats) {
            if (format.test(dateStr)) {
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                return { isValid: true, parsedDate: date };
              }
            }
          }
          
          return { 
            isValid: false, 
            error: `Invalid date format: ${dateStr}. Please use YYYY-MM-DD, MM/DD/YYYY, or MM-DD-YYYY format.` 
          };
        };
  
        // Validate and convert dates
        if (cleanFromDate) {
          const fromValidation = validateDate(cleanFromDate);
          if (!fromValidation.isValid) {
            return { content: [{ type: "text", text: fromValidation.error! }] };
          }
          // Convert to ISO format for API
          cleanFromDate = fromValidation.parsedDate!.toISOString().split('T')[0];
        }
        
        if (cleanToDate) {
          const toValidation = validateDate(cleanToDate);
          if (!toValidation.isValid) {
            return { content: [{ type: "text", text: toValidation.error! }] };
          }
          // Convert to ISO format for API
          cleanToDate = toValidation.parsedDate!.toISOString().split('T')[0];
        }
  
        const data = await SHARED_UTILITIES.api.estimates.getList({
          from_date: cleanFromDate,
          to_date: cleanToDate,
          search,
          status,
          take,
          skip
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching estimates: ${data.message}` }] };
        }

        const estimates = data.result || [];
        
        // Format estimates as clean array for TABLE rendering in UI
        const estimateArray = estimates.map((estimate: any) => ({
          "Estimate #": estimate.custom_quotation_number,
          "Customer": estimate.customer_name,
          "Date": estimate.create_date,
          "Amount": `$${parseFloat(estimate.quotation_total || 0).toFixed(2)}`,
          "Status": estimate.status_name,
          "Job": estimate.job_name,
          "Location": estimate.job_location
        }));

        // Return combined message: table + summary
        const summary = `Found ${estimates.length} estimates${cleanFromDate && cleanToDate ? ` from ${cleanFromDate} to ${cleanToDate}` : ''}.`;
        
        return {
          content: [
            {
              type: "text",
              text: `<table>${JSON.stringify(estimateArray)}</table>\n\n${summary}`,
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  
  
  // Search Invoice List Tool
  server.tool(
    "searchInvoiceList",
    "Get list of invoices with optional filtering by date range, search term, and status. When user asks for 'all invoices', 'complete list', 'full data', or similar requests, set get_all to true to fetch all records in a single request.",
    {
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
      search: z.string().optional().describe("Search term for invoice number, customer name, etc."),
      status: z.string().optional().describe("Filter by status: 'open', 'paid', 'overdue', 'cancelled', etc."),
      take: z.number().default(25).describe("Number of invoices to return (default: 25)"),
      skip: z.number().optional().describe("Number of invoices to skip for pagination"),
      get_all: z.boolean().default(false).describe("Set to true when user requests all data, complete list, or full records. This will fetch all records in a single request."),
    },
    async ({ from_date, to_date, search, status, take = 25, skip, get_all = false }) => {
      try {
        // Enhanced date cleaning and validation
        const cleanDate = (date: string | undefined): string | undefined => {
          if (!date) return undefined;
          return date.trim();
        };
  
        let cleanFromDate = cleanDate(from_date);
        let cleanToDate = cleanDate(to_date);
  
        // Enhanced date validation function
        const validateDate = (dateStr: string): { isValid: boolean; error?: string; parsedDate?: Date } => {
          // Check ISO format first
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return { isValid: true, parsedDate: date };
            }
          }
          
          // Check other common formats
          const formats = [
            /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY or M/D/YYYY
            /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-DD-YYYY or M-D-YYYY
            /^\d{4}\/\d{1,2}\/\d{1,2}$/, // YYYY/MM/DD or YYYY/M/D
          ];
          
          for (const format of formats) {
            if (format.test(dateStr)) {
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                return { isValid: true, parsedDate: date };
              }
            }
          }
          
          return { 
            isValid: false, 
            error: `Invalid date format: ${dateStr}. Please use YYYY-MM-DD, MM/DD/YYYY, or MM-DD-YYYY format.` 
          };
        };
  
        // Validate and convert dates
        if (cleanFromDate) {
          const fromValidation = validateDate(cleanFromDate);
          if (!fromValidation.isValid) {
            return { content: [{ type: "text", text: fromValidation.error! }] };
          }
          // Convert to ISO format for API
          cleanFromDate = fromValidation.parsedDate!.toISOString().split('T')[0];
          console.log(`🔍 searchInvoiceList: Original from_date: "${from_date}" -> Cleaned: "${cleanFromDate}"`);
        }
        
        if (cleanToDate) {
          const toValidation = validateDate(cleanToDate);
          if (!toValidation.isValid) {
            return { content: [{ type: "text", text: toValidation.error! }] };
          }
          // Convert to ISO format for API
          cleanToDate = toValidation.parsedDate!.toISOString().split('T')[0];
          console.log(`🔍 searchInvoiceList: Original to_date: "${to_date}" -> Cleaned: "${cleanToDate}"`);
        }
  
        // First get total records if get_all is true
        let totalRecords = 0;
        if (get_all) {
          const initialData = await callIMPApi("/api/invoice_list", {
            ...(cleanFromDate && { from_date: cleanFromDate }),
            ...(cleanToDate && { to_date: cleanToDate }),
            ...(search && { search }),
            take: 1,
            page: 1
          });
  
          if (!initialData.success) {
            return { content: [{ type: "text", text: `Error fetching invoice count: ${initialData.message}` }] };
          }
  
          totalRecords = initialData.total_record || 0;
        }
  
        // Now fetch the actual data
        const params: Record<string, any> = {
          ...(cleanFromDate && { from_date: cleanFromDate }),
          ...(cleanToDate && { to_date: cleanToDate }),
          ...(search && { search }),
          ...(status && { status }),
          take: get_all ? totalRecords : take,
          ...(skip && { skip })
        };

        const data = await SHARED_UTILITIES.api.invoices.getList(params);
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching invoices: ${data.message}` }] };
        }
  
        const invoices = data.result || [];
        
        // Format invoices as clean array for TABLE rendering in UI
        // This array will be rendered as an interactive table by the frontend
        const invoiceArray = invoices.map((invoice: any) => ({
          "Invoice #": invoice.custom_invoice_number,
          "Customer": invoice.customer_name,
          "Date": invoice.invoice_date,
          "Amount": `$${parseFloat(invoice.grand_total || 0).toFixed(2)}`,
          "Status": invoice.status_name,
          "Email": invoice.customer_email,
          "Phone": invoice.customer_phone
        }));

        // Return combined message: table + summary
        const summary = `Found ${invoices.length} invoices${cleanFromDate && cleanToDate ? ` from ${cleanFromDate} to ${cleanToDate}` : ''}.`;
        
        return {
          content: [
            {
              type: "text",
              text: `<table>${JSON.stringify(invoiceArray)}</table>\n\n${summary}`
            }
          ]
        };
  
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Search Customer List Tool
  server.tool(
    "searchCustomerList",
    "Get list of customers with optional search filtering",
    {
      search: z.string().optional().describe("Search term for customer name, email, phone, or company"),
      take: z.number().default(25).describe("Number of customers to return (default: 25)"),
      skip: z.number().optional().describe("Number of customers to skip for pagination"),
    },
    async ({ search, take = 25, skip }) => {
      try {
        const data = await SHARED_UTILITIES.api.customers.getList({
          search,
          take,
          skip
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching customers: ${data.message}` }] };
        }
  
        const customers = data.result || data.data || [];
        // Ensure each customer object has id and customer_name at the top level
        const normalizedCustomers = customers.map((customer: any) => ({
          id: customer.customer_id || customer.id,
          customer_name: customer.customer_name || customer.name,
          ...customer
        }));
        
        // If search term is provided, try to find exact matches first
        if (search && normalizedCustomers.length > 1) {
          const searchLower = search.toLowerCase().trim();
          
          // Look for exact name matches first
          const exactNameMatches = normalizedCustomers.filter((customer: any) => {
            const customerName = (customer.customer_name || customer.name || '').toLowerCase();
            const companyName = (customer.company_name || customer.business_name || '').toLowerCase();
            return customerName === searchLower || companyName === searchLower;
          });
          
          if (exactNameMatches.length === 1) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ result: exactNameMatches[0] })
                },
              ],
            };
          }
          
          // If no exact match, look for partial name matches
          const partialNameMatches = normalizedCustomers.filter((customer: any) => {
            const customerName = (customer.customer_name || customer.name || '').toLowerCase();
            const companyName = (customer.company_name || customer.business_name || '').toLowerCase();
            return customerName.includes(searchLower) || companyName.includes(searchLower);
          });
          
          if (partialNameMatches.length === 1) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ result: partialNameMatches[0] })
                },
              ],
            };
          }
          
          // If multiple matches, show them but indicate it's not exact
          if (partialNameMatches.length > 1) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ result: partialNameMatches })
                },
              ],
            };
          }
        }
  
        // Format customers as clean array for TABLE rendering in UI
        const customerArray = normalizedCustomers.map((customer: any) => ({
          "Name": customer.customer_name || customer.name,
          "Email": customer.email || customer.customer_email,
          "Phone": customer.phone || customer.customer_phone,
          "Company": customer.company_name || customer.business_name || '-',
          "Status": customer.customer_status || customer.status || 'Active'
        }));

        // Return combined message: table + summary
        const summary = `Found ${normalizedCustomers.length} customer${normalizedCustomers.length !== 1 ? 's' : ''}.`;
        
        return {
          content: [
            {
              type: "text",
              text: `<table>${JSON.stringify(customerArray)}</table>\n\n${summary}`
            }
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Find Customer by Exact Name Tool
  server.tool(
    "findCustomerByName",
    "Find a specific customer by exact name match",
    {
      customer_name: z.string().describe("Exact customer name to search for"),
    },
    async ({ customer_name }) => {
      try {
        // First, search for customers with the name
        const searchData = await callIMPApi("/api/customer_list", {
          search: customer_name,
          take: 50
        });
  
        if (!searchData.success) {
          return { content: [{ type: "text", text: `Error searching for customer: ${searchData.message}` }] };
        }
  
        const customers = searchData.result || searchData.data || [];
        const searchLower = customer_name.toLowerCase().trim();
        
        // Look for exact name matches
        const exactMatches = customers.filter((customer: any) => {
          const customerName = (customer.customer_name || customer.name || '').toLowerCase();
          const companyName = (customer.company_name || customer.business_name || '').toLowerCase();
          return customerName === searchLower || companyName === searchLower;
        });
        
        if (exactMatches.length === 1) {
          return {
            content: [{ type: "text", text: JSON.stringify({ result: exactMatches[0] }) }]
          };
        }
        
        if (exactMatches.length > 1) {
          return {
            content: [{ type: "text", text: JSON.stringify({ result: exactMatches }) }]
          };
        }
        
        // If no exact match, look for partial matches
        const partialMatches = customers.filter((customer: any) => {
          const customerName = (customer.customer_name || customer.name || '').toLowerCase();
          const companyName = (customer.company_name || customer.business_name || '').toLowerCase();
          return customerName.includes(searchLower) || companyName.includes(searchLower);
        });
        
        if (partialMatches.length === 0) {
          return {
            content: [{ type: "text", text: `No customers found matching "${customer_name}".` }]
          };
        }
        
        if (partialMatches.length === 1) {
          return {
            content: [{ type: "text", text: JSON.stringify({ result: partialMatches[0] }) }]
          };
        }
        
        return {
          content: [{ type: "text", text: JSON.stringify({ result: partialMatches }) }]
        };
  
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Search Customer Address Tool
  server.tool(
    "searchCustomerAddress",
    "Get customer address information by customer ID with optional address company and address ID filters",
    {
      customer_id: z.string().describe("Customer ID to get address information for"),
      address_company_id: z.string().optional().describe("Address company ID filter"),
      address_id: z.string().optional().describe("Specific address ID (remove to get primary/register address for customer)"),
    },
    async ({ customer_id, address_company_id, address_id }) => {
      try {
        const data = await callIMPApi("/api/get_customer_address", {
          customer_id,
          ...(address_company_id && { address_company_id }),
          ...(address_id && { address_id })
        }) as any;
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching customer address: ${data.message}` }] };
        }
  
        const addresses = data.result || data.data || [];
        if (!Array.isArray(addresses) || addresses.length === 0) {
          return { content: [{ type: "text", text: `No addresses found for customer ID "${customer_id}".` }] };
        }
  
        // Format each address in a readable way
        const formatted = addresses.map((addr: any, i: number) => {
          const label = addr.address_type_name || addr.type || (i === 0 ? "Registered/Primary Address" : `Service Address ${i}`);
          const lines = [
            addr.house_no,
            addr.landmark,
            addr.city,
            addr.state,
            addr.zip,
            addr.country
          ].filter(Boolean).join(", ");
          return `${label}:
  ${lines}`;
        }).join("\n\n");
  
        return {
          content: [
            {
              type: "text",
              text: `[DISPLAY_VERBATIM]${formatted}`,
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Get Estimate by Custom Number Tool
  server.tool(
    "getEstimateByCustomNumber",
    "Get detailed estimate information using customer-facing estimate number (e.g., '25-3454'). This tool automatically searches for the custom number and retrieves full details.",
    {
      custom_estimate_number: z.string().describe("Customer-facing estimate/quotation number (e.g., '25-3454')"),
    },
    async ({ custom_estimate_number }) => {
      try {
        const searchData = await callIMPApi("/api/estimate/list", {
          search: custom_estimate_number,
          take: 10
        });
  
        if (!searchData.success) {
          return { content: [{ type: "text", text: `Error searching for estimate: ${searchData.message}` }] };
        }
  
        const estimates = searchData.result || [];
        const matchingEstimate = estimates.find((est: any) =>
          [est.estimate_number, est.quotation_number, est.custom_number, est.custom_quotation_number, est.ext_po_number]
            .map(val => String(val))
            .includes(custom_estimate_number)
        );
  
        if (!matchingEstimate) {
          return {
            content: [{
              type: "text",
              text: `Found ${estimates.length} estimates but no exact match for "${custom_estimate_number}". Please check the number.`
            }]
          };
        }
  
        const quotationId = matchingEstimate.quotation_id || matchingEstimate.estimate_id || matchingEstimate.id;
        if (!quotationId) {
          return {
            content: [{
              type: "text",
              text: `Estimate found but missing internal ID. Debug:\n\n${JSON.stringify(matchingEstimate, null, 2)}`
            }]
          };
        }
  
        const detailData = await callIMPApi("/api/view_quotation", {
          quotation_id: String(quotationId)
        });
  
        if (!detailData.success) {
          return { content: [{ type: "text", text: `Error fetching estimate details: ${detailData.message}` }] };
        }
  
        const result = detailData.result || detailData.data || detailData;
        
        // Format address parts
        const addressParts = [
          result.customer_house_no,
          result.customer_landmark,
          result.customer_city,
          result.customer_state,
          result.customer_zip,
          result.customer_country
        ].filter(Boolean);
  
        // Get all products with their details
        const products = Array.isArray(result.quotation_products) ? result.quotation_products.map((product: any) => ({
          name: product.product_title,
          description: product.product_desc || product.company_service_details?.company_service_description,
          quantity: product.product_qty,
          unit_price: parseFloat(product.company_service_details?.product_price || 0).toFixed(2),
          warehouse: product.ware_house_name || null,
          sku: product.product_sku || null,
          category: product.product_category || null
        })) : [];
        
        const formattedResponse = {
          estimate_details: {
            number: custom_estimate_number,
            status: result.status_name,
            created_date: result.created_at ? new Date(result.created_at).toLocaleDateString() : null,
            total_amount: parseFloat(result.quotation_total || 0).toFixed(2),
            tax_amount: parseFloat(result.quotation_tax || 0).toFixed(2),
            total_with_tax: (parseFloat(result.quotation_total || 0) + parseFloat(result.quotation_tax || 0)).toFixed(2),
            valid_until: result.valid_until || null,
            prepared_by: result.prepared_by || null
          },
          products: products,
          product_count: products.length,
          customer_info: {
            name: result.customer_name,
            email: result.customer_email,
            phone: result.customer_phone,
            address: addressParts.join(', '),
            id: result.customer_id
          },
          documents: {
            pdf_url: result.quotation_pdf || null
          },
          context: {
            estimate_id: quotationId,
            search_term: custom_estimate_number
          }
        };
  
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              formatted: formattedResponse,
              raw: result
            }, null, 2)
          }]
        };
  
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Get Invoice by Custom Number Tool
  server.tool(
    "getInvoiceByCustomNumber",
    "Get detailed invoice information using customer-facing invoice number. This tool automatically searches for the custom number and retrieves full details.",
    {
      custom_invoice_number: z.string().describe("Customer-facing invoice number"),
    },
    async ({ custom_invoice_number }) => {
      try {
        const searchData = await callIMPApi("/api/invoice_list", {
          search: custom_invoice_number,
          take: 10
        });
  
        if (!searchData.success) {
          return { content: [{ type: "text", text: `Error searching for invoice: ${searchData.message}` }] };
        }
  
        const invoices = searchData.result || [];
        const matchingInvoice = invoices.find((inv: any) =>
          [inv.invoice_number, inv.custom_number, inv.ext_po_number]
            .map(val => String(val))
            .includes(custom_invoice_number)
        );
  
        if (!matchingInvoice) {
          return {
            content: [{
              type: "text",
              text: `Found ${invoices.length} invoices but no exact match for "${custom_invoice_number}". Please check the number.`
            }]
          };
        }
  
        const invoiceId = matchingInvoice.invoice_id || matchingInvoice.id;
        if (!invoiceId) {
          return {
            content: [{
              type: "text",
              text: `Invoice found but missing internal ID. Debug:\n\n${JSON.stringify(matchingInvoice, null, 2)}`
            }]
          };
        }
  
        const detailData = await callIMPApi("/api/view_invoice", {
          invoice_id: String(invoiceId)
        });
  
        if (!detailData.success) {
          return { content: [{ type: "text", text: `Error fetching invoice details: ${detailData.message}` }] };
        }
  
        const result = detailData.result || detailData.data || detailData;
        
        // Format address parts
        const addressParts = [
          result.customer_house_no,
          result.customer_landmark,
          result.customer_city,
          result.customer_state,
          result.customer_zip,
          result.customer_country
        ].filter(Boolean);
  
        // Get all products with their details
        const products = Array.isArray(result.invoice_products) ? result.invoice_products.map((product: any) => ({
          name: product.product_title,
          description: product.product_desc || product.company_service_details?.company_service_description,
          quantity: product.product_qty,
          unit_price: parseFloat(product.company_service_details?.product_price || 0).toFixed(2),
          warehouse: product.ware_house_name || null,
          sku: product.product_sku || null,
          category: product.product_category || null
        })) : [];
        
        const formattedResponse = {
          invoice_details: {
            number: custom_invoice_number,
            status: result.status_name,
            created_date: result.created_at ? new Date(result.created_at).toLocaleDateString() : null,
            total_amount: parseFloat(result.invoice_total || 0).toFixed(2),
            tax_amount: parseFloat(result.invoice_tax || 0).toFixed(2),
            total_with_tax: (parseFloat(result.invoice_total || 0) + parseFloat(result.invoice_tax || 0)).toFixed(2),
            due_date: result.due_date || null,
            prepared_by: result.prepared_by || null
          },
          products: products,
          product_count: products.length,
          customer_info: {
            name: result.customer_name,
            email: result.customer_email,
            phone: result.customer_phone,
            address: addressParts.join(', '),
            id: result.customer_id
          },
          documents: {
            pdf_url: result.invoice_pdf || null
          },
          context: {
            invoice_id: invoiceId,
            search_term: custom_invoice_number
          }
        };
  
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              formatted: formattedResponse,
              raw: result
            }, null, 2)
          }]
        };
  
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Get Warehouse List Tool
  server.tool(
    "getWarehouseList",
    "Get list of warehouses with optional filtering for warehouse management and serial number tracking",
    {
      is_warehouse_managed: z.boolean().optional().describe("Filter for warehouses that are warehouse managed"),
      is_serial_number_managed: z.boolean().optional().describe("Filter for warehouses that are serial number managed"),
      with_address: z.number().optional().describe("Filter warehouses by address ID"),
    },
    async ({ is_warehouse_managed, is_serial_number_managed, with_address }) => {
      try {
        const data = await callIMPApi("/api/inventory/warehouse_dropdown_list", {
          ...(is_warehouse_managed !== undefined && { is_warehouse_managed }),
          ...(is_serial_number_managed !== undefined && { is_serial_number_managed }),
          ...(with_address && { with_address })
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching warehouses: ${data.message}` }] };
        }
  
        const warehouses = data.result || data.data || [];
        
        const formattedResponse = {
          total_warehouses: warehouses.length,
          warehouses: warehouses.map((warehouse: any) => ({
            id: warehouse.id,
            name: warehouse.name,
            code: warehouse.code,
            is_warehouse_managed: warehouse.is_warehouse_managed,
            is_serial_number_managed: warehouse.is_serial_number_managed,
            address: warehouse.address || null,
            status: warehouse.status || null
          }))
        };
  
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              formatted: formattedResponse,
              raw: warehouses
            }, null, 2)
          }]
        };
  
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Get Stock List Tool
  server.tool(
    "getStockList",
    "Get list of stock items from a specific warehouse with optional filtering and search capabilities",
    {
      warehouse_id: z.number().describe("ID of the warehouse to get stock from"),
      search: z.string().optional().describe("Search term for product name, SKU, or description"),
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
      page: z.number().optional().describe("Page number for pagination"),
      take: z.number().optional().describe("Number of items per page"),
      only_available: z.boolean().optional().describe("Filter to show only available stock"),
      timezone: z.string().optional().describe("Timezone for date filtering (e.g., 'America/New_York')"),
      filter: z.object({
        brand: z.string().optional(),
        product_category: z.string().optional(),
        product_sub_category: z.string().optional(),
        vendor_id: z.string().optional(),
        supplier_id: z.string().optional(),
        purchase_date_range: z.string().optional(),
        manufacture_date_range: z.string().optional(),
        expiry_data_range: z.string().optional(),
        with_lot_info: z.boolean().optional(),
      }).optional(),
    },
    async ({ 
      warehouse_id, 
      search, 
      from_date, 
      to_date, 
      page, 
      take, 
      only_available, 
      timezone,
      filter 
    }) => {
      try {
        // Enhanced date cleaning and validation
        const cleanDate = (date: string | undefined): string | undefined => {
          if (!date) return undefined;
          return date.trim();
        };
  
        let cleanFromDate = cleanDate(from_date);
        let cleanToDate = cleanDate(to_date);
  
        // Enhanced date validation function
        const validateDate = (dateStr: string): { isValid: boolean; error?: string; parsedDate?: Date } => {
          // Check ISO format first
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return { isValid: true, parsedDate: date };
            }
          }
          
          // Check other common formats
          const formats = [
            /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY or M/D/YYYY
            /^\d{1,2}-\d{1,2}-\d{4}$/, // MM-DD-YYYY or M-D-YYYY
            /^\d{4}\/\d{1,2}\/\d{1,2}$/, // YYYY/MM/DD or YYYY/M/D
          ];
          
          for (const format of formats) {
            if (format.test(dateStr)) {
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                return { isValid: true, parsedDate: date };
              }
            }
          }
          
          return { 
            isValid: false, 
            error: `Invalid date format: ${dateStr}. Please use YYYY-MM-DD, MM/DD/YYYY, or MM-DD-YYYY format.` 
          };
        };
  
        // Validate and convert dates
        if (cleanFromDate) {
          const fromValidation = validateDate(cleanFromDate);
          if (!fromValidation.isValid) {
            return { content: [{ type: "text", text: fromValidation.error! }] };
          }
          // Convert to ISO format for API
          cleanFromDate = fromValidation.parsedDate!.toISOString().split('T')[0];
        }
        
        if (cleanToDate) {
          const toValidation = validateDate(cleanToDate);
          if (!toValidation.isValid) {
            return { content: [{ type: "text", text: toValidation.error! }] };
          }
          // Convert to ISO format for API
          cleanToDate = toValidation.parsedDate!.toISOString().split('T')[0];
        }
  
        const data = await callIMPApi("/api/inventory/stock_list", {
          warehouse_id,
          ...(search && { search }),
          ...(cleanFromDate && { from_date: cleanFromDate }),
          ...(cleanToDate && { to_date: cleanToDate }),
          ...(page && { page }),
          ...(take && { take }),
          ...(only_available !== undefined && { only_available }),
          ...(timezone && { timezone }),
          ...(filter && { filter: JSON.stringify(filter) })
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching stock list: ${data.message}` }] };
        }
  
        const stockItems = data.result || [];
        
        const formattedResponse = {
          total_items: data.total_record || 0,
          total_pages: data.total_page || 1,
          current_page: data.page || 1,
          warehouse_id,
          stock_items: stockItems.map((item: any) => ({
            id: item.product_service_id,
            product_name: item.product?.service_title,
            product_description: item.product?.service_description,
            quantities: {
              total: parseInt(item.qty_total) || 0,
              reserved: parseInt(item.qty_reserved) || 0,
              committed: parseInt(item.qty_committed) || 0,
              picked: parseInt(item.qty_picked) || 0,
              mark_sold: parseInt(item.qty_mark_sold) || 0,
              sold: parseInt(item.qty_sold) || 0,
              on_hand: parseInt(item.qty_on_hand_count) || 0,
              available: parseInt(item.qty_available_count) || 0
            },
            prices: {
              total_purchase: parseFloat(item.total_purchase_price) || 0,
              total_selling: parseFloat(item.total_selling_price) || 0,
              avg_purchase: parseFloat(item.avg_purchase_price) || 0,
              avg_selling: parseFloat(item.avg_selling_price) || 0
            },
            category: item.product_category,
            sub_category: item.product_sub_category,
            brand: item.brand,
            dates: {
              manufacture: item.manufacture_date,
              expiry: item.expiry_data,
              created: item.created_at,
              updated: item.updated_at
            }
          }))
        };
  
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              formatted: formattedResponse,
              raw: data
            }, null, 2)
          }]
        };
  
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  
  // Delivery Board Tool
  server.tool(
    "getDeliveryBoard",
    "Show all scheduled deliveries for a company or user. Use this tool to view and track what needs to be delivered and when, making it easy to plan and manage deliveries. Defaults to the current week if no date is provided. Useful for delivery planning, logistics, and daily delivery tracking.",
    {
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format, defaults to current week start)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format, defaults to current week end)"),
      board_id: z.string().default("0").describe("Board ID (default: '0')"),
    },
    async ({ from_date, to_date, board_id }) => {
      try {
        // Helper to get current week start (Monday) and end (Sunday)
        const getCurrentWeekRange = () => {
          const now = new Date();
          const day = now.getDay();
          const diffToMonday = (day === 0 ? -6 : 1) - day; // Monday as first day
          const monday = new Date(now);
          monday.setDate(now.getDate() + diffToMonday);
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);
          const toISO = (d: Date) => d.toISOString().split('T')[0];
          return { start: toISO(monday), end: toISO(sunday) };
        };
        const week = getCurrentWeekRange();
        const cleanDate = (date: string | undefined, fallback: string) => {
          if (!date) return fallback;
          return date.trim();
        };
        const params = {
          company_id: REQUIRED_FIELDS.company_id,
          user_id: REQUIRED_FIELDS.user_id,
          role: "company",
          token: REQUIRED_FIELDS.token,
          imp_session_id: REQUIRED_FIELDS.imp_session_id,
          from_date: cleanDate(from_date, week.start),
          to_date: cleanDate(to_date, week.end),
          board_id: board_id || "0"
        };
        const data = await callIMPApi("/api/boards/get_event_list", params);
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching delivery board: ${data.message}` }] };
        }
        const events = data.result || [];
        const formatted = events.map((event: any) => ({
          id: event.id,
          type: event.type,
          object_name: event.object_name,
          object_id: event.object_id,
          delivery_date: event.delivery_date,
          job_name: event.job_name,
          job_location: event.job_location,
          customer: {
            id: event.customer_id,
            name: event.customer_name,
            email: event.customer_email,
            phone: event.customer_phone,
            address: event.address
          },
          ext_po_number: event.ext_po_number,
          custom_number: event.custom_number,
          grand_total: event.grand_total,
          status: event.status,
          is_delivered: event.is_delivered,
          package_list: event.package_list
        }));
  
      
        // Return a single JSON object with formatted and raw data (no summary field)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                formatted: {
                  date_range: { from: params.from_date, to: params.to_date },
                  total_events: formatted.length,
                  events: formatted
                },
                raw: data
              }, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );

  // get task list tool
  server.tool(
    "getTaskList",
    "Get a list of tasks with optional filtering and pagination parameters. Use employee_name to filter tasks assigned to a specific employee (client-side filtering from all company tasks). For large datasets, use pagination to avoid response size limits.",
    {
      object_name: z.string().optional().describe("Object name for filtering"),
      object_id: z.string().optional().describe("Object ID for filtering"),
      filter: z.string().optional().describe("Filter criteria"),
      employee_name: z.string().optional().describe("Employee name to filter tasks assigned to specific employee"),
      page: z.number().optional().describe("Page number for pagination (default: 1)"),
      take: z.number().optional().describe("Number of records to take per page (default: 20 for better performance)"),
      search: z.string().optional().describe("Search term to filter tasks"),
      show_all: z.boolean().optional().describe("Whether to show all results (may cause large responses)")
    },
    async ({ object_name, object_id, filter, employee_name, page = 1, take = 20, search, show_all = false }) => {
      try {
        const params: Record<string, any> = {
          page,
          take
        };

        // Add optional parameters if provided
        if (object_name) params.object_name = object_name;
        if (object_id) params.object_id = object_id;
        if (filter) params.filter = filter;
        if (employee_name) params.employee_name = employee_name;
        if (search) params.search = search;

        // Handle pagination and data fetching
        let allTasks: any[] = [];
        let totalPages = 1;
        let totalRecords = 0;
        
        if (show_all && employee_name) {
          // Fetch all pages to get complete results for employee filtering
          let currentPage = 1;
          let hasMorePages = true;
          
          while (hasMorePages) {
            const pageParams = { ...params, page: currentPage, take: 100 };
            const pageData = await SHARED_UTILITIES.api.tasks.getList(pageParams);
            
            if (!pageData.success) {
              return { content: [{ type: "text", text: `Error fetching task list: ${pageData.message}` }] };
            }
            
            const pageTasks = pageData.result || [];
            allTasks = allTasks.concat(pageTasks);
            
            // Check if there are more pages
            hasMorePages = currentPage < pageData.total_page;
            currentPage++;
            totalPages = pageData.total_page;
            totalRecords = pageData.total_record;
          }
          
          // Filter by employee name
          allTasks = allTasks.filter((task: any) => 
            task.employee_name && task.employee_name.toLowerCase().includes(employee_name.toLowerCase())
          );
        } else {
          // Single page request (with pagination)
          const data = await SHARED_UTILITIES.api.tasks.getList(params);
          if (!data.success) {
            return { content: [{ type: "text", text: `Error fetching task list: ${data.message}` }] };
          }
          allTasks = data.result || [];
          totalPages = data.total_page;
          totalRecords = data.total_record;
          
          // Filter by employee name if specified
          if (employee_name) {
            allTasks = allTasks.filter((task: any) => 
              task.employee_name && task.employee_name.toLowerCase().includes(employee_name.toLowerCase())
            );
          }
        }
        
        // Create a more readable format that highlights associates
        const formattedTasks = allTasks.map((task: any) => {
          const associatesInfo = task.associates && task.associates.length > 0 
            ? task.associates.map((assoc: any) => 
                `${assoc.linked_object_name} (${assoc.custom_number})`
              ).join(', ')
            : 'None';
          
          return {
            task_id: task.task_id,
            custom_number: task.custom_number,
            title: task.title,
            created_date: task.created_date,
            due_date_show: task.due_date_show,
            issue_type_value: task.issue_type_value,
            priority_show: task.priority_show,
            status_show: task.status_show,
            employee_name: task.employee_name,
            created_by_name: task.created_by_name,
            progress: task.progress,
            associates: associatesInfo,
            associates_details: task.associates || []
          };
        });

        const filterInfo = employee_name ? ` (Filtered by employee: ${employee_name})` : '';
        const totalFilteredTasks = allTasks.length;
        const paginationInfo = show_all ? '' : ` (Page ${page} of ${totalPages}, showing ${take} per page)`;
        const totalInfo = show_all ? ` (Total: ${totalFilteredTasks} tasks)` : ` (Total available: ${totalRecords} tasks)`;
        
        let responseText = `Task List Results${filterInfo}${paginationInfo}${totalInfo}:\n\n${JSON.stringify(formattedTasks, null, 2)}`;
        
        // Add pagination guidance
        if (!show_all && totalPages > 1) {
          responseText += `\n\n📄 Pagination: Showing page ${page} of ${totalPages}. To see more tasks, ask for "next page" or "show more tasks". To see all tasks at once, ask for "show all tasks".`;
        }
        
        responseText += `\n\n📋 Associates show linked objects (estimates, invoices, etc.) with their custom numbers. Full associate details are available in the associates_details field.`;
        
        return {
          content: [
            {
              type: "text",
              text: responseText
            }
          ]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );

  // Get next page of task list
  server.tool(
    "getNextPageTasks",
    "Get the next page of task list results. Use this when you want to see more tasks after viewing a paginated result.",
    {
      object_name: z.string().optional().describe("Object name for filtering"),
      object_id: z.string().optional().describe("Object ID for filtering"),
      filter: z.string().optional().describe("Filter criteria"),
      employee_name: z.string().optional().describe("Employee name to filter tasks assigned to specific employee"),
      current_page: z.number().describe("Current page number to get the next page from"),
      take: z.number().optional().describe("Number of records to take per page (default: 20)"),
      search: z.string().optional().describe("Search term to filter tasks")
    },
    async ({ object_name, object_id, filter, employee_name, current_page, take = 20, search }) => {
      try {
        const nextPage = current_page + 1;
        const params: Record<string, any> = {
          page: nextPage,
          take
        };

        // Add optional parameters if provided
        if (object_name) params.object_name = object_name;
        if (object_id) params.object_id = object_id;
        if (filter) params.filter = filter;
        if (search) params.search = search;

        const data = await SHARED_UTILITIES.api.tasks.getList(params);
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching task list: ${data.message}` }] };
        }

        let tasks = data.result || [];
        
        // Filter by employee name if specified
        if (employee_name) {
          tasks = tasks.filter((task: any) => 
            task.employee_name && task.employee_name.toLowerCase().includes(employee_name.toLowerCase())
          );
        }

        // Create a more readable format that highlights associates
        const formattedTasks = tasks.map((task: any) => {
          const associatesInfo = task.associates && task.associates.length > 0 
            ? task.associates.map((assoc: any) => 
                `${assoc.linked_object_name} (${assoc.custom_number})`
              ).join(', ')
            : 'None';
          
          return {
            task_id: task.task_id,
            custom_number: task.custom_number,
            title: task.title,
            created_date: task.created_date,
            due_date_show: task.due_date_show,
            issue_type_value: task.issue_type_value,
            priority_show: task.priority_show,
            status_show: task.status_show,
            employee_name: task.employee_name,
            created_by_name: task.created_by_name,
            progress: task.progress,
            associates: associatesInfo,
            associates_details: task.associates || []
          };
        });

        const filterInfo = employee_name ? ` (Filtered by employee: ${employee_name})` : '';
        const hasMorePages = nextPage < data.total_page;
        
        let responseText = `Task List Results${filterInfo} (Page ${nextPage} of ${data.total_page}, showing ${take} per page):\n\n${JSON.stringify(formattedTasks, null, 2)}`;
        
        if (hasMorePages) {
          responseText += `\n\n📄 Pagination: Showing page ${nextPage} of ${data.total_page}. To see more tasks, ask for "next page" or "show more tasks".`;
        } else {
          responseText += `\n\n📄 Pagination: This is the last page (${data.total_page} of ${data.total_page}).`;
        }
        
        responseText += `\n\n📋 Associates show linked objects (estimates, invoices, etc.) with their custom numbers. Full associate details are available in the associates_details field.`;
        
        return {
          content: [
            {
              type: "text",
              text: responseText
            }
          ]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );

  // Get task details tool
  server.tool(
    "getTaskDetails",
    "Get detailed information about a specific task using task ID. Returns comprehensive task information including description, assignee, due dates, status, and associated objects.",
    {
      task_id: z.number().describe("Task ID number to get details for"),
      custom_number: z.string().optional().describe("Task custom number (alternative to task_id)")
    },
    async ({ task_id, custom_number }) => {
      try {
        const params: Record<string, any> = {};
        
        if (task_id) {
          params.task_id = task_id;
        } else if (custom_number) {
          params.custom_number = custom_number;
        } else {
          return { content: [{ type: "text", text: "Error: Either task_id or custom_number is required." }] };
        }

        const data = task_id 
          ? await SHARED_UTILITIES.api.tasks.getDetails(task_id)
          : await SHARED_UTILITIES.api.tasks.getDetailsByCustomNumber(custom_number!);

        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching task details: ${data.message}` }] };
        }

        const task = data.result;
        if (!task) {
          return { content: [{ type: "text", text: "Task not found." }] };
        }

        // Format the task details in a readable way
        const formattedTask = {
          task_id: task.id,
          custom_number: task.custom_number,
          title: task.title,
          description: task.description || "No description provided",
          issue_type: task.issue_type_value,
          priority: task.priority_show,
          priority_color: task.priority_color,
          status: task.status_show,
          status_color: task.status_color,
          label: task.label_value,
          assignee: {
            name: task.assign_to_name,
            email: task.assign_to_email,
            id: task.assign_to
          },
          dates: {
            created: task.create_date,
            due: task.due_date_show,
            created_at: task.created_at,
            updated_at: task.updated_at
          },
          created_by: task.created_by,
          associates: task.associates && task.associates.length > 0 
            ? task.associates.map((assoc: any) => ({
                type: assoc.linked_object_name,
                id: assoc.linked_object_id,
                custom_number: assoc.custom_number,
                url: assoc.url
              }))
            : [],
          raw_data: task // Include full raw data for reference
        };

        return {
          content: [
            {
              type: "text",
              text: `Task Details (${task.custom_number}):\n\n${JSON.stringify(formattedTask, null, 2)}\n\n📋 This includes all task information including assignee details, dates, status, priority, and associated objects (estimates, invoices, etc.).`
            }
          ]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );


}

// Shared analytics functions
const ANALYTICS_UTILITIES = {
  // Analyze estimate statuses with detailed breakdown
  analyzeEstimateStatuses: (estimates: any[]) => {
    const statusCounts: Record<string, number> = {};
    const detailedStatuses = {
      draft: 0,
      sent: 0,
      sentOpen: 0,
      changeRequest: 0,
      changeRequestUpdated: 0,
      open: 0,
      accepted: 0,
      closed: 0,
      rejected: 0,
      cancelled: 0,
      other: 0
    };
    
    let openEstimates = 0, closedEstimates = 0;
    
    for (const est of estimates) {
      const status = (est.status_name || '').toLowerCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      
      // Detailed status classification
      if (status === 'draft') {
        detailedStatuses.draft++;
        openEstimates++;
      } else if (status === 'sent(open)') {
        detailedStatuses.sentOpen++;
        openEstimates++;
      } else if (status.includes('sent') && status !== 'sent(open)') {
        detailedStatuses.sent++;
        openEstimates++;
      } else if (status === 'change request') {
        detailedStatuses.changeRequest++;
        openEstimates++;
      } else if (status === 'change request updated') {
        detailedStatuses.changeRequestUpdated++;
        openEstimates++;
      } else if (status === 'open') {
        detailedStatuses.open++;
        openEstimates++;
      } else if (status === 'accepted') {
        detailedStatuses.accepted++;
        closedEstimates++;
      } else if (status === 'closed') {
        detailedStatuses.closed++;
        closedEstimates++;
      } else if (status === 'rejected') {
        detailedStatuses.rejected++;
      } else if (status === 'cancelled') {
        detailedStatuses.cancelled++;
      } else {
        detailedStatuses.other++;
      }
    }
    
    return {
      statusCounts,
      detailedStatuses,
      summary: {
        open: openEstimates,
        closed: closedEstimates,
        total: estimates.length
      }
    };
  },

  // Analyze invoice statuses with detailed breakdown
  analyzeInvoiceStatuses: (invoices: any[]) => {
    const statusCounts: Record<string, number> = {};
    const detailedStatuses = {
      open: 0,
      created: 0,
      sent: 0,
      sentOpen: 0,
      due: 0,
      paid: 0,
      closed: 0,
      cancelled: 0,
      other: 0
    };
    
    let openInvoices = 0, paidInvoices = 0;
    
    for (const inv of invoices) {
      const status = (inv.status_name || '').toLowerCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      
      // Detailed status classification
      if (status === 'open') {
        detailedStatuses.open++;
        openInvoices++;
      } else if (status === 'created') {
        detailedStatuses.created++;
        openInvoices++;
      } else if (status === 'sent(open)') {
        detailedStatuses.sentOpen++;
        openInvoices++;
      } else if (status.includes('sent') && status !== 'sent(open)') {
        detailedStatuses.sent++;
        openInvoices++;
      } else if (status === 'due') {
        detailedStatuses.due++;
        openInvoices++;
      } else if (status === 'paid') {
        detailedStatuses.paid++;
        paidInvoices++;
      } else if (status === 'closed') {
        detailedStatuses.closed++;
        paidInvoices++;
      } else if (status === 'cancelled') {
        detailedStatuses.cancelled++;
      } else {
        detailedStatuses.other++;
      }
    }
    
    return {
      statusCounts,
      detailedStatuses,
      summary: {
        open: openInvoices,
        paid: paidInvoices,
        total: invoices.length
      }
    };
  },

  // Calculate totals from estimates/invoices
  calculateTotals: (items: any[]) => {
    let totalAmount = 0;
    for (const item of items) {
      let val = 0;
      if (item.totals && item.totals.grand_total) val = parseFloat(item.totals.grand_total);
      else if (item.grand_total) val = parseFloat(item.grand_total);
      else if (item.quotation_total) val = parseFloat(item.quotation_total);
      if (!isNaN(val)) totalAmount += val;
    }
    return totalAmount;
  },

  // Generate detailed summary text
  generateDetailedSummary: (analysisType: string, entityName: string, estimates: any[], invoices: any[], dateRange: string) => {
    const estimateAnalysis = ANALYTICS_UTILITIES.analyzeEstimateStatuses(estimates);
    const invoiceAnalysis = ANALYTICS_UTILITIES.analyzeInvoiceStatuses(invoices);
    const totalEstimateAmount = ANALYTICS_UTILITIES.calculateTotals(estimates);
    const totalInvoiceAmount = ANALYTICS_UTILITIES.calculateTotals(invoices);
    const conversionRate = estimates.length > 0 ? (estimateAnalysis.summary.closed / estimates.length) * 100 : 0;
    
    let summary = `${analysisType} for ${entityName}${dateRange}:\n`;
    summary += `📊 OVERVIEW:\n`;
    summary += `- Total Estimates: ${estimates.length}\n`;
    summary += `- Total Invoices: ${invoices.length}\n`;
    summary += `- Total Estimate Amount: $${totalEstimateAmount.toLocaleString()}\n`;
    summary += `- Total Invoice Amount: $${totalInvoiceAmount.toLocaleString()}\n`;
    summary += `- Conversion Rate: ${conversionRate.toFixed(2)}%\n\n`;
    
    // Dynamic Estimate Details - only show sections with data
    if (estimates.length > 0) {
      summary += `📋 ESTIMATE DETAILS:\n`;
      
      // Open Estimates section
      if (estimateAnalysis.summary.open > 0) {
        summary += `- Open Estimates: ${estimateAnalysis.summary.open}\n`;
        const openStatuses = [];
        if (estimateAnalysis.detailedStatuses.draft > 0) openStatuses.push(`  • Draft: ${estimateAnalysis.detailedStatuses.draft}`);
        if (estimateAnalysis.detailedStatuses.sent > 0) openStatuses.push(`  • Sent: ${estimateAnalysis.detailedStatuses.sent}`);
        if (estimateAnalysis.detailedStatuses.sentOpen > 0) openStatuses.push(`  • Sent(Open): ${estimateAnalysis.detailedStatuses.sentOpen}`);
        if (estimateAnalysis.detailedStatuses.changeRequest > 0) openStatuses.push(`  • Change Request: ${estimateAnalysis.detailedStatuses.changeRequest}`);
        if (estimateAnalysis.detailedStatuses.changeRequestUpdated > 0) openStatuses.push(`  • Change Request Updated: ${estimateAnalysis.detailedStatuses.changeRequestUpdated}`);
        if (estimateAnalysis.detailedStatuses.open > 0) openStatuses.push(`  • Open: ${estimateAnalysis.detailedStatuses.open}`);
        summary += openStatuses.join('\n') + '\n';
      }
      
      // Closed Estimates section
      if (estimateAnalysis.summary.closed > 0) {
        summary += `- Closed Estimates: ${estimateAnalysis.summary.closed}\n`;
        const closedStatuses = [];
        if (estimateAnalysis.detailedStatuses.accepted > 0) closedStatuses.push(`  • Accepted: ${estimateAnalysis.detailedStatuses.accepted}`);
        if (estimateAnalysis.detailedStatuses.closed > 0) closedStatuses.push(`  • Closed: ${estimateAnalysis.detailedStatuses.closed}`);
        summary += closedStatuses.join('\n') + '\n';
      }
      
      // Other Estimates section
      const otherEstimates = estimateAnalysis.detailedStatuses.rejected + estimateAnalysis.detailedStatuses.cancelled;
      if (otherEstimates > 0) {
        summary += `- Other: ${otherEstimates}\n`;
        const otherStatuses = [];
        if (estimateAnalysis.detailedStatuses.rejected > 0) otherStatuses.push(`  • Rejected: ${estimateAnalysis.detailedStatuses.rejected}`);
        if (estimateAnalysis.detailedStatuses.cancelled > 0) otherStatuses.push(`  • Cancelled: ${estimateAnalysis.detailedStatuses.cancelled}`);
        summary += otherStatuses.join('\n') + '\n';
      }
    }
    
    // Dynamic Invoice Details - only show sections with data
    if (invoices.length > 0) {
      summary += `📋 INVOICE DETAILS:\n`;
      
      // Open Invoices section
      if (invoiceAnalysis.summary.open > 0) {
        summary += `- Open Invoices: ${invoiceAnalysis.summary.open}\n`;
        const openStatuses = [];
        if (invoiceAnalysis.detailedStatuses.open > 0) openStatuses.push(`  • Open: ${invoiceAnalysis.detailedStatuses.open}`);
        if (invoiceAnalysis.detailedStatuses.created > 0) openStatuses.push(`  • Created: ${invoiceAnalysis.detailedStatuses.created}`);
        if (invoiceAnalysis.detailedStatuses.sent > 0) openStatuses.push(`  • Sent: ${invoiceAnalysis.detailedStatuses.sent}`);
        if (invoiceAnalysis.detailedStatuses.sentOpen > 0) openStatuses.push(`  • Sent(Open): ${invoiceAnalysis.detailedStatuses.sentOpen}`);
        if (invoiceAnalysis.detailedStatuses.due > 0) openStatuses.push(`  • Due: ${invoiceAnalysis.detailedStatuses.due}`);
        summary += openStatuses.join('\n') + '\n';
      }
      
      // Paid Invoices section
      if (invoiceAnalysis.summary.paid > 0) {
        summary += `- Paid Invoices: ${invoiceAnalysis.summary.paid}\n`;
        const paidStatuses = [];
        if (invoiceAnalysis.detailedStatuses.paid > 0) paidStatuses.push(`  • Paid: ${invoiceAnalysis.detailedStatuses.paid}`);
        if (invoiceAnalysis.detailedStatuses.closed > 0) paidStatuses.push(`  • Closed: ${invoiceAnalysis.detailedStatuses.closed}`);
        summary += paidStatuses.join('\n') + '\n';
      }
      
      // Other Invoices section
      if (invoiceAnalysis.detailedStatuses.cancelled > 0) {
        summary += `- Other: ${invoiceAnalysis.detailedStatuses.cancelled}\n`;
        summary += `  • Cancelled: ${invoiceAnalysis.detailedStatuses.cancelled}\n`;
      }
    }
    
    return {
      summary,
      estimateAnalysis,
      invoiceAnalysis,
      totalEstimateAmount,
      totalInvoiceAmount,
      conversionRate
    };
  }
};

// Register analytics tools (for chart-ready business analysis)
export function registerAnalyticsTools(server: McpServer) {
  server.tool(
    "analyzeBusinessData",
    "Analyze business data and return chart-ready JSON for infographics. Supports company-wide sales analytics, customer-specific analysis, and employee-based analysis. IMPORTANT: This tool only accepts exact dates in YYYY-MM-DD format. For natural language dates like 'this month', 'last quarter', etc., use the date-utility tool first to convert them to exact dates.",
    {
      analysis_type: z.enum(["total_sale_for_customer", "company_sales_analytics", "employee_sales_analytics", "employee_comparison_analytics"]).describe("Type of analysis: total_sale_for_customer for specific customer, company_sales_analytics for company-wide analysis, employee_sales_analytics for employee-based analysis, employee_comparison_analytics for comparing multiple employees"),
      customer_name: z.string().optional().describe("Customer name for customer-specific analysis (required for total_sale_for_customer)"),
      employee_name: z.string().optional().describe("Employee name for employee-based analysis (required for employee_sales_analytics)"),
      employee_names: z.array(z.string()).optional().describe("Array of employee names for comparison analysis (required for employee_comparison_analytics)"),
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format only - use date-utility tool for natural language dates)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format only - use date-utility tool for natural language dates)"),
    },
    async ({ analysis_type, customer_name, employee_name, employee_names, from_date, to_date }) => {
      try {
        // Use exact dates only - natural language dates should be parsed by date-utility tool first
        const parsedFromDate = from_date;
        const parsedToDate = to_date;
        
        // Debug logging to see what dates are being passed
        console.log(`🔍 analyzeBusinessData: Received dates - from_date: "${from_date}", to_date: "${to_date}"`);
        
        // Validate that dates are in YYYY-MM-DD format if provided
        const validateDateFormat = (dateStr: string | undefined): boolean => {
          if (!dateStr) return true; // Optional dates are fine
          return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
        };
        
        if (!validateDateFormat(parsedFromDate) || !validateDateFormat(parsedToDate)) {
          console.log(`❌ analyzeBusinessData: Invalid date format detected - from_date: "${parsedFromDate}", to_date: "${parsedToDate}"`);
          return {
            content: [{
              type: "text", 
              text: `Error: This tool only accepts exact dates in YYYY-MM-DD format. Received: from_date="${parsedFromDate}", to_date="${parsedToDate}". For natural language dates like 'this month', 'last quarter', etc., please use the date-utility tool first to convert them to exact dates.`
            }]
          };
        }
        
        console.log(`✅ analyzeBusinessData: Valid dates - from_date: "${parsedFromDate}", to_date: "${parsedToDate}"`);
        if (analysis_type === "total_sale_for_customer") {
          if (!customer_name) {
            return {
              content: [{ type: "text", text: "Error: customer_name is required for this analysis." }]
            };
          }

          // 1. Use shared API utility to get estimates
          const estimateSearch = await SHARED_UTILITIES.api.estimates.search(customer_name, {
            from_date: parsedFromDate,
            to_date: parsedToDate,
            take: 1000
          });
          if (!estimateSearch.success) {
            return { content: [{ type: "text", text: `Error fetching estimates: ${estimateSearch.message}` }] };
          }
          const estimates = estimateSearch.result || [];

          // 2. Use shared API utility to get invoices
          const invoiceSearch = await SHARED_UTILITIES.api.invoices.search(customer_name, {
            from_date: parsedFromDate,
            to_date: parsedToDate,
            take: 1000
          });
          if (!invoiceSearch.success) {
            return { content: [{ type: "text", text: `Error fetching invoices: ${invoiceSearch.message}` }] };
          }
          const invoices = invoiceSearch.result || [];

          // If no data found, show a clear message
          if (estimates.length === 0 && invoices.length === 0) {
            return {
              content: [
                { type: "text", text: `No sales data (estimates or invoices) found for customer name: '${customer_name}'. Try a different or more specific name.` }
              ]
            };
          }

          // Optionally, try to find a customer for display purposes (not for filtering)
          let customerDisplayName = customer_name;
          if (estimates.length > 0 && estimates[0].customer_name) {
            customerDisplayName = estimates[0].customer_name;
          } else if (invoices.length > 0 && invoices[0].customer_name) {
            customerDisplayName = invoices[0].customer_name;
          }

          // 3. Use shared analytics utilities for detailed analysis
          const dateRange = parsedFromDate && parsedToDate ? ` from ${parsedFromDate} to ${parsedToDate} (inclusive)` : parsedFromDate ? ` from ${parsedFromDate}` : parsedToDate ? ` until ${parsedToDate}` : '';
          const analysisResult = ANALYTICS_UTILITIES.generateDetailedSummary('Customer Sales Analytics', customerDisplayName, estimates, invoices, dateRange);

          // 7. Return structured data for dynamic chart generation
          const customerAnalyticsData = {
            summary: analysisResult.summary,
            customer: {
              name: customerDisplayName,
              searchTerm: customer_name
            },
            metrics: {
              estimates: {
                total: estimates.length,
                open: analysisResult.estimateAnalysis.summary.open,
                closed: analysisResult.estimateAnalysis.summary.closed,
                totalAmount: analysisResult.totalEstimateAmount,
                statusBreakdown: analysisResult.estimateAnalysis.statusCounts
              },
              invoices: {
                total: invoices.length,
                open: analysisResult.invoiceAnalysis.summary.open,
                paid: analysisResult.invoiceAnalysis.summary.paid,
                totalAmount: analysisResult.totalInvoiceAmount,
                statusBreakdown: analysisResult.invoiceAnalysis.statusCounts
              },
              conversion: {
                rate: analysisResult.conversionRate,
                closedEstimates: analysisResult.estimateAnalysis.summary.closed,
                totalEstimates: estimates.length
              }
            },
            comparison: {
              estimates: {
                count: estimates.length,
                amount: analysisResult.totalEstimateAmount
              },
              invoices: {
                count: invoices.length,
                amount: analysisResult.totalInvoiceAmount
              }
            },
            dateRange: {
              from: from_date,
              to: to_date
            },
            rawData: {
              estimates: estimates.length,
              invoices: invoices.length,
              totalEstimateAmount: analysisResult.totalEstimateAmount,
              totalInvoiceAmount: analysisResult.totalInvoiceAmount,
              openEstimates: analysisResult.estimateAnalysis.summary.open,
              closedEstimates: analysisResult.estimateAnalysis.summary.closed,
              openInvoices: analysisResult.invoiceAnalysis.summary.open,
              paidInvoices: analysisResult.invoiceAnalysis.summary.paid,
              conversionRate: analysisResult.conversionRate
            }
          };

          // Generate dynamic charts based on data availability and significance
          const customerCharts: Record<string, any> = {};
          
          // Always include sales overview if there's any data
          if (customerAnalyticsData.metrics.estimates.totalAmount > 0 || customerAnalyticsData.metrics.invoices.totalAmount > 0) {
            customerCharts.sales_overview = {
              type: "doughnut",
              data: {
                labels: [`Estimates ($${customerAnalyticsData.metrics.estimates.totalAmount.toLocaleString()})`, `Invoices ($${customerAnalyticsData.metrics.invoices.totalAmount.toLocaleString()})`],
                datasets: [{
                  data: [customerAnalyticsData.metrics.estimates.totalAmount, customerAnalyticsData.metrics.invoices.totalAmount],
                  backgroundColor: ["#FF6384", "#36A2EB"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Sales Overview - ${customerAnalyticsData.customer.name}`,
                    font: { size: 16, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 12 } }
                  }
                }
              }
            };
          }
          
          // Include estimate status breakdown if there are estimates with different statuses
          const estimateStatuses = Object.keys(customerAnalyticsData.metrics.estimates.statusBreakdown);
          if (estimateStatuses.length > 1 && customerAnalyticsData.metrics.estimates.total > 0) {
            customerCharts.estimate_status = {
              type: "pie",
              data: {
                labels: estimateStatuses.map(status => 
                  `${status.charAt(0).toUpperCase() + status.slice(1)} (${customerAnalyticsData.metrics.estimates.statusBreakdown[status]})`
                ),
                datasets: [{
                  data: Object.values(customerAnalyticsData.metrics.estimates.statusBreakdown),
                  backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Estimate Status Breakdown - ${customerAnalyticsData.customer.name}`,
                    font: { size: 14, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 11 } }
                  }
                }
              }
            };
          }
          
          // Include invoice status breakdown if there are invoices with different statuses
          const invoiceStatuses = Object.keys(customerAnalyticsData.metrics.invoices.statusBreakdown);
          if (invoiceStatuses.length > 1 && customerAnalyticsData.metrics.invoices.total > 0) {
            customerCharts.invoice_status = {
              type: "pie",
              data: {
                labels: invoiceStatuses.map(status => 
                  `${status.charAt(0).toUpperCase() + status.slice(1)} (${customerAnalyticsData.metrics.invoices.statusBreakdown[status]})`
                ),
                datasets: [{
                  data: Object.values(customerAnalyticsData.metrics.invoices.statusBreakdown),
                  backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Invoice Status Breakdown - ${customerAnalyticsData.customer.name}`,
                    font: { size: 14, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 11 } }
                  }
                }
              }
            };
          }
          
          // Include conversion gauge if there are estimates to convert
          if (customerAnalyticsData.metrics.conversion.totalEstimates > 0) {
            customerCharts.conversion_gauge = {
              type: "doughnut",
              data: {
                labels: ["Converted", "Not Converted"],
                datasets: [{
                  data: [customerAnalyticsData.metrics.conversion.closedEstimates, customerAnalyticsData.metrics.conversion.totalEstimates - customerAnalyticsData.metrics.conversion.closedEstimates],
                  backgroundColor: ["#4BC0C0", "#FF6384"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Conversion Rate: ${customerAnalyticsData.metrics.conversion.rate.toFixed(1)}%`,
                    font: { size: 14, weight: "bold" }
                  }
                }
              }
            };
          }

          return {
            content: [
              { 
                type: "text", 
                text: JSON.stringify({
                  summary: customerAnalyticsData.summary,
                  charts: customerCharts,
                  rawData: customerAnalyticsData
                }, null, 2) 
              }
            ]
          };
        } else if (analysis_type === "company_sales_analytics") {
          // Company-wide sales analytics for any date range
          
          // 1. Use shared API utility to get all estimates for the date range
          const estimateSearch = await SHARED_UTILITIES.api.estimates.getList({
            from_date: parsedFromDate,
            to_date: parsedToDate,
            take: 1000
          });
          if (!estimateSearch.success) {
            return { content: [{ type: "text", text: `Error fetching estimates: ${estimateSearch.message}` }] };
          }
          const estimates = estimateSearch.result || [];

          // 2. Use shared API utility to get all invoices for the date range
          const invoiceSearch = await SHARED_UTILITIES.api.invoices.getList({
            from_date: parsedFromDate,
            to_date: parsedToDate,
            take: 1000
          });
          if (!invoiceSearch.success) {
            return { content: [{ type: "text", text: `Error fetching invoices: ${invoiceSearch.message}` }] };
          }
          const invoices = invoiceSearch.result || [];

          // If no data found, show a clear message
          if (estimates.length === 0 && invoices.length === 0) {
            const dateRange = parsedFromDate && parsedToDate ? ` from ${parsedFromDate} to ${parsedToDate}` : parsedFromDate ? ` from ${parsedFromDate}` : parsedToDate ? ` until ${parsedToDate}` : '';
            const originalDateRange = from_date && to_date ? ` (original: ${from_date} to ${to_date})` : from_date ? ` (original: ${from_date})` : to_date ? ` (original: ${to_date})` : '';
            return {
              content: [
                { type: "text", text: `No sales data (estimates or invoices) found${dateRange}${originalDateRange}. Try a different date range or check if there's data for the specified period.` }
              ]
            };
          }

          // 3. Use shared analytics utilities for detailed analysis
          const companyDateRange = parsedFromDate && parsedToDate ? ` from ${parsedFromDate} to ${parsedToDate} (inclusive)` : parsedFromDate ? ` from ${parsedFromDate}` : parsedToDate ? ` until ${parsedToDate}` : '';
          const analysisResult = ANALYTICS_UTILITIES.generateDetailedSummary('Company Sales Analytics', 'Company', estimates, invoices, companyDateRange);

          // 6. Monthly trend analysis (if date range spans multiple months)
          const monthlyData: Record<string, { estimates: number; invoices: number; estimateAmount: number; invoiceAmount: number }> = {};
          
          estimates.forEach((est: any) => {
            const date = new Date(est.created_at || est.created_date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
              monthlyData[monthKey] = { estimates: 0, invoices: 0, estimateAmount: 0, invoiceAmount: 0 };
            }
            monthlyData[monthKey].estimates++;
            let val = 0;
            if (est.totals && est.totals.grand_total) val = parseFloat(est.totals.grand_total);
            else if (est.grand_total) val = parseFloat(est.grand_total);
            else if (est.quotation_total) val = parseFloat(est.quotation_total);
            if (!isNaN(val)) monthlyData[monthKey].estimateAmount += val;
          });

          invoices.forEach((inv: any) => {
            const date = new Date(inv.created_at || inv.created_date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
              monthlyData[monthKey] = { estimates: 0, invoices: 0, estimateAmount: 0, invoiceAmount: 0 };
            }
            monthlyData[monthKey].invoices++;
            let val = 0;
            if (inv.totals && inv.totals.grand_total) val = parseFloat(inv.totals.grand_total);
            else if (inv.grand_total) val = parseFloat(inv.grand_total);
            if (!isNaN(val)) monthlyData[monthKey].invoiceAmount += val;
          });

          // 7. Generate summary with original date range info
          const originalDateRange = from_date && to_date ? ` (original: ${from_date} to ${to_date})` : from_date ? ` (original: ${from_date})` : to_date ? ` (original: ${to_date})` : '';
          const summary = analysisResult.summary + originalDateRange;

          // 8. Return structured data for dynamic chart generation
          const analyticsData = {
            summary,
            metrics: {
              estimates: {
                total: estimates.length,
                open: analysisResult.estimateAnalysis.summary.open,
                closed: analysisResult.estimateAnalysis.summary.closed,
                totalAmount: analysisResult.totalEstimateAmount,
                statusBreakdown: analysisResult.estimateAnalysis.statusCounts
              },
              invoices: {
                total: invoices.length,
                open: analysisResult.invoiceAnalysis.summary.open,
                paid: analysisResult.invoiceAnalysis.summary.paid,
                totalAmount: analysisResult.totalInvoiceAmount,
                statusBreakdown: analysisResult.invoiceAnalysis.statusCounts
              },
              conversion: {
                rate: analysisResult.conversionRate,
                closedEstimates: analysisResult.estimateAnalysis.summary.closed,
                totalEstimates: estimates.length
              }
            },
            comparison: {
              estimates: {
                count: estimates.length,
                amount: analysisResult.totalEstimateAmount
              },
              invoices: {
                count: invoices.length,
                amount: analysisResult.totalInvoiceAmount
              }
            },
            trends: {
              monthlyData,
              hasMultipleMonths: Object.keys(monthlyData).length > 1,
              monthLabels: Object.keys(monthlyData).sort(),
              estimateTrends: Object.keys(monthlyData).sort().map(month => ({
                month,
                count: monthlyData[month].estimates,
                amount: monthlyData[month].estimateAmount
              })),
              invoiceTrends: Object.keys(monthlyData).sort().map(month => ({
                month,
                count: monthlyData[month].invoices,
                amount: monthlyData[month].invoiceAmount
              }))
            },
            dateRange: {
              from: parsedFromDate,
              to: parsedToDate,
              original: {
                from: from_date,
                to: to_date
              },
              display: companyDateRange
            },
            rawData: {
              estimates: estimates.length,
              invoices: invoices.length,
              totalEstimateAmount: analysisResult.totalEstimateAmount,
              totalInvoiceAmount: analysisResult.totalInvoiceAmount,
              openEstimates: analysisResult.estimateAnalysis.summary.open,
              closedEstimates: analysisResult.estimateAnalysis.summary.closed,
              openInvoices: analysisResult.invoiceAnalysis.summary.open,
              paidInvoices: analysisResult.invoiceAnalysis.summary.paid,
              conversionRate: analysisResult.conversionRate,
              monthlyData
            }
          };

          // Generate dynamic charts based on data availability and significance
          const charts: Record<string, any> = {};
          
          // Always include sales overview if there's any data
          if (analyticsData.metrics.estimates.totalAmount > 0 || analyticsData.metrics.invoices.totalAmount > 0) {
            charts.sales_overview = {
              type: "doughnut",
              data: {
                labels: [`Estimates ($${analyticsData.metrics.estimates.totalAmount.toLocaleString()})`, `Invoices ($${analyticsData.metrics.invoices.totalAmount.toLocaleString()})`],
                datasets: [{
                  data: [analyticsData.metrics.estimates.totalAmount, analyticsData.metrics.invoices.totalAmount],
                  backgroundColor: ["#FF6384", "#36A2EB"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Sales Overview - ${analyticsData.dateRange.display || 'Selected Period'}`,
                    font: { size: 16, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 12 } }
                  }
                }
              }
            };
          }
          
          // Include estimate status breakdown if there are estimates with different statuses
          const estimateStatuses = Object.keys(analyticsData.metrics.estimates.statusBreakdown);
          if (estimateStatuses.length > 1 && analyticsData.metrics.estimates.total > 0) {
            charts.estimate_status = {
              type: "pie",
              data: {
                labels: estimateStatuses.map(status => 
                  `${status.charAt(0).toUpperCase() + status.slice(1)} (${analyticsData.metrics.estimates.statusBreakdown[status]})`
                ),
                datasets: [{
                  data: Object.values(analyticsData.metrics.estimates.statusBreakdown),
                  backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Estimate Status Breakdown - ${analyticsData.dateRange.display || 'Selected Period'}`,
                    font: { size: 14, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 11 } }
                  }
                }
              }
            };
          }
          
          // Include invoice status breakdown if there are invoices with different statuses
          const invoiceStatuses = Object.keys(analyticsData.metrics.invoices.statusBreakdown);
          if (invoiceStatuses.length > 1 && analyticsData.metrics.invoices.total > 0) {
            charts.invoice_status = {
              type: "pie",
              data: {
                labels: invoiceStatuses.map(status => 
                  `${status.charAt(0).toUpperCase() + status.slice(1)} (${analyticsData.metrics.invoices.statusBreakdown[status]})`
                ),
                datasets: [{
                  data: Object.values(analyticsData.metrics.invoices.statusBreakdown),
                  backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Invoice Status Breakdown - ${analyticsData.dateRange.display || 'Selected Period'}`,
                    font: { size: 14, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 11 } }
                  }
                }
              }
            };
          }
          
          // Include monthly trends if there are multiple months of data
          if (analyticsData.trends.hasMultipleMonths && analyticsData.trends.monthLabels.length > 1) {
            charts.monthly_trends = {
              type: "line",
              data: {
                labels: analyticsData.trends.monthLabels,
                datasets: [
                  {
                    label: "Estimate Amount",
                    data: analyticsData.trends.estimateTrends.map(t => t.amount),
                    borderColor: "#FF6384",
                    backgroundColor: "rgba(255, 99, 132, 0.1)",
                    tension: 0.4
                  },
                  {
                    label: "Invoice Amount",
                    data: analyticsData.trends.invoiceTrends.map(t => t.amount),
                    borderColor: "#36A2EB",
                    backgroundColor: "rgba(54, 162, 235, 0.1)",
                    tension: 0.4
                  }
                ]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: "Monthly Sales Trends",
                    font: { size: 16, weight: "bold" }
                  },
                  legend: {
                    position: "bottom"
                  }
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: function(value: any) {
                        return "$" + value.toLocaleString();
                      }
                    }
                  }
                }
              }
            };
          }
          
          // Include conversion gauge if there are estimates to convert
          if (analyticsData.metrics.conversion.totalEstimates > 0) {
            charts.conversion_gauge = {
              type: "doughnut",
              data: {
                labels: ["Converted", "Not Converted"],
                datasets: [{
                  data: [analyticsData.metrics.conversion.closedEstimates, analyticsData.metrics.conversion.totalEstimates - analyticsData.metrics.conversion.closedEstimates],
                  backgroundColor: ["#4BC0C0", "#FF6384"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Conversion Rate: ${analyticsData.metrics.conversion.rate.toFixed(1)}%`,
                    font: { size: 14, weight: "bold" }
                  }
                }
              }
            };
          }

          return {
            content: [
              { 
                type: "text", 
                text: JSON.stringify({
                  summary: analyticsData.summary,
                  charts: charts,
                  rawData: analyticsData
                }, null, 2) 
              }
            ]
          };
        } else if (analysis_type === "employee_sales_analytics") {
          // Employee-based sales analytics
          if (!employee_name) {
            return {
              content: [{ type: "text", text: "Error: employee_name is required for employee-based analysis." }]
            };
          }

          // 1. Use shared API utility to get estimates created by the employee
          console.log(`🔍 Employee Analytics: Fetching estimates for ${employee_name} with dates - from: "${parsedFromDate}", to: "${parsedToDate}"`);
          const estimateSearch = await SHARED_UTILITIES.api.estimates.getList({
            from_date: parsedFromDate,
            to_date: parsedToDate,
            take: 1000
          });
          if (!estimateSearch.success) {
            return { content: [{ type: "text", text: `Error fetching estimates: ${estimateSearch.message}` }] };
          }
          const allEstimates = estimateSearch.result || [];
          
          // Filter estimates by employee (prepared_by field)
          const estimates = allEstimates.filter((est: any) => {
            const preparedBy = est.prepared_by;
            if (!preparedBy) return false;
            
            // Extract name from "name - email@domain.com" format
            const namePart = preparedBy.split(' - ')[0]?.trim() || '';
            return namePart.toLowerCase().includes(employee_name.toLowerCase());
          });

          // 2. Use shared API utility to get invoices created by the employee
          const invoiceSearch = await SHARED_UTILITIES.api.invoices.getList({
            from_date: parsedFromDate,
            to_date: parsedToDate,
            take: 1000
          });
          if (!invoiceSearch.success) {
            return { content: [{ type: "text", text: `Error fetching invoices: ${invoiceSearch.message}` }] };
          }
          const allInvoices = invoiceSearch.result || [];
          
          // Filter invoices by employee (prepared_by field)
          const invoices = allInvoices.filter((inv: any) => {
            const preparedBy = inv.prepared_by || inv.created_by_name || '';
            if (!preparedBy) return false;
            
            // Extract name from "name - email@domain.com" format
            const namePart = preparedBy.split(' - ')[0]?.trim() || '';
            return namePart.toLowerCase().includes(employee_name.toLowerCase());
          });

          // If no data found, show a clear message
          if (estimates.length === 0 && invoices.length === 0) {
            const dateRange = parsedFromDate && parsedToDate ? ` from ${parsedFromDate} to ${parsedToDate} (inclusive)` : parsedFromDate ? ` from ${parsedFromDate}` : parsedToDate ? ` until ${parsedToDate}` : '';
            return {
              content: [
                { type: "text", text: `No sales data (estimates or invoices) found for employee '${employee_name}'${dateRange}. Try a different employee name or check the spelling.` }
              ]
            };
          }

          // 3. Use shared analytics utilities for detailed analysis
          const employeeDateRange = parsedFromDate && parsedToDate ? ` from ${parsedFromDate} to ${parsedToDate} (inclusive)` : parsedFromDate ? ` from ${parsedFromDate}` : parsedToDate ? ` until ${parsedToDate}` : '';
          const analysisResult = ANALYTICS_UTILITIES.generateDetailedSummary('Employee Sales Analytics', employee_name, estimates, invoices, employeeDateRange);

          // 6. Get unique customers for this employee
          const employeeCustomers = new Set<string>();
          estimates.forEach((est: any) => {
            if (est.customer_name) employeeCustomers.add(est.customer_name);
          });
          invoices.forEach((inv: any) => {
            if (inv.customer_name) employeeCustomers.add(inv.customer_name);
          });

          // 7. Monthly trend analysis for the employee
          const monthlyData: Record<string, { estimates: number; invoices: number; estimateAmount: number; invoiceAmount: number }> = {};
          
          estimates.forEach((est: any) => {
            const date = new Date(est.created_at || est.created_date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
              monthlyData[monthKey] = { estimates: 0, invoices: 0, estimateAmount: 0, invoiceAmount: 0 };
            }
            monthlyData[monthKey].estimates++;
            let val = 0;
            if (est.totals && est.totals.grand_total) val = parseFloat(est.totals.grand_total);
            else if (est.grand_total) val = parseFloat(est.grand_total);
            else if (est.quotation_total) val = parseFloat(est.quotation_total);
            if (!isNaN(val)) monthlyData[monthKey].estimateAmount += val;
          });

          invoices.forEach((inv: any) => {
            const date = new Date(inv.created_at || inv.created_date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
              monthlyData[monthKey] = { estimates: 0, invoices: 0, estimateAmount: 0, invoiceAmount: 0 };
            }
            monthlyData[monthKey].invoices++;
            let val = 0;
            if (inv.totals && inv.totals.grand_total) val = parseFloat(inv.totals.grand_total);
            else if (inv.grand_total) val = parseFloat(inv.grand_total);
            if (!isNaN(val)) monthlyData[monthKey].invoiceAmount += val;
          });

          // 8. Generate summary with unique customers info
          const summary = analysisResult.summary + `\n- Unique Customers: ${employeeCustomers.size}`;

          // 9. Return structured data for dynamic chart generation
          const employeeAnalyticsData = {
            summary,
            employee: {
              name: employee_name,
              searchTerm: employee_name
            },
            metrics: {
              estimates: {
                total: estimates.length,
                open: analysisResult.estimateAnalysis.summary.open,
                closed: analysisResult.estimateAnalysis.summary.closed,
                totalAmount: analysisResult.totalEstimateAmount,
                statusBreakdown: analysisResult.estimateAnalysis.statusCounts
              },
              invoices: {
                total: invoices.length,
                open: analysisResult.invoiceAnalysis.summary.open,
                paid: analysisResult.invoiceAnalysis.summary.paid,
                totalAmount: analysisResult.totalInvoiceAmount,
                statusBreakdown: analysisResult.invoiceAnalysis.statusCounts
              },
              conversion: {
                rate: analysisResult.conversionRate,
                closedEstimates: analysisResult.estimateAnalysis.summary.closed,
                totalEstimates: estimates.length
              },
              customers: {
                uniqueCount: employeeCustomers.size,
                customerList: Array.from(employeeCustomers)
              }
            },
            comparison: {
              estimates: {
                count: estimates.length,
                amount: analysisResult.totalEstimateAmount
              },
              invoices: {
                count: invoices.length,
                amount: analysisResult.totalInvoiceAmount
              }
            },
            trends: {
              monthlyData,
              hasMultipleMonths: Object.keys(monthlyData).length > 1,
              monthLabels: Object.keys(monthlyData).sort(),
              estimateTrends: Object.keys(monthlyData).sort().map(month => ({
                month,
                count: monthlyData[month].estimates,
                amount: monthlyData[month].estimateAmount
              })),
              invoiceTrends: Object.keys(monthlyData).sort().map(month => ({
                month,
                count: monthlyData[month].invoices,
                amount: monthlyData[month].invoiceAmount
              }))
            },
            dateRange: {
              from: parsedFromDate,
              to: parsedToDate,
              display: employeeDateRange
            },
            rawData: {
              estimates: estimates.length,
              invoices: invoices.length,
              totalEstimateAmount: analysisResult.totalEstimateAmount,
              totalInvoiceAmount: analysisResult.totalInvoiceAmount,
              openEstimates: analysisResult.estimateAnalysis.summary.open,
              closedEstimates: analysisResult.estimateAnalysis.summary.closed,
              openInvoices: analysisResult.invoiceAnalysis.summary.open,
              paidInvoices: analysisResult.invoiceAnalysis.summary.paid,
              conversionRate: analysisResult.conversionRate,
              uniqueCustomers: employeeCustomers.size,
              monthlyData
            }
          };

          // Generate dynamic charts based on data availability and significance
          const employeeCharts: Record<string, any> = {};
          
          // Always include sales overview if there's any data
          if (employeeAnalyticsData.metrics.estimates.totalAmount > 0 || employeeAnalyticsData.metrics.invoices.totalAmount > 0) {
            employeeCharts.sales_overview = {
              type: "doughnut",
              data: {
                labels: [`Estimates ($${employeeAnalyticsData.metrics.estimates.totalAmount.toLocaleString()})`, `Invoices ($${employeeAnalyticsData.metrics.invoices.totalAmount.toLocaleString()})`],
                datasets: [{
                  data: [employeeAnalyticsData.metrics.estimates.totalAmount, employeeAnalyticsData.metrics.invoices.totalAmount],
                  backgroundColor: ["#FF6384", "#36A2EB"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Sales Overview - ${employeeAnalyticsData.employee.name}`,
                    font: { size: 16, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 12 } }
                  }
                }
              }
            };
          }
          
          // Include estimate status breakdown if there are estimates with different statuses
          const estimateStatuses = Object.keys(employeeAnalyticsData.metrics.estimates.statusBreakdown);
          if (estimateStatuses.length > 1 && employeeAnalyticsData.metrics.estimates.total > 0) {
            employeeCharts.estimate_status = {
              type: "pie",
              data: {
                labels: estimateStatuses.map(status => 
                  `${status.charAt(0).toUpperCase() + status.slice(1)} (${employeeAnalyticsData.metrics.estimates.statusBreakdown[status]})`
                ),
                datasets: [{
                  data: Object.values(employeeAnalyticsData.metrics.estimates.statusBreakdown),
                  backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Estimate Status Breakdown - ${employeeAnalyticsData.employee.name}`,
                    font: { size: 14, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 11 } }
                  }
                }
              }
            };
          }
          
          // Include invoice status breakdown if there are invoices with different statuses
          const invoiceStatuses = Object.keys(employeeAnalyticsData.metrics.invoices.statusBreakdown);
          if (invoiceStatuses.length > 1 && employeeAnalyticsData.metrics.invoices.total > 0) {
            employeeCharts.invoice_status = {
              type: "pie",
              data: {
                labels: invoiceStatuses.map(status => 
                  `${status.charAt(0).toUpperCase() + status.slice(1)} (${employeeAnalyticsData.metrics.invoices.statusBreakdown[status]})`
                ),
                datasets: [{
                  data: Object.values(employeeAnalyticsData.metrics.invoices.statusBreakdown),
                  backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Invoice Status Breakdown - ${employeeAnalyticsData.employee.name}`,
                    font: { size: 14, weight: "bold" }
                  },
                  legend: {
                    position: "bottom",
                    labels: { font: { size: 11 } }
                  }
                }
              }
            };
          }
          
          // Include monthly trends if there are multiple months of data
          if (employeeAnalyticsData.trends.hasMultipleMonths && employeeAnalyticsData.trends.monthLabels.length > 1) {
            employeeCharts.monthly_trends = {
              type: "line",
              data: {
                labels: employeeAnalyticsData.trends.monthLabels,
                datasets: [
                  {
                    label: "Estimate Amount",
                    data: employeeAnalyticsData.trends.estimateTrends.map(t => t.amount),
                    borderColor: "#FF6384",
                    backgroundColor: "rgba(255, 99, 132, 0.1)",
                    tension: 0.4
                  },
                  {
                    label: "Invoice Amount",
                    data: employeeAnalyticsData.trends.invoiceTrends.map(t => t.amount),
                    borderColor: "#36A2EB",
                    backgroundColor: "rgba(54, 162, 235, 0.1)",
                    tension: 0.4
                  }
                ]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Monthly Sales Trends - ${employeeAnalyticsData.employee.name}`,
                    font: { size: 16, weight: "bold" }
                  },
                  legend: {
                    position: "bottom"
                  }
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: function(value: any) {
                        return "$" + value.toLocaleString();
                      }
                    }
                  }
                }
              }
            };
          }
          
          // Include conversion gauge if there are estimates to convert
          if (employeeAnalyticsData.metrics.conversion.totalEstimates > 0) {
            employeeCharts.conversion_gauge = {
              type: "doughnut",
              data: {
                labels: ["Converted", "Not Converted"],
                datasets: [{
                  data: [employeeAnalyticsData.metrics.conversion.closedEstimates, employeeAnalyticsData.metrics.conversion.totalEstimates - employeeAnalyticsData.metrics.conversion.closedEstimates],
                  backgroundColor: ["#4BC0C0", "#FF6384"],
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  title: {
                    display: true,
                    text: `Conversion Rate: ${employeeAnalyticsData.metrics.conversion.rate.toFixed(1)}%`,
                    font: { size: 14, weight: "bold" }
                  }
                }
              }
            };
          }

          return {
            content: [
              { 
                type: "text", 
                text: JSON.stringify({
                  summary: employeeAnalyticsData.summary,
                  charts: employeeCharts,
                  rawData: employeeAnalyticsData
                }, null, 2) 
              }
            ]
          };
        }

                  // Employee Comparison Analytics
          if (analysis_type === "employee_comparison_analytics") {
            if (!employee_names || employee_names.length < 2) {
              return {
                content: [{
                  type: "text", 
                  text: "Error: employee_comparison_analytics requires at least 2 employee names in the employee_names array."
                }]
              };
            }

            console.log(`🔍 employee_comparison_analytics: Analyzing ${employee_names.length} employees - ${employee_names.join(', ')}`);

            // Fetch all estimates and invoices for the date range
            const estimateSearch = await SHARED_UTILITIES.api.estimates.search("", {
              from_date: parsedFromDate,
              to_date: parsedToDate,
              take: 1000
            });
            if (!estimateSearch.success) {
              return { content: [{ type: "text", text: `Error fetching estimates: ${estimateSearch.message}` }] };
            }
            const allEstimates = estimateSearch.result || [];

            const invoiceSearch = await SHARED_UTILITIES.api.invoices.search("", {
              from_date: parsedFromDate,
              to_date: parsedToDate,
              take: 1000
            });
            if (!invoiceSearch.success) {
              return { content: [{ type: "text", text: `Error fetching invoices: ${invoiceSearch.message}` }] };
            }
            const allInvoices = invoiceSearch.result || [];

            // Analyze each employee
            const employeeResults: Record<string, any> = {};
            const comparisonCharts: Record<string, any> = {};

            for (const employeeName of employee_names) {
              console.log(`🔍 Analyzing employee: ${employeeName}`);
              
              // Get estimates for this employee
              const employeeEstimates = allEstimates.filter((estimate: any) => {
                const preparedBy = estimate.prepared_by || '';
                const employeeNameFromField = preparedBy.split(' - ')[0]?.trim() || '';
                return employeeNameFromField.toLowerCase() === employeeName.toLowerCase();
              });

              // Get invoices for this employee
              const employeeInvoices = allInvoices.filter((invoice: any) => {
                const preparedBy = invoice.prepared_by || '';
                const employeeNameFromField = preparedBy.split(' - ')[0]?.trim() || '';
                return employeeNameFromField.toLowerCase() === employeeName.toLowerCase();
              });

              console.log(`📊 ${employeeName}: Found ${employeeEstimates.length} estimates and ${employeeInvoices.length} invoices`);

              // Use shared utilities for analysis
              const analysisResult = ANALYTICS_UTILITIES.generateDetailedSummary(
                "Employee Sales Analytics",
                employeeName,
                employeeEstimates,
                employeeInvoices,
                `from ${parsedFromDate} to ${parsedToDate} (inclusive)`
              );

            // Get unique customers for this employee
            const employeeCustomers = new Set<string>();
            [...employeeEstimates, ...employeeInvoices].forEach(item => {
              if (item.customer_name) {
                employeeCustomers.add(item.customer_name);
              }
            });

            // Store employee results
            employeeResults[employeeName] = {
              summary: analysisResult.summary,
              metrics: {
                estimates: {
                  total: employeeEstimates.length,
                  totalAmount: analysisResult.totalEstimateAmount,
                  statusBreakdown: analysisResult.estimateAnalysis.statusCounts,
                  open: analysisResult.estimateAnalysis.summary.open,
                  closed: analysisResult.estimateAnalysis.summary.closed
                },
                invoices: {
                  total: employeeInvoices.length,
                  totalAmount: analysisResult.totalInvoiceAmount,
                  statusBreakdown: analysisResult.invoiceAnalysis.statusCounts,
                  open: analysisResult.invoiceAnalysis.summary.open,
                  paid: analysisResult.invoiceAnalysis.summary.paid
                },
                conversion: {
                  rate: analysisResult.conversionRate,
                  closedEstimates: analysisResult.estimateAnalysis.summary.closed,
                  totalEstimates: employeeEstimates.length
                },
                customers: {
                  uniqueCount: employeeCustomers.size,
                  customerList: Array.from(employeeCustomers)
                }
              },
              rawData: {
                estimates: employeeEstimates.length,
                invoices: employeeInvoices.length,
                totalEstimateAmount: analysisResult.totalEstimateAmount,
                totalInvoiceAmount: analysisResult.totalInvoiceAmount,
                openEstimates: analysisResult.estimateAnalysis.summary.open,
                closedEstimates: analysisResult.estimateAnalysis.summary.closed,
                openInvoices: analysisResult.invoiceAnalysis.summary.open,
                paidInvoices: analysisResult.invoiceAnalysis.summary.paid,
                conversionRate: analysisResult.conversionRate,
                uniqueCustomers: employeeCustomers.size
              }
            };
          }

          // Generate comparison charts
          const employeeNames = Object.keys(employeeResults);
          const colors = ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF", "#FF9F40"];

          // Sales Overview Comparison Chart
          comparisonCharts.sales_comparison = {
            type: "bar",
            data: {
              labels: employeeNames,
              datasets: [
                {
                  label: "Total Estimate Amount",
                  data: employeeNames.map(name => employeeResults[name].metrics.estimates.totalAmount),
                  backgroundColor: colors[0],
                  borderColor: colors[0],
                  borderWidth: 1
                },
                {
                  label: "Total Invoice Amount",
                  data: employeeNames.map(name => employeeResults[name].metrics.invoices.totalAmount),
                  backgroundColor: colors[1],
                  borderColor: colors[1],
                  borderWidth: 1
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                title: {
                  display: true,
                  text: `Sales Comparison - from ${parsedFromDate} to ${parsedToDate}`,
                  font: { size: 16, weight: "bold" }
                },
                legend: {
                  position: "bottom"
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    callback: function(value: any) {
                      return "$" + value.toLocaleString();
                    }
                  }
                }
              }
            }
          };

          // Estimate Count Comparison Chart
          comparisonCharts.estimate_count_comparison = {
            type: "bar",
            data: {
              labels: employeeNames,
              datasets: [
                {
                  label: "Open Estimates",
                  data: employeeNames.map(name => employeeResults[name].metrics.estimates.open),
                  backgroundColor: colors[2],
                  borderColor: colors[2],
                  borderWidth: 1
                },
                {
                  label: "Closed Estimates",
                  data: employeeNames.map(name => employeeResults[name].metrics.estimates.closed),
                  backgroundColor: colors[3],
                  borderColor: colors[3],
                  borderWidth: 1
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                title: {
                  display: true,
                  text: `Estimate Status Comparison - from ${parsedFromDate} to ${parsedToDate}`,
                  font: { size: 14, weight: "bold" }
                },
                legend: {
                  position: "bottom"
                }
              },
              scales: {
                y: {
                  beginAtZero: true
                }
              }
            }
          };

          // Invoice Count Comparison Chart
          comparisonCharts.invoice_count_comparison = {
            type: "bar",
            data: {
              labels: employeeNames,
              datasets: [
                {
                  label: "Open Invoices",
                  data: employeeNames.map(name => employeeResults[name].metrics.invoices.open),
                  backgroundColor: colors[4],
                  borderColor: colors[4],
                  borderWidth: 1
                },
                {
                  label: "Paid Invoices",
                  data: employeeNames.map(name => employeeResults[name].metrics.invoices.paid),
                  backgroundColor: colors[5],
                  borderColor: colors[5],
                  borderWidth: 1
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                title: {
                  display: true,
                  text: `Invoice Status Comparison - from ${parsedFromDate} to ${parsedToDate}`,
                  font: { size: 14, weight: "bold" }
                },
                legend: {
                  position: "bottom"
                }
              },
              scales: {
                y: {
                  beginAtZero: true
                }
              }
            }
          };

          // Conversion Rate Comparison Chart
          comparisonCharts.conversion_rate_comparison = {
            type: "bar",
            data: {
              labels: employeeNames,
              datasets: [{
                label: "Conversion Rate (%)",
                data: employeeNames.map(name => employeeResults[name].metrics.conversion.rate),
                backgroundColor: employeeNames.map((_, index) => colors[index % colors.length]),
                borderColor: employeeNames.map((_, index) => colors[index % colors.length]),
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              plugins: {
                title: {
                  display: true,
                  text: `Conversion Rate Comparison - from ${parsedFromDate} to ${parsedToDate}`,
                  font: { size: 14, weight: "bold" }
                },
                legend: {
                  position: "bottom"
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  max: 100,
                  ticks: {
                    callback: function(value: any) {
                      return value + "%";
                    }
                  }
                }
              }
            }
          };

          // Customer Count Comparison Chart
          comparisonCharts.customer_count_comparison = {
            type: "bar",
            data: {
              labels: employeeNames,
              datasets: [{
                label: "Unique Customers",
                data: employeeNames.map(name => employeeResults[name].metrics.customers.uniqueCount),
                backgroundColor: employeeNames.map((_, index) => colors[index % colors.length]),
                borderColor: employeeNames.map((_, index) => colors[index % colors.length]),
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              plugins: {
                title: {
                  display: true,
                  text: `Customer Count Comparison - from ${parsedFromDate} to ${parsedToDate}`,
                  font: { size: 14, weight: "bold" }
                },
                legend: {
                  position: "bottom"
                }
              },
              scales: {
                y: {
                  beginAtZero: true
                }
              }
            }
          };

          return {
            content: [
              { 
                type: "text", 
                text: JSON.stringify({
                  summary: `Employee Performance Comparison for ${employee_names.join(' vs ')} from ${parsedFromDate} to ${parsedToDate} (inclusive)`,
                  employeeResults,
                  comparisonCharts,
                  dateRange: {
                    from: parsedFromDate,
                    to: parsedToDate,
                    display: `from ${parsedFromDate} to ${parsedToDate} (inclusive)`
                  }
                }, null, 2) 
              }
            ]
          };
        }
        // Add more analysis types here as needed
        return { content: [{ type: "text", text: `Error: Unsupported analysis_type '${analysis_type}'.` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
}

export function registerAllTools(server: McpServer) {
  console.log("Registering utility tools...");
  registerUtilityTools(server);
  console.log("Registering business tools...");
  registerBusinessTools(server);
  console.log("Registering analytics tools...");
  registerAnalyticsTools(server);
  console.log("All tools registered!");
} 