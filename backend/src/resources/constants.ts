/**
 * Constants for MCP React Client Backend
 * Centralized configuration and allowlists
 */

// Working directory
export const WORK_DIR = process.cwd();

// Allowed HTML elements for safe rendering
export const allowedHTMLElements = [
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details',
  'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'ins', 'kbd', 'li', 'ol', 'p', 'pre', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'source', 'span', 'strike', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'ul', 'var', 'table', 'card', 'chart', 'text'
];

// Custom tags for UI rendering
export const CUSTOM_TAGS = ['table', 'card', 'chart', 'text'];

// Default system settings
export const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
export const DEFAULT_MAX_TOKENS = 8000;
export const DEFAULT_TEMPERATURE = 0.7;

// Tool names
export const TOOLS = {
  DATE_UTILITY: 'date-utility',
  SEARCH_ESTIMATE: 'searchEstimateList',
  SEARCH_INVOICE: 'searchInvoiceList',
  SEARCH_CUSTOMER: 'searchCustomerList',
  SEARCH_PRODUCT: 'searchProductList',
  ANALYZE_DATA: 'analyzeBusinessData',
};

// Error messages
export const ERROR_MESSAGES = {
  NO_CONTENT: 'No content to display',
  INVALID_JSON: 'Failed to parse response data',
  TOOL_ERROR: 'Tool execution failed',
  TAG_ERROR: 'Failed to parse tagged content',
};

