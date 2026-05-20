// @ts-check
import color from "cli-color";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugSearchResponse} BugSearchResponse */
/** @typedef {import("./types.d.ts").BugFilters} BugFilters */
/** @typedef {import("./types.d.ts").ComponentBugsData} ComponentBugsData */

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

const NOBODY = "nobody@mozilla.org";

/**
 * @param {string[]} fields
 * @returns {(a: Bug, b: Bug) => number}
 */
function makeBugComparator(fields) {
  return (a, b) => {
    for (const field of fields) {
      let delta = 0;
      switch (field) {
        case "id":
          delta = a.id - b.id;
          break;
        case "creation_time":
          delta = (a.creation_time ?? "").localeCompare(b.creation_time ?? "");
          break;
        case "last_change_time":
          delta = (a.last_change_time ?? "").localeCompare(b.last_change_time ?? "");
          break;
        case "priority":
          delta = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
          break;
        case "severity":
          delta = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
          break;
        case "assigned_to":
          delta = a.assigned_to.localeCompare(b.assigned_to);
          break;
        case "summary":
          delta = a.summary.localeCompare(b.summary);
          break;
      }
      if (delta !== 0) return delta;
    }
    return 0;
  };
}

/**
 * Returns structured bug data for a single product/component without printing.
 *
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @param {string | undefined} apiKey
 * @param {BugFilters} [filters]
 * @returns {Promise<ComponentBugsData>}
 */
export async function getComponentBugs(product, component, url, apiKey, filters = {}) {
  const params = new URLSearchParams({
    product,
    component,
    resolution: "---",
    include_fields: "id,summary,status,assigned_to,assigned_to_detail,priority,severity,type,depends_on,groups,creation_time,last_change_time",
  });

  const endpoint = new URL(`/rest/bug?${params}`, url);
  const allBugs = await fetchBugs(endpoint, url, apiKey);
  const totalFetched = allBugs.length;

  if (filters.active) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const assigned = allBugs
      .filter((bug) => bug.assigned_to !== NOBODY)
      .filter((bug) => matchesBugFilter(bug, filters));

    const byRecency = (/** @type {Bug} */ a, /** @type {Bug} */ b) =>
      (b.last_change_time ?? "").localeCompare(a.last_change_time ?? "");

    const active = assigned
      .filter((bug) => (bug.last_change_time ?? "") >= cutoff)
      .sort(byRecency);

    const stale = assigned
      .filter((bug) => (bug.last_change_time ?? "") < cutoff)
      .sort(byRecency);

    return { product, component, url, totalFetched, bugs: [...active, ...stale], active, stale };
  }

  const requestedSortFields = filters.sort ?? [];
  const comparator = makeBugComparator(
    requestedSortFields.includes("summary")
      ? requestedSortFields
      : [...requestedSortFields, "summary"]
  );
  const sorted = [...allBugs].sort(comparator);

  if (requestedSortFields.length > 0) {
    const bugs = sorted.filter((bug) => matchesBugFilter(bug, filters));
    return { product, component, url, totalFetched, bugs };
  }

  // Default view: batch-fetch children of meta bugs and build a flat list
  // ordered as: meta bug followed by its visible children, non-meta bugs inline.
  const metaChildIds = new Set(
    sorted
      .filter((bug) => bug.summary.toLowerCase().includes("[meta]"))
      .flatMap((bug) => bug.depends_on ?? [])
  );

  /** @type {Map<number, Bug>} */
  const childMap = new Map();
  if (metaChildIds.size > 0) {
    const childParams = new URLSearchParams({
      include_fields: "id,summary,type,priority,severity,assigned_to,assigned_to_detail,groups,last_change_time",
      resolution: "---",
    });
    for (const id of metaChildIds) {
      childParams.append("id", String(id));
    }
    const fetchedChildren = await fetchBugs(new URL(`/rest/bug?${childParams}`, url), url, apiKey);
    for (const child of fetchedChildren) {
      childMap.set(child.id, child);
    }
  }

  const hasFilter = Boolean(filters.assigned || filters.priority || filters.severity);

  /** @type {Bug[]} */
  const bugs = [];
  for (const bug of sorted.filter((bug) => !metaChildIds.has(bug.id))) {
    const isMeta = bug.summary.toLowerCase().includes("[meta]");

    if (!isMeta) {
      if (!matchesBugFilter(bug, filters)) continue;
      bugs.push(bug);
    } else {
      const children = (bug.depends_on ?? [])
        .flatMap((id) => {
          const child = childMap.get(id);
          return child ? [child] : [];
        })
        .filter((child) => matchesBugFilter(child, filters))
        .sort(comparator);

      if (hasFilter && children.length === 0) continue;

      bugs.push(bug, ...children);
    }
  }

  return { product, component, url, totalFetched, bugs };
}

/**
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @param {string | undefined} apiKey
 * @param {BugFilters} [filters]
 */
export async function runComponentBugs(product, component, url, apiKey, filters = {}) {
  const data = await getComponentBugs(product, component, url, apiKey, filters);

  printHeader(product, component, url, data.totalFetched, filters);

  if (data.totalFetched === 0) {
    console.log(color.blackBright("  (no open bugs)"));
    return;
  }

  if (filters.active) {
    const active = data.active ?? [];
    const stale = data.stale ?? [];

    if (active.length === 0 && stale.length === 0) {
      console.log(color.blackBright("  (no assigned bugs)"));
      return;
    }

    const widths = computeColumnWidths([...active, ...stale]);

    if (active.length > 0) {
      printSectionHeader("Active", active.length);
      for (const bug of active) {
        printBugLine(bug, url, "", widths);
      }
    }

    if (stale.length > 0) {
      printSectionHeader("Stale · last activity 30+ days ago", stale.length);
      for (const bug of stale) {
        printBugLine(bug, url, "", widths);
      }
    }

    return;
  }

  const requestedSortFields = filters.sort ?? [];
  const widths = computeColumnWidths(data.bugs);

  if (requestedSortFields.length > 0) {
    for (const bug of data.bugs) {
      printBugLine(bug, url, "", widths);
    }
    return;
  }

  // Default view: render meta bugs as indented trees. The bugs array from
  // getComponentBugs already has children immediately following their parent,
  // but we need to know which bugs are children to render tree chars.
  const metaChildIds = new Set(
    data.bugs
      .filter((bug) => bug.summary.toLowerCase().includes("[meta]"))
      .flatMap((bug) => bug.depends_on ?? [])
  );

  let i = 0;
  while (i < data.bugs.length) {
    const bug = data.bugs[i];
    const isMeta = bug.summary.toLowerCase().includes("[meta]");

    if (!isMeta) {
      printBugLine(bug, url, "", widths);
      i++;
    } else {
      printBugLine(bug, url, "", widths);
      i++;
      // collect the children that follow (they are the ones in metaChildIds)
      const childStart = i;
      while (i < data.bugs.length && metaChildIds.has(data.bugs[i].id)) {
        i++;
      }
      const children = data.bugs.slice(childStart, i);
      for (let j = 0; j < children.length; j++) {
        const isLast = j === children.length - 1;
        printBugLine(children[j], url, isLast ? "└─ " : "├─ ", widths);
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
 * @param {BugFilters} [filters]
 */
function printHeader(product, component, url, bugCount, filters) {
  const p = encodeURIComponent(product);
  const c = encodeURIComponent(component);
  const openParams = new URLSearchParams({ product, component, bug_status: "__open__" });
  if (filters?.priority) openParams.append("priority", filters.priority);
  if (filters?.severity) openParams.append("bug_severity", filters.severity);
  if (filters?.assigned) {
    openParams.append("emailtype1", "substring");
    openParams.append("emailassigned_to1", "1");
    openParams.append("email1", filters.assigned);
  }
  const openUrl  = `${url}/buglist.cgi?${openParams}`;
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
 * Returns :nick if the real_name contains [:nick], otherwise the email username.
 * @param {Bug} bug
 */
function formatAssignee(bug) {
  const nickMatch = (bug.assigned_to_detail?.real_name ?? "").match(/\[:([^\]]+)\]/);
  if (nickMatch) return nickMatch[1];
  return bug.assigned_to.split("@")[0];
}

/** @param {string} iso */
function getDaysAgo(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** @param {number} days */
function formatDaysAgo(days) {
  return `${days}d`;
}

/**
 * Pre-compute column widths for aligned rendering across a set of bugs.
 * @param {Bug[]} bugs
 * @returns {{ assigneeWidth: number, daysWidth: number }}
 */
function computeColumnWidths(bugs) {
  let assigneeWidth = 0;
  let daysWidth = 0;
  for (const bug of bugs) {
    if (bug.assigned_to && bug.assigned_to !== NOBODY) {
      assigneeWidth = Math.max(assigneeWidth, formatAssignee(bug).length);
    }
    if (bug.last_change_time) {
      daysWidth = Math.max(daysWidth, formatDaysAgo(getDaysAgo(bug.last_change_time)).length);
    }
  }
  return { assigneeWidth, daysWidth };
}

/**
 * @param {Bug} bug
 * @param {string} url
 * @param {string} treeChar
 * @param {{ assigneeWidth?: number, daysWidth?: number }} [widths]
 */
export function printBugLine(bug, url, treeChar, widths = {}) {
  const { assigneeWidth = 0, daysWidth = 0 } = widths;
  const bugUrl = `${url}/show_bug.cgi?id=${bug.id}`;
  const link = `\x1b]8;;${bugUrl}\x1b\\${color.green(`${bug.id}`)}\x1b]8;;\x1b\\`;
  const isDefect = bug.type === "defect";
  const severityBadge = isDefect ? formatSeverityBadge(bug.severity) : null;
  const badge = severityBadge ?? formatType(bug.type);
  const priority = formatPriority(bug.priority);
  const tree = treeChar ? color.blackBright(treeChar) : "";

  const assigneeRaw = bug.assigned_to && bug.assigned_to !== NOBODY
    ? formatAssignee(bug) : "";
  const assigneeTrail = " ".repeat(Math.max(0, assigneeWidth - assigneeRaw.length));
  const assigneeCol = (assigneeRaw ? color.cyan(assigneeRaw) : "") + assigneeTrail;

  const daysRaw = bug.last_change_time ? formatDaysAgo(getDaysAgo(bug.last_change_time)) : "";
  const daysLead = " ".repeat(Math.max(0, daysWidth - daysRaw.length));
  const daysCol = daysLead + (daysRaw ? color.yellow(daysRaw) : "");

  const isRestricted = (bug.groups?.length ?? 0) > 0;
  const summary = isRestricted ? color.xterm(203)(bug.summary) : bug.summary;
  console.log(`${link} ${badge} ${priority} ${assigneeCol} ${daysCol} ${tree}${summary}`);
}

/**
 * @param {string} label
 * @param {number} count
 */
function printSectionHeader(label, count) {
  const text = `── ${label} (${count} bug${count !== 1 ? "s" : ""}) ──`;
  console.log(`\n  ${color.bold(text)}`);
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

/**
 * Severity badge for defects — replaces the type badge when severity is set.
 * Returns null for unset severity so the caller falls back to the " def " badge.
 * @param {string} severity
 * @returns {string | null}
 */
function formatSeverityBadge(severity) {
  switch (severity) {
    case "S1": return color.bgYellow.black(" S1  ");
    case "S2": return color.bgXterm(167).whiteBright(" S2  ");
    case "S3": return color.bgXterm(131).whiteBright(" S3  ");
    case "S4": return color.bgXterm(95).whiteBright(" S4  ");
    default:   return null;
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

/**
 * @param {number} bugId
 * @param {string} url
 * @param {string} apiKey
 * @param {Record<string, string>} updates
 */
export async function updateBug(bugId, url, apiKey, updates) {
  const endpoint = new URL(`/rest/bug/${bugId}`, url);
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Bugzilla-API-Key": apiKey,
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update bug ${bugId}: ${response.status} ${text}`);
  }
}

