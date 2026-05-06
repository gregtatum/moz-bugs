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
    include_fields: "id,summary,status,assigned_to,priority,type",
  });

  const endpoint = new URL(`/rest/bug?${params}`, url);

  /** @type {HeadersInit} */
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-Bugzilla-API-Key"] = apiKey;
  }

  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    throw new Error(
      `Bugzilla request failed: ${response.status} ${response.statusText}`
    );
  }

  /** @type {BugSearchResponse & { error?: { message?: string; messageText?: string } }} */
  const json = await response.json();

  if (json.error) {
    const err = json.error;
    throw new Error(
      `Bugzilla error: ${err.message ?? err.messageText ?? JSON.stringify(err)}`
    );
  }

  const divider = "=".repeat(60);
  console.log(
    color.cyan(`\n======= ${product} :: ${component} ${divider.slice(product.length + component.length + 7)}`)
  );

  if (json.bugs.length === 0) {
    console.log(color.blackBright("  (no open bugs)"));
    return;
  }

  const sorted = [...json.bugs].sort((a, b) => a.summary.localeCompare(b.summary));

  for (const bug of sorted) {
    const bugUrl = `${url}/show_bug.cgi?id=${bug.id}`;
    const link = `\x1b]8;;${bugUrl}\x1b\\${color.green(`Bug ${bug.id}`)}\x1b]8;;\x1b\\`;
    const type = formatType(bug.type);
    const priority = formatPriority(bug.priority);
    const assignee =
      bug.assigned_to && bug.assigned_to !== "nobody@mozilla.org"
        ? ` ${color.blackBright(`(${bug.assigned_to})`)}`
        : "";
    console.log(`  ${link}  ${type} ${priority} ${bug.summary}${assignee}`);
  }
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
