// @ts-check
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import color from "cli-color";
import { runComponentBugs, fuzzyMatch } from "./bugzilla.mjs";
import { closestMatch, levenshtein } from "./utils.mjs";
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
            console.log(`Removed component config for ${product} :: ${component}.`);
          } else {
            console.log(`No saved config found for ${product} :: ${component}.`);
          }
        } else {
          const { added } = addComponentConfig(product, component, url);
          if (added) {
            console.log(`Saved component config for ${product} :: ${component}.`);
          } else {
            console.log(`Component config already saved for ${product} :: ${component}.`);
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
        const suggestion = closestMatch(String(command), ["list", "component", "triage", "file"]);
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
 * Resolves a component query to matching ComponentConfig objects.
 * A query containing "::" is treated as "Product :: Component" and looked up
 * directly. Otherwise fuzzy search runs first, with Levenshtein as a fallback.
 *
 * @param {string} query
 * @param {import("./types.d.ts").ComponentConfig[]} savedComponents
 * @returns {import("./types.d.ts").ComponentConfig[]}
 */
function resolveComponentQuery(query, savedComponents) {
  if (query.includes("::")) {
    const separatorIndex = query.indexOf("::");
    const product = query.slice(0, separatorIndex).trim();
    const component = query.slice(separatorIndex + 2).trim();
    const matchingConfig = savedComponents.find(
      (c) => c.product.toLowerCase() === product.toLowerCase()
    );
    const url = matchingConfig?.url ?? DEFAULT_BUGZILLA_URL;
    return [{ product, component, url }];
  }

  const fuzzyMatches = savedComponents.filter((c) =>
    fuzzyMatch(query, `${c.product} ${c.component}`)
  );

  if (fuzzyMatches.length > 0) {
    return fuzzyMatches;
  }

  // Levenshtein fallback: pick the closest saved component
  let closest = null;
  let closestDist = Infinity;

  for (const c of savedComponents) {
    const dist = levenshtein(query, `${c.product} ${c.component}`);
    if (dist < closestDist) {
      closestDist = dist;
      closest = c;
    }
  }

  return closest ? [closest] : [];
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
    await runComponentBugs(config.product, config.component, config.url, auth?.apiKey, filters);
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

  const fileUrl = `${config.url}/enter_bug.cgi`
    + `?product=${encodeURIComponent(config.product)}`
    + `&component=${encodeURIComponent(config.component)}`;

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
          `\x1b[${count + 1}A\r\x1b[2K  ${color.cyan(label(selected))}\n\x1b[J`
        );
        resolve(selected);
      } else if (key === "\x1b") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onKey);
        process.stdout.write(
          `\x1b[${count + 1}A\r\x1b[2K  ${color.blackBright("(cancelled)")}\n\x1b[J`
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
  const opener = process.platform === "win32" ? "start"
    : process.platform === "darwin" ? "open"
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
      `No Bugzilla API key configured for ${url}. Run the component command in a terminal to set one.`
    );
    return;
  }

  const normalizedUrl = normalizeBugzillaUrl(url);
  const origin = new URL(normalizedUrl).origin;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`API key URL: ${origin}/userprefs.cgi?tab=apikey`);
    const token = (await rl.question("Paste Bugzilla API key (or press Enter to skip): ")).trim();
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
    const val = args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : null;
    switch (flag) {
      case "--component": case "-c":
        if (val) { filters.component = val; i++; }
        break;
      case "--assigned": case "-a":
        if (val) { filters.assigned = val; i++; }
        break;
      case "--priority": case "-p":
        if (val) { filters.priority = normalizePFilter(val); i++; }
        break;
      case "--severity": case "-s":
        if (val) { filters.severity = normalizeSFilter(val); i++; }
        break;
    }
  }
  return filters;
}

/** @param {string} v */
function normalizePFilter(v) {
  return `P${v.toUpperCase().replace(/^P/, "")}`;
}

/** @param {string} v */
function normalizeSFilter(v) {
  return `S${v.toUpperCase().replace(/^S/, "")}`;
}

function printHelp() {
  console.log(`
Usage: moz-bugs <command> [options]

Commands:
  list            List open bugs for all saved components
  file            Open a browser to file a new bug
  component       Save or remove a Bugzilla product/component to track
  triage          Interactively assign priority/severity to un-triaged bugs

Options:
  -h, --help      Show help

Run "moz-bugs <command> --help" for details on a specific command.
`.trim());
}

function printFileHelp() {
  console.log(`
Usage: moz-bugs file [options]

Open a browser to file a new bug. If --component is omitted, an interactive
list of your saved components is shown to pick from.

Options:
  -c, --component <query>   Component to file against; fuzzy-match or "Product :: Component"
  -h, --help                Show this help
`.trim());
}

function printListHelp() {
  console.log(`
Usage: moz-bugs list [options]

List open bugs across all saved components.

Options:
  -c, --component <query>   Fuzzy-match against saved components;
                            or use "Product :: Component" to look up directly,
                            e.g. "Core :: Machine Learning: General"
  -a, --assigned <query>    Show only bugs whose assignee fuzzy-matches <query>
  -p, --priority <value>    Filter by priority  (e.g. p1, P2, 1)
  -s, --severity <value>    Filter by severity  (e.g. s2, S3, 3)
  -h, --help                Show this help
`.trim());
}

function printComponentHelp() {
  console.log(`
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
`.trim());
}

function printTriageHelp() {
  console.log(`
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
`.trim());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
