// tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BASE_URL = "https://invoicemakerpro.com";
const HARDCODED_TOKEN = "SERVICESEERS_EAAAEAcaEROsO6yeAPYugIlrKsouynS5f0iDnXQ";
const HARDCODED_ROLE = "company";

const REQUIRED_FIELDS = {
  token: HARDCODED_TOKEN,
  role: HARDCODED_ROLE,
  user_id: "800002269",
  company_id: 500001290,
  imp_session_id: "13064|8257622c-1c29-4097-86ec-fb1bf9c7b745",
};

/**
 * Helper function to make API calls with required fields
 */
async function callIMPApi(endpoint: string, additionalParams: Record<string, any> = {}) {
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

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
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
    "Perform date calculations, validation, and formatting operations",
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
        
        // Helper function to parse date
        const parseDate = (dateStr: string): Date | null => {
          // Try ISO format first
          const isoDate = new Date(dateStr);
          if (!isNaN(isoDate.getTime())) return isoDate;
          
          // Try natural language
          const lowerDate = dateStr.toLowerCase();
          if (lowerDate === 'today') return today;
          if (lowerDate === 'yesterday') {
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            return yesterday;
          }
          if (lowerDate === 'tomorrow') {
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            return tomorrow;
          }
          
          return null;
        };
        
        // Helper function to format date
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

        switch (operation) {
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

          case 'format':
            if (!date) {
              return { content: [{ type: "text", text: "Error: Date parameter required for formatting" }] };
            }
            const dateToFormat = parseDate(date);
            if (!dateToFormat) {
              return { content: [{ type: "text", text: "Error: Invalid date provided" }] };
            }
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  original_date: date,
                  formatted_date: formatDate(dateToFormat, format),
                  available_formats: {
                    ISO: formatDate(dateToFormat, 'ISO'),
                    "MM/DD/YYYY": formatDate(dateToFormat, 'MM/DD/YYYY'),
                    "DD-MM-YYYY": formatDate(dateToFormat, 'DD-MM-YYYY'),
                    "YYYY/MM/DD": formatDate(dateToFormat, 'YYYY/MM/DD')
                  }
                }, null, 2)
              }]
            };

          case 'add':
            if (!date || !amount || !unit) {
              return { content: [{ type: "text", text: "Error: Date, amount, and unit parameters required for add operation" }] };
            }
            const baseDate = parseDate(date);
            if (!baseDate) {
              return { content: [{ type: "text", text: "Error: Invalid base date provided" }] };
            }
            const addedDate = new Date(baseDate);
            switch (unit) {
              case 'days':
                addedDate.setDate(baseDate.getDate() + amount);
                break;
              case 'weeks':
                addedDate.setDate(baseDate.getDate() + (amount * 7));
                break;
              case 'months':
                addedDate.setMonth(baseDate.getMonth() + amount);
                break;
              case 'years':
                addedDate.setFullYear(baseDate.getFullYear() + amount);
                break;
            }
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  base_date: formatDate(baseDate),
                  operation: `add ${amount} ${unit}`,
                  result_date: formatDate(addedDate),
                  human_readable: addedDate.toLocaleDateString()
                }, null, 2)
              }]
            };

          case 'subtract':
            if (!date || !amount || !unit) {
              return { content: [{ type: "text", text: "Error: Date, amount, and unit parameters required for subtract operation" }] };
            }
            const baseDateSub = parseDate(date);
            if (!baseDateSub) {
              return { content: [{ type: "text", text: "Error: Invalid base date provided" }] };
            }
            const subtractedDate = new Date(baseDateSub);
            switch (unit) {
              case 'days':
                subtractedDate.setDate(baseDateSub.getDate() - amount);
                break;
              case 'weeks':
                subtractedDate.setDate(baseDateSub.getDate() - (amount * 7));
                break;
              case 'months':
                subtractedDate.setMonth(baseDateSub.getMonth() - amount);
                break;
              case 'years':
                subtractedDate.setFullYear(baseDateSub.getFullYear() - amount);
                break;
            }
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  base_date: formatDate(baseDateSub),
                  operation: `subtract ${amount} ${unit}`,
                  result_date: formatDate(subtractedDate),
                  human_readable: subtractedDate.toLocaleDateString()
                }, null, 2)
              }]
            };

          case 'difference':
            if (!date || !date2) {
              return { content: [{ type: "text", text: "Error: Two dates required for difference calculation" }] };
            }
            const date1 = parseDate(date);
            const date2Parsed = parseDate(date2);
            if (!date1 || !date2Parsed) {
              return { content: [{ type: "text", text: "Error: Invalid date(s) provided" }] };
            }
            const diffTime = Math.abs(date2Parsed.getTime() - date1.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const diffWeeks = Math.floor(diffDays / 7);
            const diffMonths = Math.floor(diffDays / 30.44);
            const diffYears = Math.floor(diffDays / 365.25);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  date1: formatDate(date1),
                  date2: formatDate(date2Parsed),
                  difference: {
                    days: diffDays,
                    weeks: diffWeeks,
                    months: diffMonths,
                    years: diffYears
                  },
                  is_future: date2Parsed > date1,
                  is_past: date2Parsed < date1,
                  is_same: date1.getTime() === date2Parsed.getTime()
                }, null, 2)
              }]
            };

          case 'parse':
            if (!date) {
              return { content: [{ type: "text", text: "Error: Date parameter required for parsing" }] };
            }
            const parsedDateResult = parseDate(date);
            if (!parsedDateResult) {
              return { content: [{ type: "text", text: "Error: Could not parse date" }] };
            }
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  input: date,
                  parsed_date: formatDate(parsedDateResult),
                  components: {
                    year: parsedDateResult.getFullYear(),
                    month: parsedDateResult.getMonth() + 1,
                    day: parsedDateResult.getDate(),
                    day_of_week: parsedDateResult.getDay(),
                    day_name: parsedDateResult.toLocaleDateString('en-US', { weekday: 'long' }),
                    month_name: parsedDateResult.toLocaleDateString('en-US', { month: 'long' })
                  },
                  human_readable: parsedDateResult.toLocaleDateString(),
                  iso_string: parsedDateResult.toISOString()
                }, null, 2)
              }]
            };

          default:
            return { content: [{ type: "text", text: "Error: Unknown operation" }] };
        }
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );

  server.tool(
    "calculateDateRangeFromExpression",
    "Convert natural language date expressions to actual date ranges using Claude's understanding",
    {
      expression: z.string().describe("Natural language date expression (e.g., 'last week', 'this quarter', 'past 30 days')"),
      reference_date: z.string().optional().describe("Reference date (YYYY-MM-DD format, defaults to today)"),
    },
    async ({ expression, reference_date }) => {
      try {
        const today = new Date();
        const refDate = reference_date ? new Date(reference_date) : today;
        
        if (isNaN(refDate.getTime())) {
          return { content: [{ type: "text", text: "Error: Invalid reference date format" }] };
        }
        
        // Helper function to format date as YYYY-MM-DD
        const formatDate = (date: Date): string => {
          return date.toISOString().split('T')[0];
        };

        // Let Claude handle all date expression interpretation
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              instruction: "Please interpret this natural language date expression and calculate the actual date range.",
              expression: expression,
              reference_date: formatDate(refDate),
              current_date: formatDate(today),
              examples: {
                "last week": "from_date: 7 days ago from reference, to_date: end of that week",
                "this month": "from_date: first day of current month, to_date: last day of current month",
                "past 30 days": "from_date: 30 days ago from reference, to_date: reference date",
                "next week": "from_date: next Monday, to_date: next Sunday",
                "this quarter": "from_date: first day of current quarter, to_date: last day of current quarter",
                "yesterday": "from_date: yesterday, to_date: yesterday",
                "tomorrow": "from_date: tomorrow, to_date: tomorrow",
                "today": "from_date: today, to_date: today"
              },
              request: "Please calculate the actual from_date and to_date in YYYY-MM-DD format for the expression: " + expression
            }, null, 2)
          }]
        };

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

// Calculate Date Range Tool
server.tool(
  "calculateDateRange",
  "Calculate date range from natural language expressions or specific dates",
  {
    date_expression: z.string().describe("Natural language date expression (e.g., 'last week', 'past 30 days', '2024-03-01 to 2025-02-28', 'this month', 'next week')"),
  },
  async ({ date_expression }) => {
    try {
      const today = new Date();
      
      // Helper function to format date as YYYY-MM-DD
      const formatDate = (date: Date): string => {
        return date.toISOString().split('T')[0];
      };

      // Simple validation for exact date formats only
      const exactDateMatch = date_expression.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/i);
      if (exactDateMatch) {
        const fromDate = new Date(exactDateMatch[1]);
        const toDate = new Date(exactDateMatch[2]);
        
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Invalid date format in range",
                expression: date_expression,
                supported_formats: ["YYYY-MM-DD to YYYY-MM-DD"]
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              from_date: exactDateMatch[1],
              to_date: exactDateMatch[2],
              expression: date_expression,
              type: "exact_dates",
              days_difference: Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
            }, null, 2)
          }]
        };
      }

      // Single date validation
      const singleDateMatch = date_expression.match(/^\d{4}-\d{2}-\d{2}$/);
      if (singleDateMatch) {
        const date = new Date(date_expression);
        if (isNaN(date.getTime())) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Invalid date format",
                expression: date_expression,
                supported_formats: ["YYYY-MM-DD"]
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              from_date: date_expression,
              to_date: date_expression,
              expression: date_expression,
              type: "single_date"
            }, null, 2)
          }]
        };
      }

      // For all natural language expressions, let Claude handle the interpretation
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            instruction: "Please interpret this natural language date expression and return the corresponding date range in YYYY-MM-DD format.",
            expression: date_expression,
            current_date: formatDate(today),
            examples: {
              "last week": "from_date: 7 days ago, to_date: today",
              "this month": "from_date: first day of current month, to_date: last day of current month",
              "past 30 days": "from_date: 30 days ago, to_date: today",
              "next week": "from_date: next Monday, to_date: next Sunday",
              "this quarter": "from_date: first day of current quarter, to_date: last day of current quarter",
              "yesterday": "from_date: yesterday, to_date: yesterday",
              "tomorrow": "from_date: tomorrow, to_date: tomorrow",
              "today": "from_date: today, to_date: today"
            },
            request: "Please calculate the actual from_date and to_date in YYYY-MM-DD format for the expression: " + date_expression
          }, null, 2)
        }]
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
      }
      
      if (cleanToDate) {
        const toValidation = validateDate(cleanToDate);
        if (!toValidation.isValid) {
          return { content: [{ type: "text", text: toValidation.error! }] };
        }
        // Convert to ISO format for API
        cleanToDate = toValidation.parsedDate!.toISOString().split('T')[0];
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

      return {
        content: [
          {
            type: "text",
            text: `Found ${data.result?.length || data.data?.length || 0} customers:\n\n${JSON.stringify(data.result || data.data || [], null, 2)}\n\n📋 Use search parameter to filter customers by name, email, phone, or company.`,
          },
        ],
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
      });

      if (!data.success) {
        return { content: [{ type: "text", text: `Error fetching customer address: ${data.message}` }] };
      }

      return {
        content: [
          {
            type: "text",
            text: `Customer address information for ID "${customer_id}":\n\n${JSON.stringify(data.result || data.data || data, null, 2)}\n\n📋 Omit address_id to get primary/register address for this customer.`,
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

}

export function registerAllTools(server: McpServer) {
  console.log("Registering utility tools...");
  registerUtilityTools(server);
  console.log("Registering business tools...");
  registerBusinessTools(server);
  console.log("All tools registered!");
} 