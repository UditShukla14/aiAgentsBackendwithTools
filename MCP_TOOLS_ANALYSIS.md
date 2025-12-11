# MCP Tools Analysis

## Overview
This document provides a comprehensive analysis of all MCP (Model Context Protocol) tools available in the system. The tools are organized into three main categories: Utility Tools, Business Tools, and Analytics Tools.

**Total Tools: 19**

---

## 1. Utility Tools (3 tools)

### 1.1 `calculate`
- **Purpose**: Perform basic mathematical calculations
- **Parameters**:
  - `expression` (string): Mathematical expression to evaluate (e.g., '2 + 3 * 4')
- **Features**:
  - Sanitizes input to prevent code injection
  - Returns formatted calculation result
  - Error handling for invalid expressions

### 1.2 `analyze-text`
- **Purpose**: Analyze text for word count, character count, and readability metrics
- **Parameters**:
  - `text` (string): Text to analyze
- **Returns**:
  - Word count
  - Character count (with and without spaces)
  - Sentence count
  - Average words per sentence
  - Average characters per word

### 1.3 `date-utility`
- **Purpose**: Perform date calculations, validation, and formatting operations
- **Parameters**:
  - `operation` (enum): Type of operation - 'validate', 'format', 'add', 'subtract', 'difference', 'parse'
  - `date` (string, optional): Date to work with (YYYY-MM-DD format or natural language)
  - `format` (string, optional): Output format (e.g., 'MM/DD/YYYY', 'DD-MM-YYYY', 'ISO')
  - `amount` (number, optional): Number of units to add/subtract
  - `unit` (enum, optional): Time unit - 'days', 'weeks', 'months', 'years'
  - `date2` (string, optional): Second date for difference calculation
- **Features**:
  - Natural language date parsing (e.g., 'last 30 days', 'this month', 'Q1 2025')
  - Supports relative time expressions (today, yesterday, tomorrow, this week, last month, etc.)
  - Quarter and year range calculations
  - Date validation and formatting
  - Date arithmetic operations

---

## 2. Business Tools (13 tools)

### 2.1 `searchProductList`
- **Purpose**: Search for products by name, SKU, or description
- **Parameters**:
  - `search` (string): Search query
  - `mode` (enum): 'lite' or 'full' (default: 'lite')
  - `fulfilment_origin_id` (number, default: 6)
  - `page` (number, optional): Page number for pagination
  - `take` (number, optional): Number of items per page
- **Returns**: Table-formatted product list with name, SKU, category, price, and status

### 2.2 `getProductDetails`
- **Purpose**: Get detailed product information using product ID
- **Parameters**:
  - `product_id` (number): Product ID number
  - `token_check` (boolean, default: false): Whether to perform token check
- **Returns**: Complete product details including specifications and customer-specific data

### 2.3 `searchEstimateList`
- **Purpose**: Get list of estimates with optional filtering
- **Parameters**:
  - `from_date` (string, optional): Start date filter (YYYY-MM-DD)
  - `to_date` (string, optional): End date filter (YYYY-MM-DD)
  - `search` (string, optional): Search term for estimate number, customer name, etc.
  - `status` (string, optional): Filter by status ('open', 'closed', 'accepted', 'rejected', etc.)
  - `take` (number, default: 25): Number of estimates to return
  - `skip` (number, optional): Number of estimates to skip for pagination
- **Returns**: Table-formatted estimate list with estimate number, customer, date, amount, status, job, and location

### 2.4 `searchInvoiceList`
- **Purpose**: Get list of invoices with optional filtering
- **Parameters**:
  - `from_date` (string, optional): Start date filter (YYYY-MM-DD)
  - `to_date` (string, optional): End date filter (YYYY-MM-DD)
  - `search` (string, optional): Search term for invoice number, customer name, etc.
  - `status` (string, optional): Filter by status ('open', 'paid', 'overdue', 'cancelled', etc.)
  - `take` (number, default: 25): Number of invoices to return
  - `skip` (number, optional): Number of invoices to skip for pagination
  - `get_all` (boolean, default: false): Set to true to fetch all records in a single request
- **Returns**: Table-formatted invoice list with invoice number, customer, date, amount, status, email, and phone

### 2.5 `searchCustomerList`
- **Purpose**: Get list of customers with optional search filtering
- **Parameters**:
  - `search` (string, optional): Search term for customer name, email, phone, or company
  - `take` (number, default: 25): Number of customers to return
  - `skip` (number, optional): Number of customers to skip for pagination
- **Returns**: Customer list with normalized data structure

### 2.6 `findCustomerByName`
- **Purpose**: Find a specific customer by exact name match
- **Parameters**:
  - `customer_name` (string): Exact customer name to search for
- **Returns**: Customer details if exact match found, or list of partial matches

### 2.7 `searchCustomerAddress`
- **Purpose**: Get customer address information by customer ID
- **Parameters**:
  - `customer_id` (string): Customer ID to get address information for
  - `address_company_id` (string, optional): Address company ID filter
  - `address_id` (string, optional): Specific address ID (remove to get primary/register address)
- **Returns**: Formatted address information

### 2.8 `getEstimateByCustomNumber`
- **Purpose**: Get detailed estimate information using customer-facing estimate number
- **Parameters**:
  - `custom_estimate_number` (string): Customer-facing estimate/quotation number (e.g., '25-3454')
- **Returns**: Complete estimate details including:
  - Estimate details (number, status, dates, amounts)
  - Products list with details
  - Customer information
  - Document links (PDF)

### 2.9 `getInvoiceByCustomNumber`
- **Purpose**: Get detailed invoice information using customer-facing invoice number
- **Parameters**:
  - `custom_invoice_number` (string): Customer-facing invoice number
- **Returns**: Complete invoice details including:
  - Invoice details (number, status, dates, amounts)
  - Products list with details
  - Customer information
  - Document links (PDF)

### 2.10 `getWarehouseList`
- **Purpose**: Get list of warehouses with optional filtering
- **Parameters**:
  - `is_warehouse_managed` (boolean, optional): Filter for warehouse-managed warehouses
  - `is_serial_number_managed` (boolean, optional): Filter for serial number-managed warehouses
  - `with_address` (number, optional): Filter warehouses by address ID
- **Returns**: Warehouse list with ID, name, code, management flags, and address

### 2.11 `getStockList`
- **Purpose**: Get list of stock items from a specific warehouse
- **Parameters**:
  - `warehouse_id` (number): ID of the warehouse
  - `search` (string, optional): Search term for product name, SKU, or description
  - `from_date` (string, optional): Start date filter (YYYY-MM-DD)
  - `to_date` (string, optional): End date filter (YYYY-MM-DD)
  - `page` (number, optional): Page number for pagination
  - `take` (number, optional): Number of items per page
  - `only_available` (boolean, optional): Filter to show only available stock
  - `timezone` (string, optional): Timezone for date filtering
  - `filter` (object, optional): Advanced filtering options (brand, category, vendor, dates, etc.)
- **Returns**: Stock items with quantities, prices, categories, and dates

### 2.12 `getDeliveryBoard`
- **Purpose**: Show all scheduled deliveries for a company or user
- **Parameters**:
  - `from_date` (string, optional): Start date filter (defaults to current week start)
  - `to_date` (string, optional): End date filter (defaults to current week end)
  - `board_id` (string, default: "0"): Board ID
- **Returns**: Delivery events with customer info, job details, delivery dates, and package lists

### 2.13 `getTaskList`
- **Purpose**: Get a list of tasks with optional filtering and pagination
- **Parameters**:
  - `object_name` (string, optional): Object name for filtering
  - `object_id` (string, optional): Object ID for filtering
  - `filter` (string, optional): Filter criteria
  - `employee_name` (string, optional): Employee name to filter tasks
  - `page` (number, default: 1): Page number for pagination
  - `take` (number, default: 20): Number of records per page
  - `search` (string, optional): Search term to filter tasks
  - `show_all` (boolean, optional): Whether to show all results
- **Returns**: Task list with details including associates (linked objects), status, priority, and assignee

### 2.14 `getNextPageTasks`
- **Purpose**: Get the next page of task list results
- **Parameters**:
  - `object_name` (string, optional): Object name for filtering
  - `object_id` (string, optional): Object ID for filtering
  - `filter` (string, optional): Filter criteria
  - `employee_name` (string, optional): Employee name to filter tasks
  - `current_page` (number): Current page number
  - `take` (number, default: 20): Number of records per page
  - `search` (string, optional): Search term to filter tasks
- **Returns**: Next page of task list results

### 2.15 `getTaskDetails`
- **Purpose**: Get detailed information about a specific task
- **Parameters**:
  - `task_id` (number): Task ID number
  - `custom_number` (string, optional): Task custom number (alternative to task_id)
- **Returns**: Comprehensive task information including description, assignee, dates, status, priority, and associated objects

---

## 3. Analytics Tools (1 tool)

### 3.1 `analyzeBusinessData`
- **Purpose**: Analyze business data and return chart-ready JSON for infographics
- **Parameters**:
  - `analysis_type` (enum): Type of analysis
    - `total_sale_for_customer`: Customer-specific analysis
    - `company_sales_analytics`: Company-wide analysis
    - `employee_sales_analytics`: Employee-based analysis
    - `employee_comparison_analytics`: Compare multiple employees
  - `customer_name` (string, optional): Required for `total_sale_for_customer`
  - `employee_name` (string, optional): Required for `employee_sales_analytics`
  - `employee_names` (array of strings, optional): Required for `employee_comparison_analytics`
  - `from_date` (string, optional): Start date filter (YYYY-MM-DD format only)
  - `to_date` (string, optional): End date filter (YYYY-MM-DD format only)
- **Important**: This tool only accepts exact dates in YYYY-MM-DD format. For natural language dates, use the `date-utility` tool first.
- **Returns**: 
  - Structured analytics data with metrics
  - Chart-ready JSON for visualization (doughnut, pie, bar charts)
  - Summary statistics
  - Status breakdowns
  - Conversion rates
  - Monthly trends (for company-wide analysis)

---

## Shared Infrastructure

### API Utilities (`SHARED_UTILITIES.api`)
The tools use shared API utilities organized by domain:

- **Customers**: `getList()`, `getDetails()`, `search()`
- **Estimates**: `getList()`, `getDetails()`, `search()`
- **Invoices**: `getList()`, `getDetails()`, `search()`
- **Tasks**: `getList()`, `getDetails()`, `getDetailsByCustomNumber()`
- **Analytics**: `getSalesData()`, `getCustomerData()`
- **Utils**: `getCompanyInfo()`, `getUserInfo()`, `getSystemStatus()`

### Date Utilities (`SHARED_UTILITIES.date`)
Shared date manipulation functions:
- `addDays()`, `addMonths()`
- `getWeekStart()`, `getWeekEnd()`
- `getCurrentQuarter()`, `getQuarterRange()`
- `getLastQuarterRange()`, `getNextQuarterRange()`
- `extractNumber()`, `formatDate()`
- `parseNaturalLanguageDate()`

### Analytics Utilities (`ANALYTICS_UTILITIES`)
Shared analytics functions:
- `analyzeEstimateStatuses()`: Detailed estimate status breakdown
- `analyzeInvoiceStatuses()`: Detailed invoice status breakdown
- `calculateTotals()`: Calculate total amounts from items
- `generateDetailedSummary()`: Generate comprehensive summary text

### API Configuration
- **Base URL**: `https://app.invoicemakerpro.com`
- **Rate Limiting**: Configurable max requests per window
- **Retry Logic**: Exponential backoff for failed requests
- **Required Fields**: `company_id`, `user_id`, `token`, `imp_session_id`

---

## Key Features

### 1. Date Handling
- Multiple date format support (YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY)
- Natural language date parsing
- Date validation and conversion
- Relative date calculations

### 2. Data Formatting
- Table-formatted responses for lists
- Structured JSON responses for details
- Chart-ready data for analytics
- Human-readable summaries

### 3. Error Handling
- Comprehensive error messages
- Validation for required parameters
- Graceful handling of missing data
- Rate limiting protection

### 4. Pagination
- Support for large datasets
- Configurable page size
- "Get all" option for complete data retrieval
- Next page navigation

### 5. Search Capabilities
- Full-text search across multiple fields
- Exact and partial matching
- Filtering by multiple criteria
- Case-insensitive search

---

## Tool Registration

Tools are registered in three functions:
1. `registerUtilityTools()` - Utility and helper tools
2. `registerBusinessTools()` - Business domain tools
3. `registerAnalyticsTools()` - Analytics and reporting tools

All tools are registered via `registerAllTools()` which calls all three registration functions.

---

## Usage Patterns

### Common Workflows

1. **Product Search → Details**
   - Use `searchProductList` to find products
   - Use `getProductDetails` with product ID for full details

2. **Customer Analysis**
   - Use `searchCustomerList` or `findCustomerByName` to find customer
   - Use `analyzeBusinessData` with `total_sale_for_customer` for analytics
   - Use `searchCustomerAddress` for address information

3. **Invoice/Estimate Lookup**
   - Use `searchInvoiceList` or `searchEstimateList` for lists
   - Use `getInvoiceByCustomNumber` or `getEstimateByCustomNumber` for details

4. **Date-Based Analysis**
   - Use `date-utility` with `parse` operation to convert natural language dates
   - Use converted dates with `analyzeBusinessData` for analytics

5. **Task Management**
   - Use `getTaskList` to view tasks
   - Use `getTaskDetails` for specific task information
   - Use `getNextPageTasks` for pagination

---

## Best Practices

1. **Date Handling**: Always use `date-utility` tool first for natural language dates before passing to analytics tools
2. **Pagination**: Use pagination for large datasets to avoid response size limits
3. **Search**: Start with broad searches, then narrow down with specific filters
4. **Error Messages**: Read error messages carefully - they often provide guidance on correct parameter formats
5. **Rate Limiting**: Be aware of rate limits when making multiple API calls

---

## Notes

- All tools return data in a consistent format with `content` array containing text responses
- Table-formatted responses use special `<table>` tags for UI rendering
- Chart data is provided in Chart.js-compatible format
- All dates should be in YYYY-MM-DD format for analytics tools
- Natural language date parsing is available through the `date-utility` tool
