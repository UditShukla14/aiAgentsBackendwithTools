// mcp-client.ts - Core MCP client functionality
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { 
  CallToolResult, 
  ListToolsResult,
  ListResourcesResult,
  ListPromptsResult,
  Tool,
  Resource,
  Prompt
} from "@modelcontextprotocol/sdk/types.js";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPClientConfig {
  [x: string]: unknown;
  name: string;
  version: string;
  capabilities?: {
    tools?: {};
    resources?: {};
    prompts?: {};
    sampling?: {};
    elicitation?: {};
  };
}

export class MCPClientManager {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;
  private availableTools: MCPTool[] = [];
  private connectionListeners: Set<(connected: boolean) => void> = new Set();

  constructor(config: MCPClientConfig = { 
    name: "mcp-client", 
    version: "1.0.0",
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      // Enable elicitation support for interactive workflows
      elicitation: {}
    }
  }) {
    this.client = new Client(config);
    
    // Set up error handling
    this.client.onerror = (error) => {
      console.error("MCP Client error:", error);
      this.handleConnectionLoss();
    };
  }

  /**
   * Add a listener for connection state changes
   */
  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    // Return unsubscribe function
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of connection state change
   */
  private notifyConnectionChange(connected: boolean): void {
    this.connectionListeners.forEach(listener => {
      try {
        listener(connected);
      } catch (error) {
        console.error("Error in connection listener:", error);
      }
    });
  }

  /**
   * Handle connection loss
   */
  private handleConnectionLoss(): void {
    if (this.isConnected) {
      this.isConnected = false;
      this.notifyConnectionChange(false);
    }
  }

  /**
   * Connect to an MCP server
   */
  async connect(serverScriptPath: string): Promise<{ success: boolean; tools: MCPTool[] }> {
    try {
      // Determine if it's a Python, Node.js, or TypeScript script
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      const isTs = serverScriptPath.endsWith(".ts");
      
      if (!isJs && !isPy && !isTs) {
        throw new Error("Server script must be a .js, .ts, or .py file");
      }

      // Set up the appropriate command
      let command: string;
      let args: string[];
      
      if (isPy) {
        command = globalThis.process.platform === "win32" ? "python" : "python3";
        args = [serverScriptPath];
      } else if (isTs) {
        command = "npx";
        args = ["tsx", serverScriptPath];
      } else {
        command = globalThis.process.execPath; // Use current Node.js executable for .js files
        args = [serverScriptPath];
      }

      // Create stdio transport
      this.transport = new StdioClientTransport({
        command,
        args,
      });

      // Connect to the server
      await this.client.connect(this.transport);

      // List available tools
      const toolsResult: ListToolsResult = await this.client.listTools();
      
      this.availableTools = toolsResult.tools.map((tool: Tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));

      this.isConnected = true;
      this.notifyConnectionChange(true);

      console.log(`Successfully connected to MCP server: ${serverScriptPath}`);
      console.log(`Available tools: ${this.availableTools.map(t => t.name).join(", ")}`);

      return {
        success: true,
        tools: this.availableTools
      };

    } catch (error) {
      console.error("Failed to connect to MCP server:", error);
      this.isConnected = false;
      this.notifyConnectionChange(false);
      
      // Re-throw with more context
      if (error instanceof Error) {
        throw new Error(`MCP connection failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Call a tool on the connected MCP server
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult | any> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    // Validate tool exists
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found. Available tools: ${this.availableTools.map(t => t.name).join(", ")}`);
    }

    try {
      console.log(`Calling tool: ${name} with args:`, JSON.stringify(args, null, 2));
      
      const result = await this.client.callTool({
        name,
        arguments: args,
      });

      console.log(`Tool ${name} result:`, JSON.stringify(result, null, 2));
      return result;

    } catch (error) {
      console.error(`Error calling tool ${name}:`, error);
      
      // Check if connection was lost
      if (error instanceof Error && error.message.includes("not connected")) {
        this.handleConnectionLoss();
      }
      
      throw error;
    }
  }

  /**
   * Get the list of available tools
   */
  getAvailableTools(): MCPTool[] {
    return this.availableTools;
  }

  /**
   * Check if client is connected
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get tool by name
   */
  getTool(name: string): MCPTool | undefined {
    return this.availableTools.find(tool => tool.name === name);
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    try {
      if (this.transport && this.isConnected) {
        await this.client.close();
        this.isConnected = false;
        this.availableTools = [];
        this.notifyConnectionChange(false);
        console.log("Disconnected from MCP server");
      }
    } catch (error) {
      console.error("Error during disconnect:", error);
      // Still mark as disconnected even if close fails
      this.isConnected = false;
      this.notifyConnectionChange(false);
      throw error;
    }
  }

  /**
   * List all resources (if server supports resources)
   */
  async listResources(): Promise<ListResourcesResult> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const result = await this.client.listResources();
      return result;
    } catch (error) {
      console.error("Error listing resources:", error);
      if (error instanceof Error && error.message.includes("not connected")) {
        this.handleConnectionLoss();
      }
      throw error;
    }
  }

  /**
   * List all prompts (if server supports prompts)
   */
  async listPrompts(): Promise<ListPromptsResult> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const result = await this.client.listPrompts();
      return result;
    } catch (error) {
      console.error("Error listing prompts:", error);
      if (error instanceof Error && error.message.includes("not connected")) {
        this.handleConnectionLoss();
      }
      throw error;
    }
  }

  /**
   * Read a resource by URI
   */
  async readResource(uri: string): Promise<any> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const result = await this.client.readResource({ uri });
      return result;
    } catch (error) {
      console.error(`Error reading resource ${uri}:`, error);
      if (error instanceof Error && error.message.includes("not connected")) {
        this.handleConnectionLoss();
      }
      throw error;
    }
  }

  /**
   * Get a prompt by name with optional arguments
   */
  async getPrompt(name: string, promptArguments?: Record<string, string>): Promise<any> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const result = await this.client.getPrompt({ name, arguments: promptArguments });
      return result;
    } catch (error) {
      console.error(`Error getting prompt ${name}:`, error);
      if (error instanceof Error && error.message.includes("not connected")) {
        this.handleConnectionLoss();
      }
      throw error;
    }
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async cleanup(): Promise<void> {
    await this.disconnect();
  }
}

export default MCPClientManager;