// @ts-check
import color from "cli-color";
import { fetchBugs, printBugLine, updateBug } from "./bugzilla.mjs";
import { needsTriage } from "./query.mjs";

/** @typedef {import("./types.d.ts").Bug} Bug */
/** @typedef {import("./types.d.ts").BugzillaAuth} BugzillaAuth */
/** @typedef {import("./types.d.ts").ComponentConfig} ComponentConfig */
/** @typedef {import("./types.d.ts").BugCommentResponse} BugCommentResponse */

const DESCRIPTION_LINES = 10;

/** @type {Array<{label: string, value: string, shortcut?: string}>} */
const PRIORITY_OPTIONS = [
  { label: "P1 (1)", value: "P1", shortcut: "1" },
  { label: "P2 (2)", value: "P2", shortcut: "2" },
  { label: "P3 (3)", value: "P3", shortcut: "3" },
  { label: "P5 (5)", value: "P5", shortcut: "5" },
  { label: "refresh (r)", value: "__refresh__", shortcut: "r" },
  { label: "skip (esc)", value: "" },
];
const PRIORITY_DEFAULT = 2; // P3

/** @type {Array<{label: string, value: string, shortcut?: string}>} */
const SEVERITY_OPTIONS = [
  { label: "S1 (1)", value: "S1", shortcut: "1" },
  { label: "S2 (2)", value: "S2", shortcut: "2" },
  { label: "S3 (3)", value: "S3", shortcut: "3" },
  { label: "refresh (r)", value: "__refresh__", shortcut: "r" },
  { label: "skip (esc)", value: "" },
];
const SEVERITY_DEFAULT = 2; // S3

/**
 * @param {ComponentConfig[]} components
 * @param {(url: string) => BugzillaAuth | null} getAuth
 * @param {{ dryRun?: boolean }} [options]
 */
export async function runTriage(components, getAuth, options = {}) {
  const dryRun = options.dryRun ?? false;
  if (dryRun) {
    console.log(color.yellow("Dry run — no changes will be written to Bugzilla.\n"));
  }
  for (const config of components) {
    await triageComponent(config, getAuth(config.url), dryRun);
  }
}

/**
 * @param {ComponentConfig} config
 * @param {BugzillaAuth | null} auth
 * @param {boolean} dryRun
 */
async function triageComponent(config, auth, dryRun) {
  const { product, component, url } = config;

  if (!dryRun && !auth?.apiKey) {
    console.warn(color.yellow(`\nNo API key for ${url} — updates will be skipped.`));
  }

  const params = new URLSearchParams({
    product,
    component,
    resolution: "---",
    include_fields: "id,summary,status,assigned_to,priority,severity,type,depends_on,creator,creation_time",
  });
  const bugs = await fetchBugs(new URL(`/rest/bug?${params}`, url), url, auth?.apiKey);

  const toTriage = bugs.filter(needsTriage);

  if (toTriage.length === 0) {
    console.log(color.blackBright(`\n${product} :: ${component} — no bugs need triage.`));
    return;
  }

  const count = toTriage.length;
  console.log(`\n  ${color.bgCyan.black(` ${product} :: ${component} `)}  ${color.blackBright(`${count} bug${count !== 1 ? "s" : ""} need triage`)}`);
  console.log("");

  process.stdout.write("\x1b[2J\x1b[H");
  for (const bug of toTriage) {
    await triageBug(bug, url, auth?.apiKey ?? null, dryRun);
  }
}

/**
 * @param {Bug} initialBug
 * @param {string} url
 * @param {string | null} apiKey
 * @param {boolean} dryRun
 */
async function triageBug(initialBug, url, apiKey, dryRun) {
  let bug = initialBug;

  while (true) {
    printBugLine(bug, url, "");

    const date = bug.creation_time ? bug.creation_time.slice(0, 10) : "unknown";
    console.log(`  ${color.blackBright(`Filed by ${bug.creator ?? "unknown"} · ${date}`)}`);

    const description = await fetchBugDescription(bug.id, url, apiKey);
    if (description) {
      const wrapWidth = (process.stdout.columns || 80) - 2;
      const lines = description
        .split("\n")
        .flatMap((l) => (l.length === 0 ? [""] : wordWrap(l, wrapWidth)))
        .slice(0, DESCRIPTION_LINES);
      console.log(`  ${color.blackBright("─".repeat(Math.min(wrapWidth, 60)))}`);
      for (const line of lines) {
        console.log(`  ${line}`);
      }
    }
    console.log("");

    let newPriority = "";
    let newSeverity = "";
    let shouldRefresh = false;

    if (bug.priority === "--") {
      const pick = await selectFromList("Priority:", PRIORITY_OPTIONS, PRIORITY_DEFAULT);
      if (pick === null) { process.stdout.write("\x1b[2J\x1b[H"); return; }
      if (pick === "__refresh__") { shouldRefresh = true; }
      else { newPriority = pick; }
    }

    if (!shouldRefresh && bug.type === "defect" && bug.severity === "--") {
      const pick = await selectFromList("Severity:", SEVERITY_OPTIONS, SEVERITY_DEFAULT);
      if (pick === null) { process.stdout.write("\x1b[2J\x1b[H"); return; }
      if (pick === "__refresh__") { shouldRefresh = true; }
      else { newSeverity = pick; }
    }

    if (shouldRefresh) {
      const refreshed = await fetchOneBug(bug.id, url, apiKey);
      process.stdout.write("\x1b[2J\x1b[H");
      if (!refreshed || !needsTriage(refreshed)) return;
      bug = refreshed;
      continue;
    }

    if (newPriority || newSeverity) {
      const parts = [newPriority, newSeverity].filter(Boolean);
      if (dryRun) {
        console.log(color.blackBright(`  (dry run) Would set: ${parts.join(", ")}`));
      } else if (!apiKey) {
        console.log(color.blackBright("  (skipped — no API key)"));
      } else {
        /** @type {Record<string, string>} */
        const updates = {};
        if (newPriority) updates.priority = newPriority;
        if (newSeverity) updates.severity = newSeverity;
        await updateBug(bug.id, url, apiKey, updates);
        console.log(color.green(`  Updated: ${parts.join(", ")}`));
      }
    }

    process.stdout.write("\x1b[2J\x1b[H");
    return;
  }
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wordWrap(text, width) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * @param {string} prompt
 * @param {Array<{label: string, value: string, shortcut?: string}>} options
 * @param {number} defaultIndex
 * @returns {Promise<string | null>}
 */
function selectFromList(prompt, options, defaultIndex) {
  return new Promise((resolve) => {
    let selected = defaultIndex;
    const n = options.length;

    const renderOptions = () => {
      for (const [i, opt] of options.entries()) {
        const isSelected = i === selected;
        const line = isSelected
          ? `  ${color.cyan(">")} ${opt.label}`
          : `    ${color.blackBright(opt.label)}`;
        process.stdout.write(`${line}\n`);
      }
    };

    process.stdout.write(`  ${prompt}\n`);
    renderOptions();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    /** @param {string} key */
    const onKey = (key) => {
      const shortcutIdx = options.findIndex((o) => o.shortcut === key);
      if (shortcutIdx !== -1) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onKey);
        const opt = options[shortcutIdx];
        process.stdout.write(`\x1b[${n + 1}A\r\x1b[2K  ${prompt} ${color.cyan(opt.label)}\n\x1b[J`);
        resolve(opt.value);
        return;
      }
      if (key === "\x1b[A" || key === "k") {
        selected = (selected - 1 + n) % n;
        process.stdout.write(`\x1b[${n}A`);
        renderOptions();
      } else if (key === "\x1b[B" || key === "j") {
        selected = (selected + 1) % n;
        process.stdout.write(`\x1b[${n}A`);
        renderOptions();
      } else if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onKey);
        // Collapse prompt + option lines to a single result line
        const result = options[selected].label;
        process.stdout.write(
          `\x1b[${n + 1}A\r\x1b[2K  ${prompt} ${color.cyan(result)}\n\x1b[J`
        );
        resolve(options[selected].value);
      } else if (key === "\x1b") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onKey);
        process.stdout.write(`\x1b[${n + 1}A\r\x1b[2K  ${prompt} ${color.blackBright("(skipped)")}\n\x1b[J`);
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
 * @param {number} bugId
 * @param {string} url
 * @param {string | null} apiKey
 * @returns {Promise<Bug | null>}
 */
async function fetchOneBug(bugId, url, apiKey) {
  const params = new URLSearchParams({
    include_fields: "id,summary,status,assigned_to,priority,severity,type,depends_on,creator,creation_time",
  });
  params.append("id", String(bugId));
  const bugs = await fetchBugs(new URL(`/rest/bug?${params}`, url), url, apiKey ?? undefined);
  return bugs[0] ?? null;
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

