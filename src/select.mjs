// @ts-check
import color from "cli-color";
import { fuzzyMatch } from "./bugzilla.mjs";

/** How many options are visible at once. */
const WINDOW_SIZE = 10;

/**
 * An interactive picker that filters as you type. Unlike a plain arrow-key
 * list it only ever draws a fixed window of rows, so it stays usable against
 * the couple of thousand components a Bugzilla instance exposes.
 *
 * Resolves with the selected value, or null when cancelled with Escape.
 *
 * @template T
 * @param {{ label: string, value: T }[]} options
 * @param {{ prompt: string, query?: string }} config
 * @returns {Promise<T | null>}
 */
export function selectFromOptions(options, { prompt, query = "" }) {
  return new Promise((resolve) => {
    let filter = query;
    let selectedIndex = 0;
    let renderedLines = 0;
    /** @type {{ label: string, value: T }[]} */
    let matches = options;

    const applyFilter = () => {
      if (!filter) {
        matches = options;
      } else {
        const needle = filter.toLowerCase();
        // fuzzyMatch is a subsequence test, which alone ranks "Core :: DOM:
        // Security" below unrelated labels that happen to contain the same
        // letters in order. Contiguous matches are promoted ahead of those,
        // earliest position first, so exact typing lands on the obvious row.
        matches = options
          .filter((option) => fuzzyMatch(filter, option.label))
          .map((option) => {
            const at = option.label.toLowerCase().indexOf(needle);
            return { option, tier: at === -1 ? 1 : 0, at: at === -1 ? 0 : at };
          })
          .sort((a, b) => a.tier - b.tier || a.at - b.at)
          .map((scored) => scored.option);
      }
      selectedIndex = Math.min(selectedIndex, Math.max(0, matches.length - 1));
    };

    // A label that wraps would throw off the cursor arithmetic used to redraw,
    // so anything wider than the terminal is cut short.
    /** @param {string} text */
    const truncate = (text) => {
      const max = Math.max(20, (process.stdout.columns ?? 80) - 6);
      return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    const render = () => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A`);
      }
      process.stdout.write("\r\x1b[J");

      const count = matches.length;
      const lines = [
        `  ${prompt} ${color.cyan(filter)}${color.blackBright("▌")}` +
          color.blackBright(`  (${count} match${count === 1 ? "" : "es"})`),
      ];

      if (count === 0) {
        lines.push(color.blackBright("    (no matches)"));
      } else {
        const windowSize = Math.min(WINDOW_SIZE, count);
        const start = Math.max(
          0,
          Math.min(
            selectedIndex - Math.floor(windowSize / 2),
            count - windowSize,
          ),
        );
        for (let i = start; i < start + windowSize; i++) {
          const text = truncate(matches[i].label);
          lines.push(
            i === selectedIndex
              ? `  ${color.cyan(">")} ${color.cyan(text)}`
              : `    ${color.blackBright(text)}`,
          );
        }
        if (count > windowSize) {
          lines.push(color.blackBright(`    … ${count - windowSize} more`));
        }
      }

      process.stdout.write(`${lines.join("\n")}\n`);
      renderedLines = lines.length;
    };

    /** @param {{ label: string, value: T } | null} selected */
    const finish = (selected) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onKey);
      process.stdout.write(`\x1b[${renderedLines}A\r\x1b[J`);
      process.stdout.write(
        selected
          ? `  ${color.cyan(selected.label)}\n`
          : `  ${color.blackBright("(cancelled)")}\n`,
      );
      resolve(selected ? selected.value : null);
    };

    /** @param {string} key */
    const onKey = (key) => {
      if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.exit(0);
      }
      if (key === "\r" || key === "\n") {
        finish(matches[selectedIndex] ?? null);
        return;
      }
      if (key === "\x1b") {
        finish(null);
        return;
      }

      if (key === "\x1b[A" || key === "\x10") {
        if (matches.length > 0) {
          selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
        }
      } else if (key === "\x1b[B" || key === "\x0e") {
        if (matches.length > 0) {
          selectedIndex = (selectedIndex + 1) % matches.length;
        }
      } else if (key === "\x7f" || key === "\b") {
        filter = filter.slice(0, -1);
        applyFilter();
      } else if (key === "\x15") {
        filter = "";
        applyFilter();
      } else if (/^[\x20-\x7e]+$/.test(key)) {
        filter += key;
        applyFilter();
      } else {
        // Unrecognized escape sequence (page keys, mouse reports, …).
        return;
      }

      render();
    };

    applyFilter();
    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onKey);
  });
}
