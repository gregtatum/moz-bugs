// @ts-check
import { fuzzyMatch } from "./bugzilla.mjs";
import { levenshtein } from "./utils.mjs";

/** @typedef {import("./types.d.ts").ComponentConfig} ComponentConfig */

export const VALID_PRIORITIES = new Set(["P1", "P2", "P3", "P4", "P5"]);
export const VALID_SEVERITIES = new Set(["S1", "S2", "S3", "S4"]);
export const SORT_FIELDS = [
  "id",
  "creation_time",
  "last_change_time",
  "priority",
  "severity",
  "assigned_to",
  "summary",
];

/**
 * Resolves a component query to matching ComponentConfig objects.
 * A query containing "::" is treated as "Product :: Component" and looked up
 * directly. Otherwise fuzzy search runs first, with Levenshtein as a fallback.
 *
 * @param {string} query
 * @param {ComponentConfig[]} savedComponents
 * @returns {ComponentConfig[]}
 */
export function resolveComponentQuery(query, savedComponents) {
  if (query.includes("::")) {
    const separatorIndex = query.indexOf("::");
    const product = query.slice(0, separatorIndex).trim();
    const component = query.slice(separatorIndex + 2).trim();
    const matchingConfig = savedComponents.find(
      (c) => c.product.toLowerCase() === product.toLowerCase(),
    );
    const url = matchingConfig?.url ?? "https://bugzilla.mozilla.org";
    return [{ product, component, url }];
  }

  const fuzzyMatches = savedComponents.filter((c) =>
    fuzzyMatch(query, `${c.product} ${c.component}`),
  );

  if (fuzzyMatches.length > 0) {
    return fuzzyMatches;
  }

  let closest = null;
  let closestDist = Infinity;

  for (const c of savedComponents) {
    const dist = levenshtein(query, `${c.product} ${c.component}`);
    if (dist < closestDist) {
      closestDist = dist;
      closest = c;
    }
  }

  return closest ? [closest] : [];
}

/** @param {string} v */
export function normalizePFilter(v) {
  return `P${v.toUpperCase().replace(/^P/, "")}`;
}

/** @param {string} v */
export function normalizeSFilter(v) {
  return `S${v.toUpperCase().replace(/^S/, "")}`;
}

/**
 * @param {string} input
 * @returns {string}
 */
export function resolveSortField(input) {
  const s = input.toLowerCase().trim();
  let best = SORT_FIELDS[0];
  let bestDist = Infinity;
  for (const field of SORT_FIELDS) {
    const dist = levenshtein(s, field);
    if (dist < bestDist) {
      bestDist = dist;
      best = field;
    }
  }
  return best;
}
