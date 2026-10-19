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
moz-bugs track "Core" "Machine Learning: On Device"
```

API keys can be generated at `https://bugzilla.mozilla.org/userprefs.cgi?tab=apikey`.

## Usage

Save one or more components first, then run `moz-bugs list` to see open bugs across all of them.

### Command reference

- List open bugs across all saved components  
  `moz-bugs list`
- Interactively choose a componenent to list from
  `moz-bugs list --interactive`
- Save or remove a Bugzilla component  
  `moz-bugs track <product> <component> [url]`  
  `moz-bugs track <product> <component> [url] --delete`
- Pick a component interactively instead of naming it  
  `moz-bugs track`  
  `moz-bugs track <product>` narrows the list to one product, and
  `moz-bugs track --delete` picks from your saved components.
- Track only the confidential/security bugs of a component  
  `moz-bugs track <product> <component> [url] --confidential`  
  Re-run without `--confidential` to go back to listing every bug.
- Open a browser tab to file a new bug  
  `moz-bugs file`  
  `moz-bugs file --component <query>`
- List untriaged bugs, or step through them to assign priority/severity  
  `moz-bugs triage`  
  `moz-bugs triage --interactive`  

### list

```sh
moz-bugs list [options]
```

| Flag | Description |
|---|---|
| `-i, --interactive` | Interactively choose a component to list from |
| `-c, --component <query>` | Fuzzy-match against saved components, or use `"Product :: Component"` to query directly without a saved config |
| `-a, --assigned <query>` | Show only bugs whose assignee fuzzy-matches `<query>` |
| `-p, --priority <value>` | Filter by priority (e.g. `p1`, `P2`, `1`) |
| `-v, --severity <value>` | Filter by severity (e.g. `s1`, `S2`, `3`) |
| `-s, --sort <fields>` | Comma-separated sort fields, fuzzy-matched (e.g. `--sort priority,creation`) |
| `--active` | Show two sections: **Active** (assigned, touched within 30 days) and **Stale** (assigned, no activity for 30+ days). Excludes bugs assigned to nobody. |
| `--confidential` | Show only confidential bugs (restricted to a security group, shown in red). Alias: `--security` |
Valid sort fields: `id`, `creation_time`, `last_change_time`, `priority`, `severity`, `assigned_to`, `summary`. Summary is always appended as the final tiebreaker.

Meta bugs (`[meta]` in the summary) are shown as indented trees with their child bugs nested beneath them. Passing `--sort` switches to a flat list instead.

### track

```sh
# Pick a component from a filterable list of everything the instance exposes
moz-bugs track

# Same, narrowed to one product
moz-bugs track "Core"

# Add a component
moz-bugs track "Core" "Machine Learning: On Device"

# Add a component from a non-default Bugzilla instance
moz-bugs track "Core" "Machine Learning: On Device" https://bugzilla-dev.allizom.org

# Remove a saved component
moz-bugs track "Core" "Machine Learning: On Device" --delete

# Pick a saved component to remove
moz-bugs track --delete
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

List open bugs that need triage across all saved components and prompts to assign priority and severity to any that are unset. For the interactive mode, requires a Bugzilla API key with write access.

```sh
# List bugs that need triage
moz-bugs triage

# Step through them and assign priority/severity
moz-bugs triage --interactive

# Prompt as normal but do not write any changes to Bugzilla
moz-bugs triage --interactive --dryrun
```

## Development

- `npm run ts` runs TypeScript against the JSDoc annotations.

## Publishing

Login to npm via `npm login`, then run the helper script from the repo root:

```sh
./bin/publish.mjs <patch|minor|major>
```

## AI Use

This tool was primarily authored using AI agentic programming flows.
