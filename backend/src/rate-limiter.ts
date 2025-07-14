import { setTimeout } from 'timers/promises';

export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private timeWindow: number;
  private queue: Array<{
    resolve: (value: any) => void;
    reject: (error: any) => void;
    fn: () => Promise<any>;
  }> = [];
  private processing = false;

  constructor(maxRequests = 15, timeWindow = 60000) { // 15 requests per minute (conservative)
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, fn });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const now = Date.now();
      
      // Clean old requests
      this.requests = this.requests.filter(time => now - time < this.timeWindow);
      
      // Check if we can make a request
      if (this.requests.length >= this.maxRequests) {
        const oldestRequest = this.requests[0];
        const waitTime = this.timeWindow - (now - oldestRequest);
        console.log(`⏱️ Rate limit reached, waiting ${waitTime}ms before next request`);
        await setTimeout(waitTime);
        continue;
      }
      
      // Process next request
      const { resolve, reject, fn } = this.queue.shift()!;
      this.requests.push(now);
      
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
      
      // Small delay between requests to be extra safe
      await setTimeout(100);
    }
    
    this.processing = false;
  }

  getStatus() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    return {
      currentRequests: this.requests.length,
      maxRequests: this.maxRequests,
      timeWindow: this.timeWindow,
      queueLength: this.queue.length
    };
  }
}

export class RetryManager {
  static async retryWithExponentialBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        // Check if it's a rate limit error
        if (error.status === 529 || 
            error.message?.includes('Overloaded') || 
            error.message?.includes('rate limit') ||
            error.message?.includes('429')) {
          
          if (attempt === maxRetries) {
            throw error; // Give up after max retries
          }
          
          // Exponential backoff: 1s, 2s, 4s, 8s...
          const delay = Math.pow(2, attempt) * baseDelay;
          console.log(`🔄 Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await setTimeout(delay);
          continue;
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
    
    throw new Error('Max retries exceeded');
  }
}

// Global rate limiter instance
export const globalRateLimiter = new RateLimiter(15, 60000); // 15 requests per minute 