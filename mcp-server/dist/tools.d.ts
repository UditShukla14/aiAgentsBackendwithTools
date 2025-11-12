import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare const SHARED_UTILITIES: {
    date: {
        addDays: (date: Date, days: number) => Date;
        addMonths: (date: Date, months: number) => Date;
        getWeekStart: (date: Date) => Date;
        getWeekEnd: (date: Date) => Date;
        getCurrentQuarter: (date: Date) => number;
        getQuarterRange: (year: number, quarter: number) => {
            start: Date;
            end: Date;
        };
        getLastQuarterRange: (date: Date) => {
            start: Date;
            end: Date;
        };
        getNextQuarterRange: (date: Date) => {
            start: Date;
            end: Date;
        };
        extractNumber: (str: string) => number | null;
        formatDate: (date: Date, formatStr?: string) => string;
        parseNaturalLanguageDate: (dateExpression: string) => {
            start: string;
            end: string;
        } | null;
    };
    api: {
        customers: {
            getList: (params?: {
                search?: string;
                take?: number;
                skip?: number;
                status?: string;
            }) => Promise<any>;
            getDetails: (customerId: string | number) => Promise<any>;
            search: (searchTerm: string, take?: number) => Promise<any>;
        };
        estimates: {
            getList: (params?: {
                search?: string;
                from_date?: string;
                to_date?: string;
                take?: number;
                skip?: number;
                status?: string;
                customer_id?: string | number;
            }) => Promise<any>;
            getDetails: (estimateId: string | number) => Promise<any>;
            search: (searchTerm: string, params?: {
                from_date?: string;
                to_date?: string;
                take?: number;
            }) => Promise<any>;
        };
        invoices: {
            getList: (params?: {
                search?: string;
                from_date?: string;
                to_date?: string;
                take?: number;
                skip?: number;
                status?: string;
                customer_id?: string | number;
                get_all?: boolean;
            }) => Promise<any>;
            getDetails: (invoiceId: string | number) => Promise<any>;
            search: (searchTerm: string, params?: {
                from_date?: string;
                to_date?: string;
                take?: number;
            }) => Promise<any>;
        };
        tasks: {
            getList: (params?: {
                object_name?: string;
                object_id?: string | number;
                filter?: string;
                page?: number;
                take?: number;
                search?: string;
                employee_name?: string;
                show_all?: boolean;
            }) => Promise<any>;
            getDetails: (taskId: string | number) => Promise<any>;
            getDetailsByCustomNumber: (customNumber: string) => Promise<any>;
        };
        products: {
            getList: (params?: {
                search?: string;
                take?: number;
                skip?: number;
                category?: string;
                status?: string;
            }) => Promise<any>;
            getDetails: (productId: string | number) => Promise<any>;
            search: (searchTerm: string, take?: number) => Promise<any>;
        };
        employees: {
            getList: (params?: {
                search?: string;
                take?: number;
                skip?: number;
                role?: string;
            }) => Promise<any>;
            getDetails: (employeeId: string | number) => Promise<any>;
        };
        analytics: {
            getSalesData: (params?: {
                from_date?: string;
                to_date?: string;
                customer_id?: string | number;
                include_estimates?: boolean;
                include_invoices?: boolean;
            }) => Promise<any>;
            getCustomerData: (customerId: string | number, params?: {
                from_date?: string;
                to_date?: string;
            }) => Promise<any>;
        };
        utils: {
            getCompanyInfo: () => Promise<any>;
            getUserInfo: () => Promise<any>;
            getSystemStatus: () => Promise<any>;
        };
    };
};
export declare const BASE_URL = "https://app.invoicemakerpro.com";
export declare const HARDCODED_TOKEN = "SERVICESEERS_EAAAEAcaEROsO6yeAPYugIlrKsouynS5f0iDnXQ";
export declare const HARDCODED_ROLE = "company";
export declare const REQUIRED_FIELDS: {
    token: string;
    role: string;
    user_id: string;
    company_id: number;
    imp_session_id: string;
};
export declare const RATE_LIMIT: {
    maxRequests: number;
    windowMs: number;
    retryDelay: number;
    maxRetries: number;
};
export declare function callIMPApi(endpoint: string, additionalParams?: Record<string, any>): Promise<any>;
export declare function registerUtilityTools(server: McpServer): void;
export declare function registerBusinessTools(server: McpServer): void;
export declare function registerAnalyticsTools(server: McpServer): void;
export declare function registerAllTools(server: McpServer): void;
