// @ts-check
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {import("./types.d.ts").Store} Store */
/** @typedef {import("./types.d.ts").ComponentConfig} ComponentConfig */
/** @typedef {import("./types.d.ts").BugzillaAuth} BugzillaAuth */

export const DEFAULT_BUGZILLA_URL = "https://bugzilla.mozilla.org";

function resolveStoragePath() {
  const override = process.env.MOZ_BUGS_STORE_PATH;
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".moz-bugs.json");
}

/** @type {Store | null} */
let cachedStore = null;

/** @returns {Store} */
function loadStore() {
  if (cachedStore) {
    return cachedStore;
  }
  const storagePath = resolveStoragePath();
  if (!fs.existsSync(storagePath)) {
    cachedStore = { components: [] };
    return cachedStore;
  }
  try {
    const raw = fs.readFileSync(storagePath, "utf8");
    cachedStore = JSON.parse(raw);
    if (!cachedStore) {
      cachedStore = { components: [] };
    }
    if (!Array.isArray(cachedStore.components)) {
      cachedStore.components = [];
    }
    return cachedStore;
  } catch {
    cachedStore = { components: [] };
    return cachedStore;
  }
}

/** @param {Store} store */
function saveStore(store) {
  const storagePath = resolveStoragePath();
  const content = JSON.stringify(store, null, 2);
  fs.writeFileSync(storagePath, `${content}\n`, "utf8");
}

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeBugzillaUrl(url) {
  const trimmed = (url || DEFAULT_BUGZILLA_URL).trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

/**
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @param {{ confidential?: boolean }} [options]
 * @returns {{ added: boolean; updated: boolean }}
 */
export function addComponentConfig(product, component, url, options = {}) {
  const store = loadStore();
  const normalizedUrl = normalizeBugzillaUrl(url);
  const confidential = Boolean(options.confidential);
  const index = store.components.findIndex(
    (c) =>
      c.product === product &&
      c.component === component &&
      c.url === normalizedUrl,
  );
  if (index !== -1) {
    if (Boolean(store.components[index].confidential) === confidential) {
      return { added: false, updated: false };
    }
    store.components = [...store.components];
    const { confidential: _dropped, ...rest } = store.components[index];
    store.components[index] = confidential ? { ...rest, confidential } : rest;
    saveStore(store);
    return { added: false, updated: true };
  }
  /** @type {ComponentConfig} */
  const added = { product, component, url: normalizedUrl };
  if (confidential) {
    added.confidential = true;
  }
  store.components = [...store.components, added];
  saveStore(store);
  return { added: true, updated: false };
}

/**
 * @param {string} product
 * @param {string} component
 * @param {string} url
 * @returns {{ removed: boolean }}
 */
export function removeComponentConfig(product, component, url) {
  const store = loadStore();
  const normalizedUrl = normalizeBugzillaUrl(url);
  const before = store.components.length;
  store.components = store.components.filter(
    (c) =>
      !(
        c.product === product &&
        c.component === component &&
        c.url === normalizedUrl
      ),
  );
  if (store.components.length === before) {
    return { removed: false };
  }
  saveStore(store);
  return { removed: true };
}

/** @returns {ComponentConfig[]} */
export function getComponentConfigs() {
  return loadStore().components;
}

/**
 * @param {string} url
 * @returns {BugzillaAuth | null}
 */
export function getBugzillaAuth(url) {
  const normalizedUrl = normalizeBugzillaUrl(url);
  const store = loadStore();
  return store.bugzillaAuth?.find((a) => a.url === normalizedUrl) ?? null;
}

/**
 * @param {string} url
 * @param {string} apiKey
 * @returns {{ added: boolean; updated: boolean }}
 */
export function setBugzillaAuth(url, apiKey) {
  const normalizedUrl = normalizeBugzillaUrl(url);
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("API key cannot be empty.");
  }
  const store = loadStore();
  const existing = store.bugzillaAuth ?? [];
  const index = existing.findIndex((a) => a.url === normalizedUrl);
  if (index === -1) {
    store.bugzillaAuth = [
      ...existing,
      { url: normalizedUrl, apiKey: trimmedKey },
    ];
    saveStore(store);
    return { added: true, updated: false };
  }
  const changed = existing[index].apiKey !== trimmedKey;
  if (changed) {
    store.bugzillaAuth = [...existing];
    store.bugzillaAuth[index] = { url: normalizedUrl, apiKey: trimmedKey };
    saveStore(store);
  }
  return { added: false, updated: changed };
}
