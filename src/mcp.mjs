// @ts-check
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
  needsTriage,
} from "./query.mjs";
import { Tui } from "./tui.mjs";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugFilters} BugFilters */
/** @typedef {import("./types.d.ts").ComponentBugsData} ComponentBugsData */
/** @typedef {import("./types.d.ts").PendingBugUpdate} PendingBugUpdate */

const PORT = 50044;
const HOST = "127.0.0.1";
const LOG_PATH = join(homedir(), ".moz-bugs-mcp.log");

const PRIORITY_DESCRIPTIONS =
  "P1=fix in current release cycle, " +
  "P2=fix in next 1-2 release cycles (nightly+1/+2), " +
  "P3=backlog, " +
  "P4=do not use (reserved for bots), " +
  "P5=won't fix but will accept a patch";

const SEVERITY_DESCRIPTIONS =
  "S1=Catastrophic: blocks dev/testing, >25% user impact, data loss, no workaround; " +
  "S2=Serious: major functionality impaired, no satisfactory workaround; " +
  "S3=Normal: blocks non-critical functionality or workaround exists; " +
  "S4=Small/Trivial: minor significance, cosmetic issues, low or no user impact";

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
    name: "list_triage_bugs",
    description:
      "List open bugs that need triage: bugs with no priority set (--), or defect bugs with " +
      "no severity set (--). Meta bugs (containing '[meta]' in summary) are excluded. " +
      "Returns the same structured bug objects as list_bugs.",
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
      },
    },
  },
  {
    name: "propose_bug_update",
    description:
      "Propose a field update for a bug. The update is queued in the terminal for the user to " +
      "approve or deny — it is NOT written to Bugzilla immediately. " +
      "Returns { queued: true, updateId } on success. " +
      "Use list_pending_updates to check whether the user has approved or denied proposals. " +
      `Priority levels: ${PRIORITY_DESCRIPTIONS}. ` +
      `Severity levels (defects only): ${SEVERITY_DESCRIPTIONS}.`,
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["bugId", "summary", "url", "updates"],
      properties: {
        bugId: { type: "number", description: "Bugzilla bug ID." },
        summary: { type: "string", description: "Bug summary, used for display in the approval TUI." },
        url: { type: "string", description: "Bugzilla instance URL (e.g. https://bugzilla.mozilla.org)." },
        updates: {
          type: "object",
          description: "Fields to update. At least one field is required.",
          properties: {
            priority: {
              type: "string",
              enum: ["P1", "P2", "P3", "P4", "P5"],
              description: PRIORITY_DESCRIPTIONS,
            },
            severity: {
              type: "string",
              enum: ["S1", "S2", "S3", "S4"],
              description: SEVERITY_DESCRIPTIONS,
            },
            assigned_to: {
              type: "string",
              description: "Email address of the new assignee.",
            },
          },
        },
      },
    },
  },
  {
    name: "list_pending_updates",
    description:
      "List all bug update proposals made since the MCP server started, with their current " +
      "status: 'pending' (awaiting user approval), 'approved' (written to Bugzilla), " +
      "'denied' (rejected by user), or 'failed' (approved but write failed).",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: "object", properties: {} },
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
 * @param {Record<string, unknown>} args
 * @returns {Promise<{content: Array<{type: "text", text: string}>, isError?: boolean}>}
 */
async function handleListTriageBugs(args) {
  const allComponents = getComponentConfigs();
  const targets = typeof args.component === "string"
    ? resolveComponentQuery(args.component, allComponents)
    : allComponents;

  if (targets.length === 0) {
    return { content: [{ type: "text", text: "No matching components found. Use list_components to see saved components." }] };
  }

  /** @type {ComponentBugsData[]} */
  const results = [];
  for (const config of targets) {
    const auth = getBugzillaAuth(config.url);
    const data = await getComponentBugs(config.product, config.component, config.url, auth?.apiKey);
    results.push(data);
  }

  const payload = results.map((d) => {
    const triage = d.bugs.filter(needsTriage);
    return {
      product: d.product,
      component: d.component,
      url: d.url,
      totalFetched: d.totalFetched,
      triageCount: triage.length,
      bugs: triage.map((b) => bugToJson(b, d.url)),
    };
  });

  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/**
 * @param {Record<string, unknown>} args
 * @param {Tui} tui
 * @returns {{content: Array<{type: "text", text: string}>, isError?: boolean}}
 */
function handleProposeBugUpdate(args, tui) {
  const { bugId, summary, url, updates } = args;

  if (typeof bugId !== "number" || !Number.isInteger(bugId)) {
    return { content: [{ type: "text", text: "bugId must be an integer." }], isError: true };
  }
  if (typeof summary !== "string" || !summary) {
    return { content: [{ type: "text", text: "summary is required." }], isError: true };
  }
  if (typeof url !== "string" || !url) {
    return { content: [{ type: "text", text: "url is required." }], isError: true };
  }
  if (!updates || typeof updates !== "object") {
    return { content: [{ type: "text", text: "updates object is required." }], isError: true };
  }

  const u = /** @type {Record<string, unknown>} */ (updates);

  /** @type {PendingBugUpdate["updates"]} */
  const validatedUpdates = {};

  if (u.priority !== undefined) {
    if (typeof u.priority !== "string" || !VALID_PRIORITIES.has(u.priority)) {
      return { content: [{ type: "text", text: `Invalid priority: ${u.priority}. Must be P1–P5.` }], isError: true };
    }
    validatedUpdates.priority = u.priority;
  }

  if (u.severity !== undefined) {
    if (typeof u.severity !== "string" || !VALID_SEVERITIES.has(u.severity)) {
      return { content: [{ type: "text", text: `Invalid severity: ${u.severity}. Must be S1–S4.` }], isError: true };
    }
    validatedUpdates.severity = u.severity;
  }

  if (u.assigned_to !== undefined) {
    if (typeof u.assigned_to !== "string" || !u.assigned_to.includes("@")) {
      return { content: [{ type: "text", text: `Invalid assigned_to: must be an email address.` }], isError: true };
    }
    validatedUpdates.assigned_to = u.assigned_to;
  }

  if (Object.keys(validatedUpdates).length === 0) {
    return { content: [{ type: "text", text: "updates must contain at least one of: priority, severity, assigned_to." }], isError: true };
  }

  const updateId = randomUUID();

  /** @type {PendingBugUpdate} */
  const update = {
    id: updateId,
    bugId,
    summary,
    url,
    updates: validatedUpdates,
    status: "pending",
    proposedAt: new Date().toISOString(),
    resolvedAt: null,
  };

  tui.enqueue(update);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        queued: true,
        updateId,
        message: "Update queued for user approval in the terminal. Use list_pending_updates to check status.",
      }),
    }],
  };
}

/**
 * @param {Tui} tui
 * @returns {{content: Array<{type: "text", text: string}>}}
 */
function handleListPendingUpdates(tui) {
  const updates = tui.getUpdates().map((u) => ({
    updateId: u.id,
    bugId: u.bugId,
    summary: u.summary,
    url: u.url,
    updates: u.updates,
    status: u.status,
    proposedAt: u.proposedAt,
    resolvedAt: u.resolvedAt,
  }));
  return { content: [{ type: "text", text: JSON.stringify(updates, null, 2) }] };
}

/**
 * @returns {{content: Array<{type: "text", text: string}>}}
 */
function handleListComponents() {
  const components = getComponentConfigs();
  return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
}

export async function runMcpServer() {
  const tui = new Tui({ getAuth: getBugzillaAuth });
  const logStream = createWriteStream(LOG_PATH, { flags: "w" });
  tui.setLogStream(logStream);
  tui.start();

  /** @param {string} message */
  function log(message) {
    tui.log(message);
  }

  const components = getComponentConfigs();
  const componentList = components.length > 0
    ? components.map((c) => `  - ${c.product} :: ${c.component} (${c.url})`).join("\n")
    : "  (none saved — use `moz-bugs component` to add some)";

  const server = new Server(
    { name: "moz-bugs", version: "2.2.0" },
    {
      capabilities: { tools: {} },
      instructions: `You are connected to a Bugzilla MCP server for moz-bugs.

Saved components being tracked:
${componentList}

Available tools:
- list_bugs: Fetch open bugs for saved components. Filters: component, assigned, priority, severity, sort, active.
- list_triage_bugs: Fetch bugs needing triage (missing priority or severity). Filter: component.
- propose_bug_update: Queue a field update (priority, severity, assigned_to) for user approval.
  The user must approve updates in the terminal — writes are never automatic.
  After proposing, use list_pending_updates to check whether the user approved or denied.
- list_pending_updates: Check the status of all proposed updates (pending/approved/denied/failed).
- list_components: List the saved component configurations.

Priority levels: ${PRIORITY_DESCRIPTIONS}
Severity levels: ${SEVERITY_DESCRIPTIONS}

This server requires user approval for all writes. Read operations are immediate.`,
    },
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
        case "list_bugs":            return await handleListBugs(args);
        case "list_triage_bugs":     return await handleListTriageBugs(args);
        case "propose_bug_update":   return handleProposeBugUpdate(args, tui);
        case "list_pending_updates": return handleListPendingUpdates(tui);
        case "list_components":      return handleListComponents();
        default:
          return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`error in ${name}: ${msg}`);
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    log(`${req.method} ${req.url}`);
    transport.handleRequest(req, res);
  });

  const url = `http://${HOST}:${PORT}`;

  await new Promise((resolve, reject) => {
    httpServer.listen(PORT, HOST, () => resolve(undefined));
    httpServer.once("error", reject);
  });

  log(`moz-bugs MCP server listening on ${url}`);
  log(`Log: ${LOG_PATH}`);
  log(`Add to Claude Code: claude mcp add --transport http moz-bugs ${url}`);
  log(`Tools: list_bugs, list_triage_bugs, propose_bug_update, list_pending_updates, list_components`);

  process.on("SIGINT", async () => {
    log("shutting down");
    await server.close();
    httpServer.close();
    tui.stop();
    process.exit(0);
  });
}
