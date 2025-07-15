// Static data and keyword arrays for MCP Backend

export const greetings = [
  'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
  'thanks', 'thank you', 'ty', 'thx', 'bye', 'goodbye', 'see you', 'later',
  'how are you', 'whats up', 'wassup', 'morning', 'evening'
];

export const dateKeywords = [
  'yesterday', 'today', 'tomorrow', 'last', 'this', 'next', 'past', 'ago',
  'date', 'time', 'period', 'range', 'week', 'month', 'year', 'days',
  'quarter', 'decade', 'century', 'morning', 'afternoon', 'evening',
  'night', 'dawn', 'dusk', 'noon', 'midnight', 'hour', 'minute', 'second',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'what is', 'when is'
];

export const simplePatterns = [
  'what can you do', 'help me', 'who are you', 'how do i',
  'can you help', 'what are your capabilities', 'what tools', 'how does this work'
];

export const businessKeywords = [
  'customer', 'product', 'invoice', 'estimate', 'search', 'find', 'get', 'list', 
  'show', 'display', 'fetch', 'retrieve', 'lookup', 'details', 'info', 'address',
  'email', 'phone', 'contact', 'create', 'add', 'update', 'delete'
];

export const complexPatterns = [
  'compare', 'analyze', 'report', 'calculate', 'multiple', 'all customers who',
  'send email', 'generate report', 'analysis', 'summary', 'overview', 'dashboard',
  'export', 'import', 'bulk', 'batch'
];

export const allowedOrigins = [
  "https://app.worxstream.io", // ✅ Production frontend
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173"
]; 