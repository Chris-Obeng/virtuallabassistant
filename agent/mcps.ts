import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "math-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// server.setRequestHandler(ListToolsRequestSchema, async () => {});

// server.setRequestHandler(CallToolRequestSchema, async (request) => {});

const transport = new StdioServerTransport();
server.connect(transport);

const client = new MultiServerMCPClient({
  math: {
    transport: "stdio",
    command: "node",
    args: ["./mathServer.js"],
  },
});

const tool = client.getTools();
