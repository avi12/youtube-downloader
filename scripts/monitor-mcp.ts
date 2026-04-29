import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";

const server = new Server({
  name: "flexible-monitor",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

const activeMonitors = new Map<string, ChildProcess>();

const TOOLS: Tool[] = [
  {
    name: "monitor_command",
    description: "Runs a command in the background and alerts when a pattern is matched in stdout/stderr.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run."
        },
        pattern: {
          type: "string",
          description: "Regex pattern to watch for."
        },
        label: {
          type: "string",
          description: "A unique name for this monitor."
        }
      },
      required: ["command", "pattern", "label"]
    }
  },
  {
    name: "list_monitors",
    description: "Lists all active background monitors.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "stop_monitor",
    description: "Stops a background monitor by its label.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string" }
      },
      required: ["label"]
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args = {} } = request.params;
  if (name === "monitor_command") {
    if (typeof args.command !== "string" || typeof args.pattern !== "string" || typeof args.label !== "string") {
      throw new Error("Invalid args for monitor_command");
    }

    const { command, pattern, label } = args;
    const regex = new RegExp(pattern);

    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeMonitors.set(label, child);

    child.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (regex.test(output)) {
        process.stderr.write(`\n[MONITOR: ${label}] Pattern matched: ${pattern}\nOutput: ${output}\n`);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (regex.test(output)) {
        process.stderr.write(`\n[MONITOR: ${label}] Pattern matched in stderr: ${pattern}\nOutput: ${output}\n`);
      }
    });

    child.on("exit", code => {
      process.stderr.write(`\n[MONITOR: ${label}] Process exited with code ${code}\n`);
      activeMonitors.delete(label);
    });

    return {
      content: [{
        type: "text",
        text: `Started monitoring '${label}'. Command running in background.`
      }]
    };
  }

  if (name === "list_monitors") {
    return {
      content: [{
        type: "text",
        text: `Active monitors: ${Array.from(activeMonitors.keys()).join(", ") || "None"}`
      }]
    };
  }

  if (name === "stop_monitor") {
    if (typeof args.label !== "string") {
      throw new Error("Invalid args for stop_monitor");
    }

    const { label } = args;
    const child = activeMonitors.get(label);
    if (child) {
      child.kill();
      activeMonitors.delete(label);
      return {
        content: [{
          type: "text",
          text: `Stopped monitor: ${label}`
        }]
      };
    }

    return {
      content: [{
        type: "text",
        text: `Monitor not found: ${label}`
      }]
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
