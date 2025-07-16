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