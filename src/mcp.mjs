// @ts-check
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getComponentBugs } from "./bugzilla.mjs";
import { getComponentConfigs, getBugzillaAuth } from "./store.mjs";
import {
  resolveComponentQuery,
  normalizePFilter,
  normalizeSFilter,
  resolveSortField,
  VALID_PRIORITIES,
  VALID_SEVERITIES,
} from "./query.mjs";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugFilters} BugFilters */
/** @typedef {import("./types.d.ts").ComponentBugsData} ComponentBugsData */

const LOG_PATH = join(homedir(), ".moz-bugs-mcp.log");

/** @type {import("node:fs").WriteStream} */
let logStream;

/** @param {string} message */
function log(message) {
  logStream.write(`[${new Date().toISOString()}] ${message}\n`);
}

/** @type {Array<{name: string, description: string, inputSchema: object, annotations: object}>} */
const TOOL_DEFINITIONS = [
  {
    name: "list_bugs",
    description:
      "List open Bugzilla bugs across saved components, with optional filters. " +
      "Returns structured bug objects with id, summary, status, priority, severity, " +
      "assigned_to, type, creation_time, last_change_time, bug_url, and groups.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        component: {
          type: "string",
          description:
            "Fuzzy-match a saved component, or use 'Product :: Component' for exact lookup. " +
            "Omit to include all saved components.",
        },
        assigned: {
          type: "string",
          description: "Filter to bugs whose assignee fuzzy-matches this string.",
        },
        priority: {
          type: "string",
          enum: ["P1", "P2", "P3", "P4", "P5"],
          description: "Filter by priority. Accepts P1–P5 (case-insensitive, e.g. 'p1', '2').",
        },
        severity: {
          type: "string",
          enum: ["S1", "S2", "S3", "S4"],
          description: "Filter by severity. Accepts S1–S4 (case-insensitive, e.g. 's1', '2').",
        },
        sort: {
          type: "string",
          description:
            "Comma-separated sort fields, fuzzy-matched. " +
            "Valid values: id, creation_time, last_change_time, priority, severity, assigned_to, summary.",
        },
        active: {
          type: "boolean",
          description:
            "When true, return bugs split into 'active' (assigned + touched within 30 days) " +
            "and 'stale' (assigned + no activity 30+ days) sections instead of a flat list.",
        },
      },
    },
  },
  {
    name: "list_components",
    description: "List all saved Bugzilla component configurations (product, component, url).",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: "object", properties: {} },
  },
];

/**
 * @param {Bug} bug
 * @param {string} url
 * @returns {object}
 */
function bugToJson(bug, url) {
  return {
    id: bug.id,
    summary: bug.summary,
    status: bug.status,
    assigned_to: bug.assigned_to,
    priority: bug.priority,
    severity: bug.severity,
    type: bug.type,
    creation_time: bug.creation_time,
    last_change_time: bug.last_change_time,
    groups: bug.groups ?? [],
    bug_url: `${url}/show_bug.cgi?id=${bug.id}`,
  };
}

/**
 * @param {Record<string, unknown>} args
 * @returns {Promise<{content: Array<{type: "text", text: string}>, isError?: boolean}>}
 */
async function handleListBugs(args) {
  /** @type {BugFilters} */
  const filters = {};

  if (typeof args.component === "string") filters.component = args.component;
  if (typeof args.assigned  === "string") filters.assigned  = args.assigned;
  if (typeof args.active    === "boolean") filters.active   = args.active;

  if (typeof args.priority === "string") {
    const p = normalizePFilter(args.priority);
    if (!VALID_PRIORITIES.has(p)) {
      return { content: [{ type: "text", text: `Invalid priority: ${args.priority}` }], isError: true };
    }
    filters.priority = p;
  }

  if (typeof args.severity === "string") {
    const s = normalizeSFilter(args.severity);
    if (!VALID_SEVERITIES.has(s)) {
      return { content: [{ type: "text", text: `Invalid severity: ${args.severity}` }], isError: true };
    }
    filters.severity = s;
  }

  if (typeof args.sort === "string") {
    filters.sort = args.sort.split(",").map(resolveSortField);
  }

  const allComponents = getComponentConfigs();
  const targets = filters.component
    ? resolveComponentQuery(filters.component, allComponents)
    : allComponents;

  if (targets.length === 0) {
    return { content: [{ type: "text", text: "No matching components found. Use list_components to see saved components." }] };
  }

  /** @type {ComponentBugsData[]} */
  const results = [];
  for (const config of targets) {
    const auth = getBugzillaAuth(config.url);
    const data = await getComponentBugs(
      config.product,
      config.component,
      config.url,
      auth?.apiKey,
      filters,
    );
    results.push(data);
  }

  const payload = results.map((d) => {
    /** @type {Record<string, unknown>} */
    const entry = {
      product: d.product,
      component: d.component,
      url: d.url,
      totalFetched: d.totalFetched,
    };
    if (d.active !== undefined) {
      entry.active = d.active.map((b) => bugToJson(b, d.url));
      entry.stale = (d.stale ?? []).map((b) => bugToJson(b, d.url));
    } else {
      entry.bugs = d.bugs.map((b) => bugToJson(b, d.url));
    }
    return entry;
  });

  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/**
 * @returns {{content: Array<{type: "text", text: string}>}}
 */
function handleListComponents() {
  const components = getComponentConfigs();
  return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
}

function printSetupInstructions() {
  process.stderr.write(`
moz-bugs MCP server starting...
Log: ${LOG_PATH}  (tail -f to monitor)

To add to Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):

  {
    "mcpServers": {
      "moz-bugs": {
        "command": "moz-bugs",
        "args": ["mcp"]
      }
    }
  }

To add to Claude Code:
  claude mcp add moz-bugs -- moz-bugs mcp

Tools available:
  list_bugs         List open bugs (supports component, assigned, priority, severity, sort, active)
  list_components   List saved component configs

`.trimStart());
}

export async function runMcpServer() {
  logStream = createWriteStream(LOG_PATH, { flags: "w" });

  printSetupInstructions();

  const server = new Server(
    { name: "moz-bugs", version: "2.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    log("tools/list");
    return { tools: TOOL_DEFINITIONS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    log(`tools/call ${name} ${JSON.stringify(args)}`);
    try {
      switch (name) {
        case "list_bugs":       return await handleListBugs(args);
        case "list_components": return handleListComponents();
        default:
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`error in ${name}: ${msg}`);
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  });

  process.on("SIGINT", async () => {
    log("shutting down");
    await server.close();
    logStream.end();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("connected");
}
