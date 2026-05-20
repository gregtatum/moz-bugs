// @ts-check
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import color from "cli-color";
import { runComponentBugs } from "./bugzilla.mjs";
import { closestMatch } from "./utils.mjs";
import { runTriage } from "./triage.mjs";
import {
  addComponentConfig,
  removeComponentConfig,
  getComponentConfigs,
  getBugzillaAuth,
  setBugzillaAuth,
  normalizeBugzillaUrl,
  DEFAULT_BUGZILLA_URL,
} from "./store.mjs";
import {
  resolveComponentQuery,
  normalizePFilter,
  normalizeSFilter,
  resolveSortField,
  VALID_PRIORITIES,
  VALID_SEVERITIES,
  SORT_FIELDS,
} from "./query.mjs";

export async function main(argv = process.argv) {
  const [command, ...args] = argv.slice(2);

  try {
    switch (command) {
      case undefined:
      case "--help":
      case "-h": {
        printHelp();
        break;
      }
      case "list": {
        if (args.includes("--help") || args.includes("-h")) {
          printListHelp();
          break;
        }
        await runAll(parseListFilters(args));
        break;
      }
      case "component": {
        if (args.includes("--help") || args.includes("-h")) {
          printComponentHelp();
          break;
        }
        const { isDelete, args: filteredArgs } = parseDeleteArgs(args);
        const [product, component, maybeUrl] = filteredArgs;
        const url = maybeUrl || DEFAULT_BUGZILLA_URL;

        if (!product || !component) {
          printComponentHelp();
          process.exit(1);
        }

        if (isDelete) {
          const { removed } = removeComponentConfig(product, component, url);
          if (removed) {
            console.log(
              `Removed component config for ${product} :: ${component}.`,
            );
          } else {
            console.log(
              `No saved config found for ${product} :: ${component}.`,
            );
          }
        } else {
          const { added } = addComponentConfig(product, component, url);
          if (added) {
            console.log(
              `Saved component config for ${product} :: ${component}.`,
            );
          } else {
            console.log(
              `Component config already saved for ${product} :: ${component}.`,
            );
          }
          await ensureBugzillaAuth(url);
        }
        break;
      }
      case "file": {
        if (args.includes("--help") || args.includes("-h")) {
          printFileHelp();
          break;
        }
        await runFile(args);
        break;
      }
      case "mcp": {
        if (args.includes("--help") || args.includes("-h")) {
          printMcpHelp();
          break;
        }
        const { runMcpServer } = await import("./mcp.mjs");
        await runMcpServer();
        break;
      }
      case "triage": {
        if (args.includes("--help") || args.includes("-h")) {
          printTriageHelp();
          break;
        }
        const dryRun = args.includes("--dryrun");
        const components = getComponentConfigs();
        if (components.length === 0) {
          console.log("No components saved.");
          console.log("Add one with: moz-bugs component <product> <component>");
          break;
        }
        if (!process.stdin.isTTY) {
          console.error("triage requires an interactive terminal.");
          process.exit(1);
        }
        await runTriage(components, getBugzillaAuth, { dryRun });
        break;
      }
      default: {
        const suggestion = closestMatch(String(command), [
          "list",
          "component",
          "triage",
          "file",
          "mcp",
        ]);
        const msg = suggestion
          ? `Unknown command "${command}", did you mean "${suggestion}"?`
          : `Unknown command: ${String(command)}`;
        console.error(msg);
        process.exit(1);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}


/**
 * @param {import("./types.d.ts").BugFilters} [filters]
 */
async function runAll(filters = {}) {
  const components = getComponentConfigs();

  const visible = filters.component
    ? resolveComponentQuery(filters.component, components)
    : components;

  if (visible.length === 0) {
    console.log("No components saved.");
    console.log("Add one with: moz-bugs component <product> <component> [url]");
    return;
  }

  for (const config of visible) {
    const auth = getBugzillaAuth(config.url);
    await runComponentBugs(
      config.product,
      config.component,
      config.url,
      auth?.apiKey,
      filters,
    );
  }
}

/**
 * @param {string[]} args
 */
async function runFile(args) {
  const componentQuery = parseFlag(args, ["--component", "-c"]);

  const savedComponents = getComponentConfigs();

  let config;

  if (componentQuery) {
    const matches = resolveComponentQuery(componentQuery, savedComponents);
    if (matches.length === 0) {
      console.log("No components saved.");
      console.log("Add one with: moz-bugs component <product> <component>");
      return;
    }
    config = matches[0];
  } else {
    if (savedComponents.length === 0) {
      console.log("No components saved.");
      console.log("Add one with: moz-bugs component <product> <component>");
      return;
    }
    if (!process.stdin.isTTY) {
      console.error("file requires --component or an interactive terminal.");
      process.exit(1);
    }
    const selected = await selectComponentConfig(savedComponents);
    if (!selected) return;
    config = selected;
  }

  const fileUrl =
    `${config.url}/enter_bug.cgi` +
    `?product=${encodeURIComponent(config.product)}` +
    `&component=${encodeURIComponent(config.component)}`;

  openBrowserUrl(fileUrl);
}

/**
 * @param {import("./types.d.ts").ComponentConfig[]} components
 * @returns {Promise<import("./types.d.ts").ComponentConfig | null>}
 */
function selectComponentConfig(components) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const count = components.length;

    /** @param {import("./types.d.ts").ComponentConfig} config */
    const label = (config) => `${config.product} :: ${config.component}`;

    const renderOptions = () => {
      for (let i = 0; i < count; i++) {
        const isSelected = i === selectedIndex;
        const line = isSelected
          ? `  ${color.cyan(">")} ${label(components[i])}`
          : `    ${color.blackBright(label(components[i]))}`;
        process.stdout.write(`${line}\n`);
      }
    };

    process.stdout.write("  Select a component:\n");
    renderOptions();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    /** @param {string} key */
    const onKey = (key) => {
      if (key === "\x1b[A" || key === "k") {
        selectedIndex = (selectedIndex - 1 + count) % count;
        process.stdout.write(`\x1b[${count}A`);
        renderOptions();
      } else if (key === "\x1b[B" || key === "j") {
        selectedIndex = (selectedIndex + 1) % count;
        process.stdout.write(`\x1b[${count}A`);
        renderOptions();
      } else if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onKey);
        const selected = components[selectedIndex];
        process.stdout.write(
          `\x1b[${count + 1}A\r\x1b[2K  ${color.cyan(label(selected))}\n\x1b[J`,
        );
        resolve(selected);
      } else if (key === "\x1b") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onKey);
        process.stdout.write(
          `\x1b[${count + 1}A\r\x1b[2K  ${color.blackBright("(cancelled)")}\n\x1b[J`,
        );
        resolve(null);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.exit(0);
      }
    };

    process.stdin.on("data", onKey);
  });
}

/**
 * @param {string} url
 */
function openBrowserUrl(url) {
  const opener =
    process.platform === "win32"
      ? "start"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  console.log(url);
}

/**
 * Finds the value of the first matching flag in args.
 * @param {string[]} args
 * @param {string[]} names
 * @returns {string | null}
 */
function parseFlag(args, names) {
  for (let i = 0; i < args.length; i++) {
    const isMatch = names.includes(args[i]);
    const hasValue = args[i + 1] !== undefined && !args[i + 1].startsWith("-");
    if (isMatch && hasValue) {
      return args[i + 1];
    }
  }
  return null;
}

/**
 * @param {string} url
 */
async function ensureBugzillaAuth(url) {
  const existing = getBugzillaAuth(url);
  if (existing?.apiKey) {
    return;
  }

  if (!process.stdin.isTTY) {
    console.warn(
      `No Bugzilla API key configured for ${url}. Run the component command in a terminal to set one.`,
    );
    return;
  }

  const normalizedUrl = normalizeBugzillaUrl(url);
  const origin = new URL(normalizedUrl).origin;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`API key URL: ${origin}/userprefs.cgi?tab=apikey`);
    const token = (
      await rl.question("Paste Bugzilla API key (or press Enter to skip): ")
    ).trim();
    if (token) {
      setBugzillaAuth(url, token);
    }
  } finally {
    rl.close();
  }
}

/**
 * @param {string[]} args
 * @returns {{ isDelete: boolean; args: string[] }}
 */
function parseDeleteArgs(args) {
  const filtered = [];
  let isDelete = false;
  for (const arg of args) {
    if (arg === "-d" || arg === "--delete") {
      isDelete = true;
      continue;
    }
    filtered.push(arg);
  }
  return { isDelete, args: filtered };
}

/**
 * @param {string[]} args
 * @returns {import("./types.d.ts").BugFilters}
 */
function parseListFilters(args) {
  /** @type {import("./types.d.ts").BugFilters} */
  const filters = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const val =
      args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : null;
    switch (flag) {
      case "--component":
      case "-c":
        if (val) {
          filters.component = val;
          i++;
        }
        break;
      case "--assigned":
      case "-a":
        if (val) {
          filters.assigned = val;
          i++;
        }
        break;
      case "--priority":
      case "-p":
        if (val) {
          const p = normalizePFilter(val);
          if (!VALID_PRIORITIES.has(p)) {
            console.error(
              `Invalid priority "${val}". Expected P1–P5 (e.g. p1, P2, 3).`,
            );
            process.exit(1);
          }
          filters.priority = p;
          i++;
        }
        break;
      case "--severity":
      case "-v":
        if (val) {
          const s = normalizeSFilter(val);
          if (!VALID_SEVERITIES.has(s)) {
            console.error(
              `Invalid severity "${val}". Expected S1–S4 (e.g. s1, S2, 3).`,
            );
            process.exit(1);
          }
          filters.severity = s;
          i++;
        }
        break;
      case "--sort":
      case "-s":
        if (val) {
          filters.sort = val.split(",").map(resolveSortField);
          i++;
        }
        break;
      case "--active":
        filters.active = true;
        break;
    }
  }
  return filters;
}


// NOTE: Keep in sync with the README.md.
function printHelp() {
  console.log(
    `
Usage: moz-bugs <command> [options]

Commands:
  list            List open bugs for all saved components
  file            Open a browser to file a new bug
  component       Save or remove a Bugzilla product/component to track
  triage          Interactively assign priority/severity to un-triaged bugs
  mcp             Start an MCP server exposing bugs as AI-accessible tools

Options:
  -h, --help      Show help

Run "moz-bugs <command> --help" for details on a specific command.
`.trim(),
  );
}

// NOTE: Keep in sync with the README.md.
function printFileHelp() {
  console.log(
    `
Usage: moz-bugs file [options]

Open a browser to file a new bug. If --component is omitted, an interactive
list of your saved components is shown to pick from.

Options:
  -c, --component <query>   Component to file against; fuzzy-match or "Product :: Component"
  -h, --help                Show this help
`.trim(),
  );
}

// NOTE: Keep in sync with the README.md.
function printListHelp() {
  console.log(
    `
Usage: moz-bugs list [options]

List open bugs across all saved components.

Options:
  -c, --component <query>   Fuzzy-match against saved components;
                            or use "Product :: Component" to look up directly,
                            e.g. "Core :: Machine Learning: General"
  -a, --assigned <query>    Show only bugs whose assignee fuzzy-matches <query>
  -p, --priority <value>    Filter by priority  (e.g. p1, P2, 1)
  -v, --severity <value>    Filter by severity  (e.g. s1, S2, 3)
  -s, --sort <fields>       Comma-separated sort fields; fuzzy-matched against:
                            id, creation_time, last_change_time, priority,
                            severity, assigned_to, summary
                            Summary is always appended as a final tiebreaker.
                            (e.g. --sort priority,creation)
      --active              Show Active / Stale sections by assignee activity.
                            Active = assigned + touched within 30 days;
                            Stale = assigned + no activity for 30+ days.
  -h, --help                Show this help
`.trim(),
  );
}

// NOTE: Keep in sync with the README.md.
function printComponentHelp() {
  console.log(
    `
Usage: moz-bugs component <product> <component> [url]
       moz-bugs component <product> <component> [url] -d

Save or remove a Bugzilla product/component pair to track.

Arguments:
  product         Bugzilla product name        (e.g. Core)
  component       Bugzilla component name      (e.g. "Machine Learning: On Device")
  url             Bugzilla instance URL        (default: https://bugzilla.mozilla.org)

Options:
  -d, --delete    Remove the component instead of adding it
  -h, --help      Show this help
`.trim(),
  );
}

// NOTE: Keep in sync with the README.md.
function printMcpHelp() {
  console.log(
    `
Usage: moz-bugs mcp

Start an MCP (Model Context Protocol) HTTP server on localhost:50044.
You must have this running before connecting an AI client to it.

The server logs to ~/.moz-bugs-mcp.log.
Use \`tail -f ~/.moz-bugs-mcp.log\` to monitor activity.

Tools exposed (read-only):
  list_bugs         List open bugs with optional filters:
                      component, assigned, priority, severity, sort, active
  list_components   List saved component configurations

To add to Claude Desktop, edit:
  ~/Library/Application Support/Claude/claude_desktop_config.json

To add to Claude Code:
  claude mcp add --transport http moz-bugs http://127.0.0.1:50044

Options:
  -h, --help        Show this help
`.trim(),
  );
}

// NOTE: Keep in sync with the README.md.
function printTriageHelp() {
  console.log(
    `
Usage: moz-bugs triage

Walk through open bugs across all saved components and assign priority
and severity to any that are missing them.

  Priority is prompted when the bug has no priority set (--).
  Severity is prompted for defects with no severity set (--).
  Bugs that are already fully triaged are skipped silently.
  Requires an API key to write updates back to Bugzilla.

Options:
  --dryrun        Prompt as normal but do not write any changes to Bugzilla
  -h, --help      Show this help
`.trim(),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
