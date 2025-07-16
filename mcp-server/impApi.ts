import { BASE_URL, REQUIRED_FIELDS, RATE_LIMIT } from "./staticData";

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