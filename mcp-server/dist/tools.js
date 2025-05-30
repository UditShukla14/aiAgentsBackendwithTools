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
async function callIMPApi(endpoint, additionalParams = {}) {
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
export function registerUtilityTools(server) {
    server.tool("calculate", "Perform basic mathematical calculations", {
        expression: z.string().describe("Mathematical expression to evaluate (e.g., '2 + 3 * 4')"),
    }, async ({ expression }) => {
        try {
            const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
            const result = Function(`"use strict"; return (${sanitized})`)();
            return { content: [{ type: "text", text: `${expression} = ${result}` }] };
        }
        catch {
            return { content: [{ type: "text", text: `Error calculating "${expression}": Invalid expression` }] };
        }
    });
    server.tool("analyze-text", "Analyze text for word count, character count, and readability", {
        text: z.string().describe("Text to analyze"),
    }, async ({ text }) => {
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
    });
}
export function registerBusinessTools(server) {
    server.tool("searchProductList", "Search for products by name, SKU, or description. Use this for general product searches or when looking for multiple products. Returns a list of matching products.", {
        search: z.string().describe("Search query for product name, SKU, or description"),
        mode: z.enum(["lite", "full"]).default("lite").describe("Response mode - lite for basic info, full for detailed info"),
        fulfilment_origin_id: z.number().default(6).describe("Fulfilment origin ID"),
        page: z.number().optional().describe("Page number for pagination"),
        take: z.number().optional().describe("Number of items per page"),
    }, async ({ search, mode, fulfilment_origin_id, page, take }) => {
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
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
    // Get Product Details Tool
    server.tool("getProductDetails", "Get detailed product information using product ID  from the company database", {
        product_id: z.number().describe("Product ID number"),
        token_check: z.boolean().default(false).describe("Whether to perform token check"),
    }, async ({ product_id, token_check = false }) => {
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
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
    // Search Estimate List Tool
    server.tool("searchEstimateList", "Get list of estimates with optional filtering by date range and search term", {
        from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
        to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
        search: z.string().optional().describe("Search term for estimate number, customer name, etc."),
        take: z.number().default(25).describe("Number of estimates to return (default: 25)"),
        skip: z.number().optional().describe("Number of estimates to skip for pagination"),
    }, async ({ from_date, to_date, search, take = 25, skip }) => {
        try {
            const data = await callIMPApi("/api/estimate/list", {
                ...(from_date && { from_date }),
                ...(to_date && { to_date }),
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
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
    // Search Invoice List Tool
    server.tool("searchInvoiceList", "Get list of invoices with optional filtering by date range and search term", {
        from_date: z.string().optional().describe("Start date filter (YYYY-MM-DD format)"),
        to_date: z.string().optional().describe("End date filter (YYYY-MM-DD format)"),
        search: z.string().optional().describe("Search term for invoice number, customer name, etc."),
        take: z.number().default(25).describe("Number of invoices to return (default: 25)"),
        skip: z.number().optional().describe("Number of invoices to skip for pagination"),
    }, async ({ from_date, to_date, search, take = 25, skip }) => {
        try {
            const data = await callIMPApi("/api/invoice_list", {
                ...(from_date && { from_date }),
                ...(to_date && { to_date }),
                ...(search && { search }),
                take,
                ...(skip && { skip })
            });
            if (!data.success) {
                return { content: [{ type: "text", text: `Error fetching invoices: ${data.message}` }] };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${data.result?.length || 0} invoices:\n\n${JSON.stringify(data.result || [], null, 2)}\n\n📋 Use filters like from_date, to_date, or search to narrow down results.`,
                    },
                ],
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
    // Search Customer List Tool
    server.tool("searchCustomerList", "Get list of customers with optional search filtering", {
        search: z.string().optional().describe("Search term for customer name, email, phone, or company"),
        take: z.number().default(25).describe("Number of customers to return (default: 25)"),
        skip: z.number().optional().describe("Number of customers to skip for pagination"),
    }, async ({ search, take = 25, skip }) => {
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
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
    // Search Customer Address Tool
    server.tool("searchCustomerAddress", "Get customer address information by customer ID with optional address company and address ID filters", {
        customer_id: z.string().describe("Customer ID to get address information for"),
        address_company_id: z.string().optional().describe("Address company ID filter"),
        address_id: z.string().optional().describe("Specific address ID (remove to get primary/register address for customer)"),
    }, async ({ customer_id, address_company_id, address_id }) => {
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
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
    // Get Estimate by Custom Number Tool
    server.tool("getEstimateByCustomNumber", "Get detailed estimate information using customer-facing estimate number (e.g., '25-3454'). This tool automatically searches for the custom number and retrieves full details.", {
        custom_estimate_number: z.string().describe("Customer-facing estimate/quotation number (e.g., '25-3454')"),
    }, async ({ custom_estimate_number }) => {
        try {
            // Step 1: Search for the estimate using the custom number
            const searchData = await callIMPApi("/api/estimate/list", {
                search: custom_estimate_number,
                take: 10 // Limit results to avoid too much data
            });
            if (!searchData.success) {
                return { content: [{ type: "text", text: `Error searching for estimate: ${searchData.message}` }] };
            }
            const estimates = searchData.result || [];
            if (estimates.length === 0) {
                return { content: [{ type: "text", text: `No estimate found with custom number "${custom_estimate_number}"` }] };
            }
            // Find the exact match for the custom number
            const matchingEstimate = estimates.find((est) => est.estimate_number === custom_estimate_number ||
                est.quotation_number === custom_estimate_number ||
                est.custom_number === custom_estimate_number ||
                est.custom_quotation_number === custom_estimate_number ||
                est.ext_po_number === custom_estimate_number ||
                String(est.estimate_number) === custom_estimate_number ||
                String(est.quotation_number) === custom_estimate_number ||
                String(est.custom_quotation_number) === custom_estimate_number ||
                String(est.ext_po_number) === custom_estimate_number);
            if (!matchingEstimate) {
                return {
                    content: [{
                            type: "text",
                            text: `Found ${estimates.length} estimates in search, but no exact match for "${custom_estimate_number}". Found estimates:\n\n${JSON.stringify(estimates, null, 2)}\n\n💡 Please check the estimate number or use one of the IDs from the search results.`
                        }]
                };
            }
            // Step 2: Get detailed information using the internal quotation_id
            const quotationId = matchingEstimate.quotation_id || matchingEstimate.estimate_id || matchingEstimate.id;
            if (!quotationId) {
                return {
                    content: [{
                            type: "text",
                            text: `Found estimate but unable to extract quotation_id. Estimate data:\n\n${JSON.stringify(matchingEstimate, null, 2)}`
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
            // Format the response in a more readable way
            let formattedResponse = `✅ **Estimate Details: ${custom_estimate_number}** (Internal ID: ${quotationId})\n\n`;
            // Basic Information
            formattedResponse += `📋 **Basic Information:**\n`;
            formattedResponse += `• Status: ${result.status_name || 'N/A'}\n`;
            formattedResponse += `• Created: ${result.created_at ? new Date(result.created_at).toLocaleDateString() : 'N/A'}\n`;
            formattedResponse += `• Job ID: ${result.job_id || 'N/A'}\n`;
            formattedResponse += `• Valid Until: ${result.valid_until || 'N/A'}\n\n`;
            // Customer Information
            formattedResponse += `👤 **Customer Information:**\n`;
            formattedResponse += `• Name: ${result.customer_name || 'N/A'}\n`;
            formattedResponse += `• Email: ${result.customer_email || 'N/A'}\n`;
            formattedResponse += `• Phone: ${result.customer_phone || 'N/A'}\n`;
            if (result.customer_house_no || result.customer_city || result.customer_state) {
                formattedResponse += `• Address: ${[
                    result.customer_house_no,
                    result.customer_landmark,
                    result.customer_city,
                    result.customer_state,
                    result.customer_zip,
                    result.customer_country
                ].filter(Boolean).join(', ')}\n`;
            }
            formattedResponse += `\n`;
            // Company Information
            formattedResponse += `🏢 **Company Information:**\n`;
            formattedResponse += `• Name: ${result.company_name || 'N/A'}\n`;
            formattedResponse += `• Email: ${result.company_email || 'N/A'}\n`;
            formattedResponse += `• Phone: ${result.company_phone || 'N/A'}\n\n`;
            // Products/Services
            if (result.quotation_products && result.quotation_products.length > 0) {
                formattedResponse += `🛍️ **Products/Services (${result.quotation_products.length} items):**\n`;
                result.quotation_products.forEach((product, index) => {
                    formattedResponse += `\n**${index + 1}. ${product.product_title}**\n`;
                    formattedResponse += `   • Description: ${product.product_desc || 'N/A'}\n`;
                    formattedResponse += `   • Quantity: ${product.product_qty || 'N/A'}\n`;
                    formattedResponse += `   • Unit Cost: $${parseFloat(product.product_cost || 0).toFixed(2)}\n`;
                    if (product.company_service_details?.product_price) {
                        formattedResponse += `   • Unit Price: $${parseFloat(product.company_service_details.product_price).toFixed(2)}\n`;
                    }
                    formattedResponse += `   • Tax Rate: ${product.product_tax_rate || 0}%\n`;
                    formattedResponse += `   • Tax Amount: $${parseFloat(product.product_tax_amount || 0).toFixed(2)}\n`;
                    if (product.ware_house_name) {
                        formattedResponse += `   • Warehouse: ${product.ware_house_name}\n`;
                    }
                    if (product.item_section_name) {
                        formattedResponse += `   • Section: ${product.item_section_name}\n`;
                    }
                });
                formattedResponse += `\n`;
            }
            // Financial Summary
            formattedResponse += `💰 **Financial Summary:**\n`;
            formattedResponse += `• Subtotal: $${parseFloat(result.quotation_total || 0).toFixed(2)}\n`;
            formattedResponse += `• Tax: $${parseFloat(result.quotation_tax || 0).toFixed(2)}\n`;
            if (result.quotation_discount && result.quotation_discount > 0) {
                formattedResponse += `• Discount: $${parseFloat(result.quotation_discount).toFixed(2)}\n`;
            }
            const grandTotal = (parseFloat(result.quotation_total || 0) + parseFloat(result.quotation_tax || 0) - parseFloat(result.quotation_discount || 0));
            formattedResponse += `• **Grand Total: $${grandTotal.toFixed(2)}**\n\n`;
            // Tax Information
            if (result.tax_module) {
                formattedResponse += `📊 **Tax Information:**\n`;
                formattedResponse += `• ${result.tax_module.message || 'N/A'}\n`;
                if (result.tax_module.agency_name) {
                    formattedResponse += `• Tax Agency: ${result.tax_module.agency_name}\n`;
                }
                formattedResponse += `\n`;
            }
            // Additional Information
            if (result.internal_notes || result.job_name || result.job_location) {
                formattedResponse += `📝 **Additional Information:**\n`;
                if (result.job_name)
                    formattedResponse += `• Job Name: ${result.job_name}\n`;
                if (result.job_location)
                    formattedResponse += `• Job Location: ${result.job_location}\n`;
                if (result.internal_notes)
                    formattedResponse += `• Internal Notes: ${result.internal_notes}\n`;
                formattedResponse += `\n`;
            }
            // PDF Link
            if (result.quotation_pdf) {
                formattedResponse += `📄 **Document:** [View PDF](${result.quotation_pdf})\n\n`;
            }
            formattedResponse += `---\n💡 **Tip:** This estimate contains detailed product specifications and pricing information. Use the PDF link to view the formatted document.`;
            return {
                content: [
                    {
                        type: "text",
                        text: formattedResponse,
                    },
                ],
            };
        }
        catch (error) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }] };
        }
    });
}
export function registerAllTools(server) {
    console.log("Registering utility tools...");
    registerUtilityTools(server);
    console.log("Registering business tools...");
    registerBusinessTools(server);
    console.log("All tools registered!");
}
