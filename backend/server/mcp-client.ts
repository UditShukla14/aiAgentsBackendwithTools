// mcp-client.ts - Core MCP client functionality
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface MCPClientConfig {
  [x: string]: unknown;
  name: string;
  version: string;
}

export class MCPClientManager {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;
  private availableTools: MCPTool[] = [];

  constructor(config: MCPClientConfig = { name: "mcp-client", version: "1.0.0" }) {
    this.client = new Client(config);
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
      
      this.availableTools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema,
      }));

      this.isConnected = true;

      console.log(`Successfully connected to MCP server: ${serverScriptPath}`);
      console.log(`Available tools: ${this.availableTools.map(t => t.name).join(", ")}`);

      return {
        success: true,
        tools: this.availableTools
      };

    } catch (error) {
      console.error("Failed to connect to MCP server:", error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Call a tool on the connected MCP server
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
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
        console.log("Disconnected from MCP server");
      }
    } catch (error) {
      console.error("Error during disconnect:", error);
      throw error;
    }
  }

  /**
   * List all resources (if server supports resources)
   */
  async listResources() {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    try {
      return await this.client.listResources();
    } catch (error) {
      console.error("Error listing resources:", error);
      throw error;
    }
  }

  /**
   * List all prompts (if server supports prompts)
   */
  async listPrompts() {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    try {
      return await this.client.listPrompts();
    } catch (error) {
      console.error("Error listing prompts:", error);
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