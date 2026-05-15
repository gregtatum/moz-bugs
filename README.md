# moz-bugs

A CLI tool for tracking and triaging open bugs across Bugzilla components.

## Example Usage

```
➤ moz-bugs list

  Core :: Machine Learning: On Device  ·  102 open bugs
├─ See Open Bugs
├─ Recently Fixed
└─ File New Bug

Bug 2038632   tsk  -- -- [meta] "Keep the lights on" maintenance work
Bug 2039284   tsk  P3 -- ├─ Add docs to describe the costs for passing IPC boundaries
Bug 1984033   def  P2 -- ├─ Don't use `main` models in production
Bug 1909230   enh  P2 -- ├─ Implement Fetch Retry with Backoff for ML Model Downloads (atossou@mozilla.com)
Bug 2039404   tsk  P3 -- └─ Review the quality of errors reported to WebExtension devs using on-device inference
```

## Installation

Install from npm to get the tool on your PATH:

```sh
npm install -g moz-bugs
```

Or run it ad-hoc with `npx`:

```sh
npx moz-bugs
```

Add a Bugzilla component to track — you will be prompted for an API key the first time:

```sh
moz-bugs component "Core" "Machine Learning: On Device"
```

API keys can be generated at `https://bugzilla.mozilla.org/userprefs.cgi?tab=apikey`.

## Usage

Save one or more components first, then run `moz-bugs list` to see open bugs across all of them.

### Command reference

- List open bugs across all saved components  
  `moz-bugs list`
- Save or remove a Bugzilla component  
  `moz-bugs component <product> <component> [url]`  
  `moz-bugs component <product> <component> [url] --delete`
- Open a browser tab to file a new bug  
  `moz-bugs file`  
  `moz-bugs file --component <query>`
- Interactively assign priority/severity to untriaged bugs  
  `moz-bugs triage`  
  `moz-bugs triage --dryrun`

### list

```sh
moz-bugs list [options]
```

| Flag | Description |
|---|---|
| `-c, --component <query>` | Fuzzy-match against saved components, or use `"Product :: Component"` to query directly without a saved config |
| `-a, --assigned <query>` | Show only bugs whose assignee fuzzy-matches `<query>` |
| `-p, --priority <value>` | Filter by priority (e.g. `p1`, `P2`, `1`) |
| `-v, --severity <value>` | Filter by severity (e.g. `s1`, `S2`, `3`) |
| `-s, --sort <fields>` | Comma-separated sort fields, fuzzy-matched (e.g. `--sort priority,creation`) |

Valid sort fields: `id`, `creation_time`, `last_change_time`, `priority`, `severity`, `assigned_to`, `summary`. Summary is always appended as the final tiebreaker.

Meta bugs (`[meta]` in the summary) are shown as indented trees with their child bugs nested beneath them. Passing `--sort` switches to a flat list instead.

### component

```sh
# Add a component
moz-bugs component "Core" "Machine Learning: On Device"

# Add a component from a non-default Bugzilla instance
moz-bugs component "Core" "Machine Learning: On Device" https://bugzilla-dev.allizom.org

# Remove a saved component
moz-bugs component "Core" "Machine Learning: On Device" --delete
```

### file

Opens a browser tab pre-filled with the product and component for filing a new bug. With no flags, shows an interactive picker of saved components.

```sh
# Interactive picker
moz-bugs file

# Jump straight to a specific component
moz-bugs file -c "Core :: Machine Learning: On Device"
```

### triage

Walks through open bugs across all saved components and prompts to assign priority and severity to any that are unset. Requires a Bugzilla API key with write access.

```sh
moz-bugs triage

# Prompt as normal but do not write any changes to Bugzilla
moz-bugs triage --dryrun
```

## Development

- `npm run ts` runs TypeScript against the JSDoc annotations.

## Publishing

Login to npm via `npm login`, then run the helper script from the repo root:

```sh
./publish.sh [patch|minor|major]
```

## AI Use Disclosure

This tool was primarily authored using AI agentic programming flows.
