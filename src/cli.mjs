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
      case undefined: {
        await runAll();
        break;
      }
      case "component": {
        const { isDelete, args: filteredArgs } = parseDeleteArgs(args);
        const [product, component, maybeUrl] = filteredArgs;
        const url = maybeUrl || DEFAULT_BUGZILLA_URL;

        if (!product || !component) {
          throw new Error(
            'Usage: bugzilla-jira component <product> <component> [url]\n' +
            'Example: bugzilla-jira component Core "Machine Learning: On Device"'
          );
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
        await runTriage(components, getBugzillaAuth);
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
    console.log('Add one with: bugzilla-jira component <product> <component> [url]');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
