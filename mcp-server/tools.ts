// tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Static data for MCP server tools

export const BASE_URL = "https://invoicemakerpro.com";
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
    "Search for products by name, SKU, or description. Use this for general product searches or when looking for multiple products. Returns a list of matching products.",
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
  
        return {
          content: [
            {
              type: "text",
              text: `Found ${data.result?.length || 0} products matching "${search}":\n\n${JSON.stringify(data.result || [], null, 2)}\n\n💡 Tip: To get detailed information about any of these products, you can ask "get details for [product name]" or use the exact product ID.`,
            },
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
    "Get list of estimates with optional filtering by date range and search term",
    {
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
      search: z.string().optional().describe("Search term for estimate number, customer name, etc."),
      take: z.number().default(25).describe("Number of estimates to return (default: 25)"),
      skip: z.number().optional().describe("Number of estimates to skip for pagination"),
    },
    async ({ from_date, to_date, search, take = 25, skip }) => {
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
  
        const data = await callIMPApi("/api/estimate/list", {
          ...(cleanFromDate && { from_date: cleanFromDate }),
          ...(cleanToDate && { to_date: cleanToDate }),
          ...(search && { search }),
          take,
          ...(skip && { skip })
        });
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching estimates: ${data.message}` }] };
        }
  
        return {
          content: [
            {
              type: "text",
              text: `Found ${data.result?.length || 0} estimates:\n\n${JSON.stringify(data.result || [], null, 2)}\n\n📋 Use filters like from_date, to_date, or search to narrow down results.`,
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
    "Get list of invoices with optional filtering by date range and search term. When user asks for 'all invoices', 'complete list', 'full data', or similar requests, set get_all to true to fetch all records in a single request.",
    {
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
      search: z.string().optional().describe("Search term for invoice number, customer name, etc."),
      take: z.number().default(25).describe("Number of invoices to return (default: 25)"),
      skip: z.number().optional().describe("Number of invoices to skip for pagination"),
      get_all: z.boolean().default(false).describe("Set to true when user requests all data, complete list, or full records. This will fetch all records in a single request."),
    },
    async ({ from_date, to_date, search, take = 25, skip, get_all = false }) => {
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
          take: get_all ? totalRecords : take,
          ...(skip && { skip })
        };
  
        const data = await callIMPApi("/api/invoice_list", params);
  
        if (!data.success) {
          return { content: [{ type: "text", text: `Error fetching invoices: ${data.message}` }] };
        }
  
        const invoices = data.result || [];
        
        const formattedResponse = {
          total_invoices: data.total_record || 0,
          total_pages: data.total_page || 1,
          current_page: data.page || 1,
          invoices_per_page: get_all ? totalRecords : take,
          date_range: {
            from: cleanFromDate,
            to: cleanToDate
          },
          search_params: {
            search_term: search,
            take: get_all ? totalRecords : take,
            skip,
            get_all
          },
          pagination: {
            current_page: data.page || 1,
            total_pages: data.total_page || 1,
            has_next: data.links?.some((link: any) => link.label === "Next &raquo;"),
            has_previous: data.links?.some((link: any) => link.label === "&laquo; Previous"),
            page_links: data.links?.map((link: any) => ({
              label: link.label,
              url: link.url,
              is_active: link.active
            }))
          },
          invoices: invoices.map((invoice: any) => ({
            id: invoice.invoice_id,
            custom_number: invoice.custom_invoice_number,
            invoice_date: invoice.invoice_date,
            customer: {
              id: invoice.customer_id,
              name: invoice.customer_name,
              email: invoice.customer_email,
              phone: invoice.customer_phone
            },
            status: {
              id: invoice.status_id,
              name: invoice.status_name,
              color: invoice.status_color
            },
            totals: {
              subtotal: invoice.sub_total,
              discount: invoice.discount,
              tax: invoice.tax,
              grand_total: invoice.grand_total
            },
            po_number: invoice.ext_po_number,
            quotation_id: invoice.quotation_id,
            preview_url: invoice.preview,
            payment_preview_url: invoice.payment_preview
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
        const data = await callIMPApi("/api/customer_list", {
          ...(search && { search }),
          take,
          ...(skip && { skip })
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
  
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ result: normalizedCustomers })
            },
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
  
        // Build a human-readable summary
        let summary = `[DISPLAY_VERBATIM] Delivery Board (${params.from_date} to ${params.to_date}):\n`;
        if (formatted.length === 0) {
          summary += 'No deliveries scheduled for this period.';
        } else {
          formatted.forEach((event: typeof formatted[0], idx: number) => {
            summary += `\n${idx + 1}. ${event.type === 'estimate' ? 'Estimate' : 'Delivery'} scheduled for ${event.delivery_date}`;
            if (event.job_name) summary += `\n   - Job: ${event.job_name}`;
            if (event.job_location) summary += `\n   - Location: ${event.job_location}`;
            if (event.ext_po_number) summary += `\n   - PO Number: ${event.ext_po_number}`;
            if (event.grand_total) summary += `\n   - Amount: $${Number(event.grand_total).toLocaleString()}`;
            if (event.customer && event.customer.name) summary += `\n   - Customer: ${event.customer.name}`;
            summary += `\n   - Delivered: ${event.is_delivered === '1' ? 'Yes' : 'No'}`;
            if (event.package_list) summary += `\n   - 📦 Packing List: ${event.package_list}`;
          });
        }
  
        return {
          content: [
            {
              type: "text",
              text: summary
            },
            {
              type: "text",
              text: JSON.stringify({
                date_range: { from: params.from_date, to: params.to_date },
                total_events: formatted.length,
                events: formatted
              }, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );

  
}

// Register analytics tools (for chart-ready business analysis)
export function registerAnalyticsTools(server: McpServer) {
  server.tool(
    "analyzeBusinessData",
    "Analyze business data and return chart-ready JSON for infographics. Supports queries like 'total sale for customer {customer name}'.",
    {
      analysis_type: z.enum(["total_sale_for_customer"]).describe("Type of analysis to perform. Currently supports: total_sale_for_customer"),
      customer_name: z.string().optional().describe("Customer name for customer-specific analysis"),
      from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
      to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
    },
    async ({ analysis_type, customer_name, from_date, to_date }) => {
      try {
        if (analysis_type === "total_sale_for_customer") {
          if (!customer_name) {
            return {
              content: [{ type: "text", text: "Error: customer_name is required for this analysis." }]
            };
          }

          // 1. Directly get all estimates for this customer_name as search term
          const estimateSearch = await callIMPApi("/api/estimate/list", {
            search: customer_name,
            take: 1000,
            ...(from_date && { from_date }),
            ...(to_date && { to_date })
          });
          if (!estimateSearch.success) {
            return { content: [{ type: "text", text: `Error fetching estimates: ${estimateSearch.message}` }] };
          }
          const estimates = estimateSearch.result || [];

          // 2. Directly get all invoices for this customer_name as search term
          const invoiceSearch = await callIMPApi("/api/invoice_list", {
            search: customer_name,
            take: 1000,
            ...(from_date && { from_date }),
            ...(to_date && { to_date })
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

          // 3. Aggregate statuses for estimates and invoices
          const estimateStatusCounts: Record<string, number> = {};
          let openEstimates = 0, closedEstimates = 0;
          for (const est of estimates) {
            const status = (est.status_name || '').toLowerCase();
            estimateStatusCounts[status] = (estimateStatusCounts[status] || 0) + 1;
            if (status.includes('open') || status.includes('pending') || status.includes('draft')) openEstimates++;
            else if (status.includes('closed') || status.includes('accepted') || status.includes('won') || status.includes('converted')) closedEstimates++;
          }

          const invoiceStatusCounts: Record<string, number> = {};
          let openInvoices = 0, paidInvoices = 0;
          for (const inv of invoices) {
            const status = (inv.status_name || '').toLowerCase();
            invoiceStatusCounts[status] = (invoiceStatusCounts[status] || 0) + 1;
            if (status.includes('open') || status.includes('unpaid') || status.includes('pending')) openInvoices++;
            else if (status.includes('paid') || status.includes('closed') || status.includes('complete')) paidInvoices++;
          }

          // 4. Conversion rate: closed/accepted/converted estimates that have a corresponding invoice
          let convertedEstimates = closedEstimates;
          let conversionRate = estimates.length > 0 ? (convertedEstimates / estimates.length) * 100 : 0;

          // 5. Totals
          let totalEstimateAmount = 0;
          let totalInvoiceAmount = 0;
          for (const est of estimates) {
            let val = 0;
            if (est.totals && est.totals.grand_total) val = parseFloat(est.totals.grand_total);
            else if (est.grand_total) val = parseFloat(est.grand_total);
            else if (est.quotation_total) val = parseFloat(est.quotation_total);
            if (!isNaN(val)) totalEstimateAmount += val;
          }
          for (const inv of invoices) {
            let val = 0;
            if (inv.totals && inv.totals.grand_total) val = parseFloat(inv.totals.grand_total);
            else if (inv.grand_total) val = parseFloat(inv.grand_total);
            if (!isNaN(val)) totalInvoiceAmount += val;
          }

          // 6. Chart-ready JSON for open vs closed estimates (with colors)
          const estimateChart = {
            chartType: "pie",
            title: `Estimates Status for ${customerDisplayName}`,
            labels: ["Open", "Closed"],
            datasets: [
              {
                label: "Estimates",
                data: [openEstimates, closedEstimates],
                backgroundColor: ["#36A2EB", "#4BC0C0"] // blue, teal
              }
            ]
          };

          // 7. Chart-ready JSON for open vs paid invoices (with colors)
          const invoiceChart = {
            chartType: "pie",
            title: `Invoices Status for ${customerDisplayName}`,
            labels: ["Open", "Paid"],
            datasets: [
              {
                label: "Invoices",
                data: [openInvoices, paidInvoices],
                backgroundColor: ["#FF6384", "#36A2EB"] // red, blue
              }
            ]
          };
         
          // 9. Human summary string
          // const summaryString = await generateSummaryWithClaude({ estimateChart, invoiceChart }); // Removed Anthropic call
          // 10. Only return chart JSON, no summary, no [DISPLAY_VERBATIM]
          const chartJson = {
            estimateChart,
            invoiceChart,
            summary: `Summary for ${customerDisplayName}:\n- Total Estimates: ${estimates.length}\n- Total Invoices: ${invoices.length}\n- Total Estimate Amount: $${totalEstimateAmount.toLocaleString()}\n- Total Invoice Amount: $${totalInvoiceAmount.toLocaleString()}\n- Open Estimates: ${openEstimates}\n- Closed Estimates: ${closedEstimates}\n- Open Invoices: ${openInvoices}\n- Paid Invoices: ${paidInvoices}\n- Conversion Rate: ${conversionRate.toFixed(2)}%`
          };
          return {
            content: [
              { type: "text", text: JSON.stringify(chartJson, null, 2) }
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