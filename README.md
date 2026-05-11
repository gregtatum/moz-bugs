# moz-bugs

This tool is a CLI tool to help with managing a team's work on Bugzilla and Jira. The
integration between the two at Mozilla is managed by
[Jira Bugzilla Integration (JBI)](https://github.com/mozilla/jira-bugzilla-integration)
through the automation of [whiteboard tags](https://github.com/mozilla/jira-bugzilla-integration/blob/8ed45c355ca8c71e11cd28a1a4f7fa05a51972d9/config/config.prod.yaml#L830).
For instance, with the AI team there are:

 * `[aiplatform]` - AI Platform Team
 * `[aife]` - AI Frontend Team
 * `[aimodels]` - AI Models Team

When a bug is filed in Bugzilla and a whiteboard tag is added, the bug gets synced to
a Jira ticket. This allows for engineering work to be managed in Jira. The source of
truth is always Bugzilla as that's where the work happens.

There is no JBI integration for meta bugs. These bugs are a Bugzilla convention to
add `[meta]` to the start of a bug, and then block other bugs to that one. This creates
a heirarchy and is the Bugzilla way to organize epics of work.

## What this tool does

This tool is going to be a collection of utilities to automate some of the process for
adding whiteboard tags, tracking metabugs, and tracking work so that it all is reflected
in Jira correctly.

## Development

- `npm run ts` runs TypeScript against the JSDoc annotations.
