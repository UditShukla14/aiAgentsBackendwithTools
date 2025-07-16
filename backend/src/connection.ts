import path from 'path';
import { fileURLToPath } from 'url';

// Accepts MCPBackendService instance and MCP_SERVER_PATH as arguments
export async function initializeAutoConnect(mcpServiceInstance: any, MCP_SERVER_PATH: string) {
  try {
    const serverPath = MCP_SERVER_PATH;
    console.log('🔄 Attempting auto-connection to MCP server at:', serverPath);
    // Check if file exists before attempting connection
    try {
      await import(serverPath);
    } catch (error) {
      throw new Error(`MCP server file not found at ${serverPath}. Please ensure the file exists and the path is correct.`);
    }
    await connectToServer(mcpServiceInstance, serverPath);
    console.log('✅ Successfully auto-connected to MCP server');
    mcpServiceInstance.autoConnectRetries = 0;
  } catch (error) {
    mcpServiceInstance.autoConnectRetries++;
    console.error(`❌ Auto-connection attempt ${mcpServiceInstance.autoConnectRetries} failed:`, error);
    if (mcpServiceInstance.autoConnectRetries < mcpServiceInstance.maxAutoConnectRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, mcpServiceInstance.autoConnectRetries), 10000);
      console.log(`🔄 Retrying auto-connection in ${backoffMs / 1000} seconds...`);
      setTimeout(() => initializeAutoConnect(mcpServiceInstance, MCP_SERVER_PATH), backoffMs);
    } else {
      console.error('❌ Max auto-connection retries exceeded. Manual connection will be required.');
    }
  }
}

// Accepts MCPBackendService instance and serverScriptPath as arguments
export async function connectToServer(mcpServiceInstance: any, serverScriptPath: string) {
  try {
    const isJs = serverScriptPath.endsWith('.js');
    const isPy = serverScriptPath.endsWith('.py');
    const isTs = serverScriptPath.endsWith('.ts');
    if (!isJs && !isPy && !isTs) {
      throw new Error('Server script must be a .js, .ts, or .py file');
    }
    let command: string;
    let args: string[];
    if (isPy) {
      command = process.platform === 'win32' ? 'python' : 'python3';
      args = [serverScriptPath];
    } else if (isTs) {
      command = 'npx';
      args = ['tsx', serverScriptPath];
    } else {
      command = process.execPath;
      args = [serverScriptPath];
    }
    mcpServiceInstance.transport = new mcpServiceInstance.StdioClientTransport({
      command,
      args,
    });
    await mcpServiceInstance.mcp.connect(mcpServiceInstance.transport);
    const toolsResult = await mcpServiceInstance.mcp.listTools();
    mcpServiceInstance.tools = toolsResult.tools.map((tool: any) => {
      return {
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.inputSchema,
      };
    });
    mcpServiceInstance.isConnected = true;
    console.log(
      'Connected to MCP server with tools:',
      mcpServiceInstance.tools.map(({ name }: any) => name).join(', ')
    );
    return {
      success: true,
      tools: mcpServiceInstance.tools.map(({ name, description }: any) => ({ name, description })),
    };
  } catch (e) {
    console.error('Failed to connect to MCP server:', e);
    throw e;
  }
} 