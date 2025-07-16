// tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerBusinessTools } from "./businessTools.js";


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

export function registerAllTools(server: McpServer) {
  console.log("Registering utility tools...");
  registerUtilityTools(server);
  console.log("Registering business tools...");
  registerBusinessTools(server);
  console.log("All tools registered!");
} 