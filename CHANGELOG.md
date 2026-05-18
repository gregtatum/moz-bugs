# Changelog

## v2.1.0 — 2026-05-18

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
