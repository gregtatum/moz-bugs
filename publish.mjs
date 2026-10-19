#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import color from "cli-color";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(ROOT_DIR, "package.json");
const packageLockPath = resolve(ROOT_DIR, "package-lock.json");
const changelogPath = resolve(ROOT_DIR, "CHANGELOG.md");

/** @typedef {"major" | "minor" | "patch"} VersionBump */

/** @type {VersionBump[]} */
const BUMP_TYPES = ["major", "minor", "patch"];

class UsageError extends Error {}
class HelpRequested extends Error {}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ capture?: boolean }} [options]
 * @returns {string}
 */
function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return options.capture ? output.trim() : "";
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {boolean}
 */
function succeeds(command, args) {
  try {
    execFileSync(command, args, { cwd: ROOT_DIR, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} argv
 * @returns {{ bump: VersionBump, dryRun: boolean }}
 */
export function parseArgs(argv) {
  /** @type {VersionBump[]} */
  const bumps = [];
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--dryrun") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new HelpRequested();
    } else if (/** @type {string[]} */ (BUMP_TYPES).includes(arg)) {
      bumps.push(/** @type {VersionBump} */ (arg));
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }

  if (bumps.length === 0) {
    throw new UsageError("Missing version bump: major, minor, or patch.");
  }
  if (bumps.length > 1) {
    throw new UsageError("Specify exactly one version bump.");
  }

  return { bump: bumps[0], dryRun };
}

/**
 * @param {string} version
 * @param {VersionBump} bump
 * @returns {string}
 */
export function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid package version: ${version}`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown version bump: ${bump}`);
  }
}

/**
 * @param {string} changelog
 * @returns {boolean}
 */
export function hasUnreleasedEntry(changelog) {
  const lines = changelog.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "## Unreleased");
  if (startIndex === -1) {
    return false;
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      break;
    }
    if (/^\s*-\s+\S/.test(lines[index])) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string} changelog
 * @param {{ version: string, date: string }} release
 * @returns {string}
 */
export function promoteChangelog(changelog, { version, date }) {
  const lines = changelog.split("\n");
  const unreleasedIndex = lines.findIndex(
    (line) => line.trim() === "## Unreleased",
  );
  if (unreleasedIndex === -1) {
    throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  }

  let nextHeadingIndex = lines.length;
  for (let index = unreleasedIndex + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      nextHeadingIndex = index;
      break;
    }
  }

  const body = lines.slice(unreleasedIndex + 1, nextHeadingIndex);
  while (body.length && body[0].trim() === "") {
    body.shift();
  }
  while (body.length && body[body.length - 1].trim() === "") {
    body.pop();
  }

  return [
    ...lines.slice(0, unreleasedIndex),
    "## Unreleased",
    "",
    `## v${version} — ${date}`,
    "",
    ...body,
    "",
    ...lines.slice(nextHeadingIndex),
  ].join("\n");
}

/**
 * @param {string} changelog
 * @returns {string}
 */
function unreleasedBody(changelog) {
  const lines = changelog.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "## Unreleased");
  if (startIndex === -1) {
    return "";
  }
  const body = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }
  return body.join("\n").trim();
}

/** @returns {string} */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** @returns {string} */
function readVersion() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (typeof pkg.version !== "string") {
    throw new Error("package.json does not contain a string version.");
  }
  return pkg.version;
}

/**
 * @param {string} version
 */
function writeVersion(version) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const lock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].version = version;
  }
  writeFileSync(packageLockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

/**
 * @param {boolean} dryRun
 */
function createCheck(dryRun) {
  /**
   * @param {boolean} ok
   * @param {string} message
   */
  return function check(ok, message) {
    if (ok) {
      return;
    }
    if (dryRun) {
      console.warn(color.yellow(`warning: ${message}`));
    } else {
      throw new Error(message);
    }
  };
}

/** @returns {string} */
function usage() {
  return `
Usage: ./publish.mjs <patch|minor|major> [options]

Bumps the version, promotes the "## Unreleased" changelog section to the new
version, commits, tags, publishes to npm, and pushes.

Options:
  --dry-run       Report what would happen without changing anything
  -h, --help      Show this help
`.trim();
}

/** @param {string[]} argv */
async function main(argv) {
  const { bump, dryRun } = parseArgs(argv);
  const check = createCheck(dryRun);

  if (dryRun) {
    console.log(color.yellow("Dry run — nothing will be changed.\n"));
  }

  check(
    succeeds("npm", ["whoami"]),
    "Not authenticated with npm. Run 'npm login' and retry.",
  );

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    capture: true,
  });
  check(branch === "main", `Releases must be cut from main (on ${branch}).`);

  check(
    run("git", ["status", "--porcelain"], { capture: true }) === "",
    "Working tree has uncommitted changes. Commit or stash before publishing.",
  );

  const changelog = readFileSync(changelogPath, "utf8");
  check(
    hasUnreleasedEntry(changelog),
    'CHANGELOG.md has no entries under "## Unreleased". Describe the release before publishing.',
  );

  if (!dryRun) {
    run("git", ["fetch", "origin", "main", "--tags"]);
  }
  check(
    succeeds("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]),
    "origin/main has commits this branch does not contain. Rebase or merge first.",
  );

  const currentVersion = readVersion();
  const nextVersion = bumpVersion(currentVersion, bump);
  const tag = `v${nextVersion}`;

  check(
    !succeeds("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]),
    `Tag ${tag} already exists. A previous attempt may have published ${nextVersion} already; use the next bump instead.`,
  );

  run("npm", ["run", "ts"]);

  if (dryRun) {
    console.log("");
    console.log(`  version  ${currentVersion} → ${nextVersion}`);
    console.log(`  tag      ${tag}`);
    console.log(`  commit   Release ${nextVersion}`);
    console.log("");
    console.log(color.blackBright(`## v${nextVersion} — ${today()}`));
    console.log("");
    console.log(unreleasedBody(changelog));
    console.log("");
    return;
  }

  writeVersion(nextVersion);
  writeFileSync(
    changelogPath,
    promoteChangelog(changelog, { version: nextVersion, date: today() }),
  );

  run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
  run("git", ["commit", "-m", `Release ${nextVersion}`]);
  run("git", ["tag", "-a", tag, "-m", `Release ${nextVersion}`]);

  try {
    run("npm", ["publish", "--access", "public"]);
  } catch (error) {
    console.error(
      color.yellow(
        `\nThe release commit and ${tag} were created locally but nothing was published.` +
          `\nFix the problem and re-run 'npm publish --access public', or undo with:` +
          `\n  git reset --hard HEAD~1 && git tag -d ${tag}`,
      ),
    );
    throw error;
  }

  run("git", ["push", "origin", "HEAD", "--follow-tags"]);
  console.log(color.green(`\nPublished ${nextVersion}.`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof HelpRequested) {
      console.log(usage());
      return;
    }
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error("");
      console.error(usage());
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  });
}
