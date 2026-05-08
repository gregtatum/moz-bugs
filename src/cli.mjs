// @ts-check
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "url";
import { runComponentBugs } from "./bugzilla.mjs";
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
        await runAll();
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
      case "triage": {
        if (args.includes("--help") || args.includes("-h")) {
          printTriageHelp();
          break;
        }
        const dryRun = args.includes("--dryrun");
        const components = getComponentConfigs();
        if (components.length === 0) {
          console.log("No components saved.");
          console.log("Add one with: bugzilla-jira component <product> <component>");
          break;
        }
        if (!process.stdin.isTTY) {
          console.error("triage requires an interactive terminal.");
          process.exit(1);
        }
        await runTriage(components, getBugzillaAuth, { dryRun });
        break;
      }
      default:
        console.error(`Unknown command: ${String(command)}`);
        process.exit(1);
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

async function runAll() {
  const components = getComponentConfigs();
  if (components.length === 0) {
    console.log("No components saved.");
    console.log("Add one with: bugzilla-jira component <product> <component> [url]");
    return;
  }

  for (const config of components) {
    const auth = getBugzillaAuth(config.url);
    await runComponentBugs(config.product, config.component, config.url, auth?.apiKey);
  }
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

function printHelp() {
  console.log(`
Usage: bugzilla-jira <command> [options]

Commands:
  list            List open bugs for all saved components
  component       Save or remove a Bugzilla product/component to track
  triage          Interactively assign priority/severity to un-triaged bugs

Options:
  -h, --help      Show help

Run "bugzilla-jira <command> --help" for details on a specific command.
`.trim());
}

function printComponentHelp() {
  console.log(`
Usage: bugzilla-jira component <product> <component> [url]
       bugzilla-jira component <product> <component> [url] -d

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
Usage: bugzilla-jira triage

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
