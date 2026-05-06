// @ts-check
import { createInterface } from "node:readline/promises";
import color from "cli-color";
import { fetchBugs, printBugLine } from "./bugzilla.mjs";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugzillaAuth} BugzillaAuth */
/** @typedef {import("./types.d.ts").ComponentConfig} ComponentConfig */
/** @typedef {import("./types.d.ts").BugCommentResponse} BugCommentResponse */

const DESCRIPTION_LINES = 5;
const LINE_CAP = 100;

const PRIORITY_MAP = /** @type {Record<string, string>} */ ({ "1": "P1", "2": "P2", "3": "P3", "5": "P5" });
const SEVERITY_MAP = /** @type {Record<string, string>} */ ({ "1": "S1", "2": "S2", "3": "S3" });

/**
 * @param {ComponentConfig[]} components
 * @param {(url: string) => BugzillaAuth | null} getAuth
 */
export async function runTriage(components, getAuth) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const config of components) {
      await triageComponent(config, getAuth(config.url), rl);
    }
  } finally {
    rl.close();
  }
}

/**
 * @param {ComponentConfig} config
 * @param {BugzillaAuth | null} auth
 * @param {import("node:readline/promises").Interface} rl
 */
async function triageComponent(config, auth, rl) {
  const { product, component, url } = config;

  if (!auth?.apiKey) {
    console.warn(color.yellow(`\nNo API key for ${url} — updates will be skipped.`));
  }

  const params = new URLSearchParams({
    product,
    component,
    resolution: "---",
    include_fields: "id,summary,status,assigned_to,priority,severity,type,depends_on,creator,creation_time",
  });
  const bugs = await fetchBugs(new URL(`/rest/bug?${params}`, url), url, auth?.apiKey);

  const toTriage = bugs.filter(
    (b) => b.priority === "--" || (b.type === "defect" && b.severity === "--")
  );

  if (toTriage.length === 0) {
    console.log(color.blackBright(`\n${product} :: ${component} — no bugs need triage.`));
    return;
  }

  const count = toTriage.length;
  console.log(`\n  ${color.bgCyan.black(` ${product} :: ${component} `)}  ${color.blackBright(`${count} bug${count !== 1 ? "s" : ""} need triage`)}`);
  console.log("");

  for (const bug of toTriage) {
    await triageBug(bug, url, auth?.apiKey ?? null, rl);
  }
}

/**
 * @param {Bug} bug
 * @param {string} url
 * @param {string | null} apiKey
 * @param {import("node:readline/promises").Interface} rl
 */
async function triageBug(bug, url, apiKey, rl) {
  printBugLine(bug, url, "");

  const date = bug.creation_time ? bug.creation_time.slice(0, 10) : "unknown";
  console.log(`  ${color.blackBright(`Filed by ${bug.creator ?? "unknown"} · ${date}`)}`);

  const description = await fetchBugDescription(bug.id, url, apiKey);
  if (description) {
    console.log(`  ${color.blackBright("─".repeat(50))}`);
    const lines = description
      .split("\n")
      .slice(0, DESCRIPTION_LINES)
      .map((l) => (l.length > LINE_CAP ? l.slice(0, LINE_CAP - 1) + "…" : l));
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  }
  console.log("");

  let newPriority = "";
  let newSeverity = "";

  if (bug.priority === "--") {
    const raw = (await rl.question("  Priority [1=P1 2=P2 3=P3 5=P5 Enter=skip]: ")).trim();
    if (raw && !PRIORITY_MAP[raw]) {
      const retry = (await rl.question("  Invalid. Priority [1=P1 2=P2 3=P3 5=P5 Enter=skip]: ")).trim();
      newPriority = PRIORITY_MAP[retry] ?? "";
    } else {
      newPriority = PRIORITY_MAP[raw] ?? "";
    }
  }

  if (bug.type === "defect" && bug.severity === "--") {
    const raw = (await rl.question("  Severity [1=S1 2=S2 3=S3 Enter=skip]: ")).trim();
    if (raw && !SEVERITY_MAP[raw]) {
      const retry = (await rl.question("  Invalid. Severity [1=S1 2=S2 3=S3 Enter=skip]: ")).trim();
      newSeverity = SEVERITY_MAP[retry] ?? "";
    } else {
      newSeverity = SEVERITY_MAP[raw] ?? "";
    }
  }

  if (newPriority || newSeverity) {
    if (!apiKey) {
      console.log(color.blackBright("  (skipped — no API key)"));
    } else {
      /** @type {Record<string, string>} */
      const updates = {};
      if (newPriority) updates.priority = newPriority;
      if (newSeverity) updates.severity = newSeverity;
      await updateBug(bug.id, url, apiKey, updates);
      const parts = [newPriority, newSeverity].filter(Boolean);
      console.log(color.green(`  Updated: ${parts.join(", ")}`));
    }
  }

  console.log("");
}

/**
 * @param {number} bugId
 * @param {string} url
 * @param {string | null} apiKey
 * @returns {Promise<string>}
 */
async function fetchBugDescription(bugId, url, apiKey) {
  const params = new URLSearchParams({ include_fields: "text,count" });
  const endpoint = new URL(`/rest/bug/${bugId}/comment?${params}`, url);
  /** @type {HeadersInit} */
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["X-Bugzilla-API-Key"] = apiKey;
  }
  try {
    const response = await fetch(endpoint, { headers });
    if (!response.ok) return "";
    /** @type {BugCommentResponse} */
    const json = await response.json();
    const comments = json.bugs[String(bugId)]?.comments ?? [];
    const first = comments.find((c) => c.count === 0) ?? comments[0];
    return first?.text ?? "";
  } catch {
    return "";
  }
}

/**
 * @param {number} bugId
 * @param {string} url
 * @param {string} apiKey
 * @param {Record<string, string>} updates
 */
async function updateBug(bugId, url, apiKey, updates) {
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
