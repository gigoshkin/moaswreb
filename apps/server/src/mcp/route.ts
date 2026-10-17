import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { requireKey } from '../auth.ts';
import type { ToolDef } from '../tools/index.ts';

const buildServer = (tools: ToolDef[]): McpServer => {
  const server = new McpServer({ name: 'tbilisi-transit', version: '0.1.0' });
  for (const t of tools.filter((t) => t.mcp)) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.schema, annotations: { readOnlyHint: true } },
      async (input: unknown) => {
        try {
          const result = await t.run(input as never);
          return {
            content: [{ type: 'text', text: result.text }],
            ...(result.card ? { structuredContent: { card: result.card } } : {}),
          };
        } catch (err) {
          return { isError: true, content: [{ type: 'text', text: `Failed: ${(err as Error).message}` }] };
        }
      },
    );
  }
  return server;
};

/**
 * MCP over Streamable HTTP at /mcp, stateless: a fresh server and transport per
 * request. The same read-only tools as the in-app chat, so Claude Desktop and
 * the app give the same answers (request 0001).
 */
export const registerMcpRoute = (app: FastifyInstance, tools: ToolDef[]): void => {
  app.post('/mcp', { preHandler: requireKey }, async (req, reply) => {
    const server = buildServer(tools);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless server: no SSE stream to resume and no session to delete.
  const notAllowed = { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null };
  app.get('/mcp', async (_req, reply) => reply.code(405).send(notAllowed));
  app.delete('/mcp', async (_req, reply) => reply.code(405).send(notAllowed));
};
