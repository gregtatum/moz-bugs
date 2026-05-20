// @ts-check
import color from "cli-color";
import blessed from "neo-blessed";
import { updateBug } from "./bugzilla.mjs";

/** @typedef {import("./types.d.ts").PendingBugUpdate} PendingBugUpdate */
/** @typedef {import("./types.d.ts").UpdateStatus} UpdateStatus */
/** @typedef {import("./types.d.ts").BugzillaAuth} BugzillaAuth */

export class Tui {
  /** @param {{ getAuth: (url: string) => BugzillaAuth | null }} opts */
  constructor({ getAuth }) {
    this._getAuth = getAuth;
    /** @type {Map<string, PendingBugUpdate>} */
    this._updates = new Map();
    this._selectedIdx = 0;
    /** @type {any} */
    this._screen = null;
    /** @type {any} */
    this._logBox = null;
    /** @type {any} */
    this._pendingBox = null;
    /** @type {import("node:fs").WriteStream | null} */
    this._logStream = null;
  }

  /** @param {import("node:fs").WriteStream} stream */
  setLogStream(stream) {
    this._logStream = stream;
  }

  start() {
    this._screen = blessed.screen({ smartCSR: true, title: "moz-bugs MCP" });

    this._logBox = blessed.log({
      parent: this._screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "70%",
      border: { type: "line" },
      label: " Log ",
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: " ", style: { bg: "cyan" } },
      style: { border: { fg: "cyan" }, label: { fg: "cyan" } },
    });

    this._pendingBox = blessed.box({
      parent: this._screen,
      top: "70%",
      left: 0,
      width: "100%",
      height: "30%",
      border: { type: "line" },
      label: " Pending Updates ",
      scrollable: true,
      style: { border: { fg: "yellow" }, label: { fg: "yellow" } },
    });

    this._setupKeys();
    this._renderPending();
    this._screen.render();
  }

  _setupKeys() {
    this._screen.key(["up", "k"], () => {
      const pending = this._pendingItems();
      if (pending.length === 0) return;
      this._selectedIdx = (this._selectedIdx - 1 + pending.length) % pending.length;
      this._renderPending();
    });

    this._screen.key(["down", "j"], () => {
      const pending = this._pendingItems();
      if (pending.length === 0) return;
      this._selectedIdx = (this._selectedIdx + 1) % pending.length;
      this._renderPending();
    });

    this._screen.key(["a"], async () => {
      const pending = this._pendingItems();
      const item = pending[this._selectedIdx];
      if (!item) return;
      const auth = this._getAuth(item.url);
      if (!auth?.apiKey) {
        this.log(`No API key for ${item.url} — cannot approve Bug ${item.bugId}`);
        this._resolve(item.id, "failed");
        return;
      }
      /** @type {Record<string, string>} */
      const updates = {};
      if (item.updates.priority)    updates.priority    = item.updates.priority;
      if (item.updates.severity)    updates.severity    = item.updates.severity;
      if (item.updates.type)        updates.type        = item.updates.type;
      if (item.updates.assigned_to) updates.assigned_to = item.updates.assigned_to;
      try {
        await updateBug(item.bugId, item.url, auth.apiKey, updates);
        this.log(`Approved Bug ${item.bugId}: ${formatUpdatesSummary(item.updates)}`);
        this._resolve(item.id, "approved");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`Failed Bug ${item.bugId}: ${msg}`);
        this._resolve(item.id, "failed");
      }
    });

    this._screen.key(["d"], () => {
      const pending = this._pendingItems();
      const item = pending[this._selectedIdx];
      if (!item) return;
      this.log(`Denied Bug ${item.bugId}: ${formatUpdatesSummary(item.updates)}`);
      this._resolve(item.id, "denied");
    });

    this._screen.key(["q", "C-c"], () => {
      this.stop();
      process.exit(0);
    });
  }

  /** @param {string} message */
  log(message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    this._logStream?.write(line + "\n");
    if (this._logBox) {
      this._logBox.log(line);
    }
  }

  /** @param {PendingBugUpdate} update */
  enqueue(update) {
    this._updates.set(update.id, update);
    this._selectedIdx = Math.min(this._selectedIdx, Math.max(0, this._pendingItems().length - 1));
    this._renderPending();
  }

  /** @returns {PendingBugUpdate[]} */
  getUpdates() {
    return Array.from(this._updates.values());
  }

  /** @returns {PendingBugUpdate[]} */
  _pendingItems() {
    return Array.from(this._updates.values()).filter((u) => u.status === "pending");
  }

  /**
   * @param {string} id
   * @param {UpdateStatus} status
   */
  _resolve(id, status) {
    const item = this._updates.get(id);
    if (!item) return;
    item.status = status;
    item.resolvedAt = new Date().toISOString();
    this._selectedIdx = Math.max(0, Math.min(this._selectedIdx, this._pendingItems().length - 1));
    this._renderPending();
  }

  _renderPending() {
    if (!this._pendingBox || !this._screen) return;

    const pending = this._pendingItems();

    if (pending.length === 0) {
      this._pendingBox.setContent(
        "  When the AI proposes a bug update (via propose_bug_update), it appears here\n" +
        "  for your review before anything is written to Bugzilla. You approve or deny\n" +
        "  each proposal with [a] / [d]. No writes happen without your confirmation.\n\n" +
        "  [q]uit"
      );
      this._screen.render();
      return;
    }

    const idx = Math.min(this._selectedIdx, pending.length - 1);
    // -4: border (2) + inner padding (2)
    const cols = Math.max(40, (this._screen.width ?? 80) - 4);

    /** @type {string[]} */
    const lines = [];
    lines.push(
      `  ${color.yellow(`Pending (${pending.length})`)}  ` +
      color.blackBright("[a]pprove  [d]eny  [↑↓] navigate  [q]uit")
    );
    lines.push("");

    let selectedLine = 2;

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const isSelected = i === idx;

      if (isSelected) selectedLine = lines.length;

      // Build title line
      const cursor    = isSelected ? color.cyan(">") : " ";
      const bugIdStr  = color.green(String(item.bugId));
      const badges    = formatUpdateBadges(item.updates);
      // Compute visual prefix width to know how much space remains for summary
      const prefixVis = 4 + String(item.bugId).length + 2 + stripAnsi(badges).length + 2;
      const summaryMax = Math.max(8, cols - prefixVis);
      const summary   = item.summary.length > summaryMax
        ? item.summary.slice(0, summaryMax - 1) + "…"
        : item.summary;

      lines.push(`  ${cursor} ${bugIdStr}  ${badges}  ${color.blackBright(summary)}`);

      // Expanded detail for the selected item
      if (isSelected) {
        const hostname = safeHostname(item.url);
        lines.push(`    ${color.blackBright(`↳ ${hostname} · #${item.bugId}`)}`);

        // Word-wrap reason; indent = 6 visible chars ("      ")
        const wrapWidth = Math.max(20, cols - 6);
        for (const reasonLine of wordWrap(item.reason, wrapWidth)) {
          lines.push(`      ${reasonLine}`);
        }
        lines.push("");
      }
    }

    this._pendingBox.setContent(lines.join("\n"));
    this._pendingBox.scrollTo(selectedLine);
    this._screen.render();
  }

  stop() {
    if (this._screen) {
      this._screen.destroy();
      this._screen = null;
    }
    this._logStream?.end();
  }
}

/** @param {PendingBugUpdate["updates"]} updates */
function formatUpdateBadges(updates) {
  const parts = [];
  if (updates.type)        parts.push(color.cyan(`[${updates.type}]`));
  if (updates.priority)    parts.push(color.yellow(`[${updates.priority}]`));
  if (updates.severity)    parts.push(color.xterm(167)(`[${updates.severity}]`));
  if (updates.assigned_to) parts.push(color.blackBright(`[@${updates.assigned_to.split("@")[0]}]`));
  return parts.join(" ");
}

/** @param {PendingBugUpdate["updates"]} updates */
function formatUpdatesSummary(updates) {
  const parts = [];
  if (updates.type)        parts.push(`type → ${updates.type}`);
  if (updates.priority)    parts.push(`priority → ${updates.priority}`);
  if (updates.severity)    parts.push(`severity → ${updates.severity}`);
  if (updates.assigned_to) parts.push(`assigned_to → ${updates.assigned_to}`);
  return parts.join(", ") || "(no changes)";
}

/** @param {string} str */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** @param {string} url */
function safeHostname(url) {
  try { return new URL(url).hostname; }
  catch { return url; }
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wordWrap(text, width) {
  const words = text.split(" ");
  /** @type {string[]} */
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
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
