import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { wrapMcpTool } from './wrapper.js';

export async function connectMcpServer(serverConfig) {
  const { name, command, args = [], env = {} } = serverConfig;

  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...process.env,
      ...env,
    },
    stderr: 'pipe',
  });

  // Suppress all server stdout/stderr noise from appearing in terminal
  transport.stderr?.on('data', () => {});

  const client = new Client(
    { name: 'orbit-alpha', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);

  const { tools: mcpTools } = await client.listTools();

  const callFn = async (toolName, toolArgs) => {
    const result = await client.callTool({
      name: toolName,
      arguments: toolArgs,
    });

    if (Array.isArray(result.content)) {
      return result.content
        .map(block => {
          if (block.type === 'text') return block.text;
          if (block.type === 'resource') return JSON.stringify(block.resource);
          return JSON.stringify(block);
        })
        .join('\n');
    }

    return JSON.stringify(result);
  };

  const wrappedTools = mcpTools.map(tool =>
    wrapMcpTool(name, tool, callFn)
  );

  return wrappedTools;
}