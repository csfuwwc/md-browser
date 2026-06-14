# Contributing

MD-Browser is a local browser configuration and proxy route manager. Contributions should preserve two core guarantees:

- Never reuse or modify the system default Chrome profile.
- Never take over a browser process that was not started by the matching MD-Browser configuration.

## Development

Requirements:

- Node.js 20+
- macOS for desktop packaging

Install and run tests:

```bash
npm install
npm test
```

Run the local WebUI:

```bash
npm start
```

Run the MCP server:

```bash
npm run mcp
```

## Change Guidelines

- Keep browser profile handling local-only. Do not add logic that exports login state, cookies, or raw subscription secrets.
- Keep route configuration generic. Avoid hard-coding business- or country-specific assumptions into defaults, labels, or templates.
- Preserve compatibility with older local config paths when practical, but keep public-facing labels neutral.
- Add or update tests for any behavior change in browser launch, proxy binding, config migration, or API responses.

## Release Notes

- Versioning and release history live in [CHANGELOG.md](CHANGELOG.md).
- Packaging and upgrade notes live in [docs/client-release-and-upgrade.md](docs/client-release-and-upgrade.md).
