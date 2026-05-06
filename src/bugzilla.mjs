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
    include_fields: "id,summary,status,assigned_to,priority,severity,type,depends_on",
  });

  const endpoint = new URL(`/rest/bug?${params}`, url);
  const bugs = await fetchBugs(endpoint, url, apiKey);

  printHeader(product, component, url, bugs.length);

  if (bugs.length === 0) {
    console.log(color.blackBright("  (no open bugs)"));
    return;
  }

  const sorted = [...bugs].sort((a, b) => a.summary.localeCompare(b.summary));
  // Batch-fetch children of all meta bugs in one request
  const childIdSet = new Set(
    sorted
      .filter((bug) => bug.summary.toLowerCase().includes("[meta]"))
      .flatMap((bug) => bug.depends_on ?? [])
  );
  const childIds = [...childIdSet];

  /** @type {Map<number, Bug>} */
  const childMap = new Map();
  if (childIds.length > 0) {
    const childParams = new URLSearchParams({
      include_fields: "id,summary,type,priority,severity,assigned_to",
      resolution: "---",
    });
    for (const id of childIds) {
      childParams.append("id", String(id));
    }
    const children = await fetchBugs(new URL(`/rest/bug?${childParams}`, url), url, apiKey);
    for (const child of children) {
      childMap.set(child.id, child);
    }
  }

  for (const bug of sorted.filter((bug) => !childIdSet.has(bug.id))) {
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
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @param {number} bugCount
 */
function printHeader(product, component, url, bugCount) {
  const p = encodeURIComponent(product);
  const c = encodeURIComponent(component);
  const openUrl  = `${url}/buglist.cgi?product=${p}&component=${c}&bug_status=__open__`;
  const fixedUrl = `${url}/buglist.cgi?product=${p}&component=${c}&chfield=resolution&chfieldfrom=-6m&chfieldvalue=FIXED&bug_status=__closed__`;
  const fileUrl  = `${url}/enter_bug.cgi?product=${p}&component=${c}`;

  const titleBar = color.bgCyan.black(` ${product} :: ${component}  ·  ${bugCount} open bug${bugCount !== 1 ? "s" : ""} `);

  console.log(`\n  ${titleBar}`);
  console.log(`  ${color.blackBright("├─")} ${termLink("See Open Bugs",  openUrl)}`);
  console.log(`  ${color.blackBright("├─")} ${termLink("Recently Fixed", fixedUrl)}`);
  console.log(`  ${color.blackBright("└─")} ${termLink("File New Bug",   fileUrl)}`);
  console.log("");
}

/**
 * @param {string} text
 * @param {string} url
 * @returns {string}
 */
function termLink(text, url) {
  return `\x1b]8;;${url}\x1b\\${color.cyan(text)}\x1b]8;;\x1b\\`;
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
  const severity = formatSeverity(bug.severity);
  const tree = treeChar ? `${color.blackBright(treeChar)}` : "";
  const assignee =
    bug.assigned_to && bug.assigned_to !== "nobody@mozilla.org"
      ? ` ${color.blackBright(`(${bug.assigned_to})`)}`
      : "";
  console.log(`  ${link}  ${type} ${priority} ${severity} ${tree}${bug.summary}${assignee}`);
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

/** @param {string} severity */
function formatSeverity(severity) {
  switch (severity) {
    case "S1": return color.yellow("S1");
    case "S2": return color.yellow("S2");
    case "S3": return color.yellowBright("S3");
    case "S4": return color.blackBright("S4");
    default:   return color.blackBright("--");
  }
}
