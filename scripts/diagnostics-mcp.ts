import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const server = new Server({
  name: "ide-diagnostics",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

const TOOLS: Tool[] = [
  {
    name: "get_diagnostics",
    description: "Retrieves project-wide errors and warnings from TypeScript and ESLint, mimicking the IDE 'Problems' view.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "typescript", "lint"],
          default: "all"
        }
      }
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;
  if (name === "get_diagnostics") {
    const scope = args?.scope;
    let output = "";

    try {
      if (scope === "all" || scope === "typescript") {
        output += "\n--- TypeScript Diagnostics ---\n";
        try {
          await execAsync("npx tsc --noEmit");
          output += "No TypeScript issues found.\n";
        } catch (error) {
          const stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
          const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
          output += stdout || stderr || "Error running tsc";
        }
      }

      if (scope === "all" || scope === "lint") {
        output += "\n--- ESLint Diagnostics ---\n";
        try {
          const { stdout } = await execAsync("npx eslint src --format compact");
          output += stdout || "No linting issues found.\n";
        } catch (error) {
          const stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
          output += stdout || "Error running eslint";
        }
      }

      return {
        content: [{
          type: "text",
          text: output
        }]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: "text",
          text: `Failed to run diagnostics: ${message}`
        }],
        isError: true
      };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
