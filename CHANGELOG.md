# Changelog

## Unreleased

### Added
- `track` opens an interactive picker when the component is omitted. The list
  of products and components comes from the Bugzilla API (`/rest/product`),
  is filtered as you type, and is cached for a week beside the config file.
  `track <product>` narrows it to one product and `track --delete` picks from
  the saved components instead.
- `list --interactive` (`-i`) picks a single component to list from the same
  type-to-filter picker `track` uses, covering every component the Bugzilla
  instance exposes rather than only the saved ones. `-c` seeds the filter box,
  or narrows the picker when it names a product.
- `--confidential` flag (alias `--security`) for `track`, saving a component
  that only ever lists its confidential bugs. `list` and `triage` honor it, and
  re-running `track` without the flag goes back to listing every bug.

### Changed
- **Breaking:** the `component` sub-command is now `track`. Its arguments and
  flags are unchanged; `moz-bugs component` is no longer recognized.
- A component whose open bugs are all filtered out now prints an explicit
  empty state instead of a bare header, and the header notes when a listing is
  confidential-only.

### Fixed
- The header bug count now reflects the active filters instead of counting
  every open bug in the component, so a confidential-only listing no longer
  reports the component's full open-bug total.
- Column alignment in the tree view is measured from the rows that are
  actually printed, so bugs hidden by a filter no longer pad out the assignee
  and last-activity columns.
- `list` no longer fails with `414 URI Too Long` on components with many meta
  bugs. Meta-bug children are now fetched in batches instead of as a single
  request with every child id in the URL.

## v2.4.0 — 2026-10-19

### Changed
- `triage` now lists the bugs that need a priority or severity instead of
  immediately prompting. Pass `--interactive` (`-i`) for the previous
  step-through behavior.

## v2.3.0 — 2026-08-10

### Added
- `track` opens an interactive picker when the component is omitted. The list
  of products and components comes from the Bugzilla API (`/rest/product`),
  is filtered as you type, and is cached for a week beside the config file.
  `track <product>` narrows it to one product and `track --delete` picks from
  the saved components instead.
- `--confidential` flag (alias `--security`) for `list`, showing only confidential
  bugs restricted to a security group. Meta bugs with no confidential children are
  hidden from the tree view.

### Fixed
- Bug-id hyperlinks no longer drop on the line following a summary that soft-wraps;
  each link now carries a unique OSC 8 `id` so terminals stop mis-associating them.

## v2.2.0 — 2026-05-18

### Changed
- "See Open Bugs" link now reflects active CLI filters (priority, severity, assignee)

## v2.0.0

### Added
- `--active` flag to group bugs by assignee activity
- Color coding for security bugs
- Shorter formatting for severity values

### Changed
- Adjusted output view layout
- Shortened assignee display

## v1.0.0

### Added
- `list` subcommand with filters for priority, severity, assignee, and component
- `triage` subcommand with keyboard navigation, dry-run mode, and meta-bug skipping
- Sorting support with flat list rendering
- Fuzzy component and assignee matching via Levenshtein distance
- Ability to file a new bug from the CLI
- Publish script
