import { GREETING_PROMPT, SIMPLE_PROMPT, BUSINESS_PROMPT, SYSTEM_PROMPT } from './resources/prompts.js';
import { greetings, dateKeywords, simplePatterns, businessKeywords, complexPatterns } from './resources/staticData.js';

// Utility to remove internal IDs from user-facing text
export function filterInternalIds(text: string): string {
    // Remove lines containing internal IDs (id, customer_id, product_id, invoice_id, etc.)
    return text.replace(/\b(id|customer_id|product_id|invoice_id|estimate_id|user_id|quickbook_customer_id|handshake_key|assign_employee_user_id)\b\s*[:=]\s*['"\d\w-]+,?/gi, '')
      .replace(/\b(id|customer_id|product_id|invoice_id|estimate_id|user_id|quickbook_customer_id|handshake_key|assign_employee_user_id)\b\s*[:=]\s*['"\d\w-]+/gi, '')
      .replace(/\n\s*\n/g, '\n') // Remove extra blank lines
      .replace(/\{\s*,/g, '{') // Remove leading commas in objects
      .replace(/,\s*\}/g, '}'); // Remove trailing commas in objects
  }

// Smart query classification for token optimization
export function classifyQuery(query: string): 'greeting' | 'simple' | 'business' | 'complex' {
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
export function getSystemPrompt(queryType: string): string {
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


// Calculate max tokens based on query type
export function getMaxTokens(queryType: string): number {
    switch (queryType) {
      case 'greeting': return 100;
      case 'simple': return 300;
      case 'business': return 1500;
      case 'complex': return 2000;
      default: return 2000;
    }
  }

  
  