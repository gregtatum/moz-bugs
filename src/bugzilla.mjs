// @ts-check
import color from "cli-color";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugSearchResponse} BugSearchResponse */

/**
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @param {string | undefined} apiKey
 */
export async function runComponentBugs(product, component, url, apiKey) {
  const params = new URLSearchParams({
    product,
    component,
    resolution: "---",
    include_fields: "id,summary,status,assigned_to,priority,type,depends_on",
  });

  const endpoint = new URL(`/rest/bug?${params}`, url);
  const bugs = await fetchBugs(endpoint, url, apiKey);

  const divider = "=".repeat(60);
  console.log(
    color.cyan(`\n======= ${product} :: ${component} ${divider.slice(product.length + component.length + 7)}`)
  );

  if (bugs.length === 0) {
    console.log(color.blackBright("  (no open bugs)"));
    return;
  }

  const sorted = [...bugs].sort((a, b) => a.summary.localeCompare(b.summary));

  // Batch-fetch children of all meta bugs in one request
  const childIds = [
    ...new Set(
      sorted
        .filter((bug) => bug.summary.toLowerCase().includes("[meta]"))
        .flatMap((bug) => bug.depends_on ?? [])
    ),
  ];

  /** @type {Map<number, Bug>} */
  const childMap = new Map();
  if (childIds.length > 0) {
    const childParams = new URLSearchParams({
      include_fields: "id,summary,type,priority,assigned_to",
    });
    for (const id of childIds) {
      childParams.append("id", String(id));
    }
    const children = await fetchBugs(new URL(`/rest/bug?${childParams}`, url), url, apiKey);
    for (const child of children) {
      childMap.set(child.id, child);
    }
  }

  for (const bug of sorted) {
    printBugLine(bug, url, "");

    if (bug.summary.toLowerCase().includes("[meta]") && bug.depends_on?.length) {
      const children = bug.depends_on
        .flatMap((id) => { const b = childMap.get(id); return b ? [b] : []; })
        .sort((a, b) => a.summary.localeCompare(b.summary));

      for (let i = 0; i < children.length; i++) {
        const isLast = i === children.length - 1;
        printBugLine(children[i], url, isLast ? "└─ " : "├─ ");
      }
      console.log("");
    }
  }
}

/**
 * @param {URL} endpoint
 * @param {string} url
 * @param {string | undefined} apiKey
 * @returns {Promise<Bug[]>}
 */
async function fetchBugs(endpoint, url, apiKey) {
  /** @type {HeadersInit} */
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-Bugzilla-API-Key"] = apiKey;
  }

  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    throw new Error(`Bugzilla request failed: ${response.status} ${response.statusText}`);
  }

  /** @type {BugSearchResponse & { error?: { message?: string; messageText?: string } }} */
  const json = await response.json();
  if (json.error) {
    const err = json.error;
    throw new Error(`Bugzilla error: ${err.message ?? err.messageText ?? JSON.stringify(err)}`);
  }
  return json.bugs;
}

/**
 * @param {Bug} bug
 * @param {string} url
 * @param {string} treeChar
 */
function printBugLine(bug, url, treeChar) {
  const bugUrl = `${url}/show_bug.cgi?id=${bug.id}`;
  const link = `\x1b]8;;${bugUrl}\x1b\\${color.green(`Bug ${bug.id}`)}\x1b]8;;\x1b\\`;
  const type = formatType(bug.type);
  const priority = formatPriority(bug.priority);
  const tree = treeChar ? `${color.blackBright(treeChar)}` : "";
  const assignee =
    bug.assigned_to && bug.assigned_to !== "nobody@mozilla.org"
      ? ` ${color.blackBright(`(${bug.assigned_to})`)}`
      : "";
  console.log(`  ${link}  ${type} ${priority} ${tree}${bug.summary}${assignee}`);
}

/** @param {string} type */
function formatType(type) {
  switch (type) {
    case "defect": return color.bgRed.whiteBright(" def ");
    case "task": return color.bgBlue.whiteBright(" tsk ");
    case "enhancement": return color.bgGreen.black(" enh ");
    default: return color.blackBright("     ");
  }
}

/** @param {string} priority */
function formatPriority(priority) {
  switch (priority) {
    case "P1": return color.yellow("P1");
    case "P2": return color.yellow("P2");
    case "P3": return color.yellowBright("P3");
    case "P4": return color.blackBright("P4");
    case "P5": return color.blackBright("P5");
    default:   return color.blackBright("--");
  }
}
