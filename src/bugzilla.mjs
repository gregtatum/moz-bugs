// @ts-check
import color from "cli-color";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugSearchResponse} BugSearchResponse */
/** @typedef {import("./types.d.ts").BugFilters} BugFilters */

/**
 * @param {string} query
 * @param {string} target
 * @returns {boolean}
 */
export function fuzzyMatch(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * @param {Bug} bug
 * @param {BugFilters} filters
 */
function matchesBugFilter(bug, filters) {
  if (filters.assigned && !fuzzyMatch(filters.assigned, bug.assigned_to)) return false;
  if (filters.priority && bug.priority !== filters.priority) return false;
  if (filters.severity && bug.severity !== filters.severity) return false;
  return true;
}

/** @type {Record<string,number>} */
const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2, P4: 3, P5: 4 };
/** @type {Record<string,number>} */
const SEVERITY_ORDER = { S1: 0, S2: 1, S3: 2, S4: 3 };

/**
 * @param {string[]} fields
 * @returns {(a: Bug, b: Bug) => number}
 */
function makeBugComparator(fields) {
  return (a, b) => {
    for (const field of fields) {
      let cmp = 0;
      switch (field) {
        case "id": cmp = a.id - b.id; break;
        case "creation_time":
        case "last_change_time":
          cmp = (a[field] ?? "").localeCompare(b[field] ?? "");
          break;
        case "priority":
          cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
          break;
        case "severity":
          cmp = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
          break;
        case "assigned_to": cmp = a.assigned_to.localeCompare(b.assigned_to); break;
        case "summary": cmp = a.summary.localeCompare(b.summary); break;
      }
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
}

/**
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @param {string | undefined} apiKey
 * @param {BugFilters} [filters]
 */
export async function runComponentBugs(product, component, url, apiKey, filters = {}) {
  const params = new URLSearchParams({
    product,
    component,
    resolution: "---",
    include_fields: "id,summary,status,assigned_to,priority,severity,type,depends_on,creation_time,last_change_time",
  });

  const endpoint = new URL(`/rest/bug?${params}`, url);
  const bugs = await fetchBugs(endpoint, url, apiKey);

  printHeader(product, component, url, bugs.length);

  if (bugs.length === 0) {
    console.log(color.blackBright("  (no open bugs)"));
    return;
  }

  const sortFields = filters.sort ?? [];
  const cmp = makeBugComparator(
    sortFields.includes("summary") ? sortFields : [...sortFields, "summary"]
  );
  const sorted = [...bugs].sort(cmp);
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

  const hasFilter = Boolean(filters.assigned || filters.priority || filters.severity);

  for (const bug of sorted.filter((bug) => !childIdSet.has(bug.id))) {
    const isMeta = bug.summary.toLowerCase().includes("[meta]");

    if (!isMeta) {
      if (!matchesBugFilter(bug, filters)) continue;
      printBugLine(bug, url, "");
    } else {
      const children = (bug.depends_on ?? [])
        .flatMap((id) => { const b = childMap.get(id); return b ? [b] : []; })
        .filter((b) => matchesBugFilter(b, filters))
        .sort(cmp);

      if (hasFilter && children.length === 0) continue;

      printBugLine(bug, url, "");
      for (let i = 0; i < children.length; i++) {
        const isLast = i === children.length - 1;
        printBugLine(children[i], url, isLast ? "└─ " : "├─ ");
      }
      if (children.length > 0) console.log("");
    }
  }
}

/**
 * @param {URL} endpoint
 * @param {string} url
 * @param {string | undefined} apiKey
 * @returns {Promise<Bug[]>}
 */
export async function fetchBugs(endpoint, url, apiKey) {
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
export function printBugLine(bug, url, treeChar) {
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
    case "P1": return color.bgYellow.black("P1");
    case "P2": return color.yellow("P2");
    case "P3": return color.xterm(136)("P3");
    case "P4": return `\x1b]8;;https://firefox-source-docs.mozilla.org/bug-mgmt/guides/priority.html\x1b\\${color.red("P4")}\x1b]8;;\x1b\\`;
    case "P5": return color.blackBright("P5");
    default:   return color.blackBright("--");
  }
}

/** @param {string} severity */
function formatSeverity(severity) {
  switch (severity) {
    case "S1": return color.bgYellow.black("S1");
    case "S2": return color.yellow("S2");
    case "S3": return color.xterm(136)("S3");
    case "S4": return color.blackBright("S4");
    default:   return color.blackBright("--");
  }
}
