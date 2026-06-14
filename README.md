# MD-Browser

[English](README.md) | [简体中文](README.zh-CN.md)

MD-Browser is a local browser configuration and proxy route manager. It provides a WebUI, a macOS desktop shell, a local HTTP API, and an MCP entrypoint for managing isolated Chromium profiles, CDP ports, proxy listener ports, and node bindings without touching the system default browser profile.

## What It Does

- Create named browser configurations with dedicated `user-data-dir`, Chrome profile, CDP port, proxy listener port, and optional start URL.
- Start or reconnect to the matching Chromium instance through the configured CDP endpoint.
- Bind each browser configuration to a concrete proxy node through an external Mihomo-compatible client or an embedded Mihomo core.
- Expose the same local configuration to agents through HTTP and MCP so automation can launch or connect to the correct browser instance.
- Protect the system default Chrome profile and refuse to take over unrelated browser processes.

## Architecture

MD-Browser separates responsibilities into four layers:

- Browser configuration management: route records, profile directories, CDP ports, start URLs, and ownership checks.
- Proxy routing: listener port allocation and node binding through external or embedded Mihomo.
- Local control plane: WebUI and REST endpoints on `http://127.0.0.1:18777`.
- Agent integration: MCP stdio and HTTP APIs for configuration lookup, launch, URL open, and node delay checks.

Local state is stored in:

```text
~/.md-browser/config.json
```

Managed browser identities and embedded proxy assets are stored under:

```text
~/Library/Application Support/MD-Browser/
```

Legacy `~/.tk-browser-router/config.json` data is migrated automatically on first run and backed up in place.

## Quick Start

### Run the WebUI

```bash
git clone https://github.com/csfuwwc/md-browser.git
cd md-browser
npm install
npm start
```

Open:

```text
http://127.0.0.1:18777
```

### Run Tests

```bash
npm test
```

### Run the MCP Server

```bash
npm run mcp
```

## Build the macOS App

Build the Tauri macOS app:

```bash
npm run package:mac
```

Build output:

```text
src-tauri/target/release/bundle/macos/MD-Browser.app
src-tauri/target/release/bundle/dmg/MD-Browser_<version>_aarch64.dmg
```

Install by dragging `MD-Browser.app` into `/Applications`.

If macOS shows a message such as `"MD-Browser" is damaged and can't be opened. You should move it to the Trash.` on first launch of an unsigned internal build, remove the quarantine flag and reopen the app:

```bash
xattr -dr com.apple.quarantine /Applications/MD-Browser.app
open /Applications/MD-Browser.app
```

Release manifest generation:

```bash
MD_BROWSER_RELEASE_MANIFEST_COPY=~/Downloads/MD-Browser-latest-mac-arm64.json npm run release:manifest
```

Release bundle preparation:

```bash
npm run package:mac
MD_BROWSER_RELEASE_BASE_URL=https://github.com/csfuwwc/md-browser/releases/latest/download \
npm run release:prepare
```

More packaging and upgrade notes live in [docs/client-release-and-upgrade.md](docs/client-release-and-upgrade.md).

## Proxy Backends

MD-Browser supports two proxy routing modes:

- External Mihomo-compatible client:
  Reads node data and writes listener bindings through a local controller API and merge/runtime config files.
- Embedded Mihomo:
  Downloads, configures, and starts a local Mihomo core under the MD-Browser application support directory.

The node pool page only displays nodes returned by the active backend. Backend setup and switching happen in settings.

## Agent Integration

Local HTTP API:

```text
GET  http://127.0.0.1:18777/api/agent/routes
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/launch
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/open-url
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/node-delay
```

MCP tools currently include:

- `list_browser_configs`
- `get_browser_config`
- `launch_browser_config`
- `open_url_in_config`
- `test_config_node_delay`

Example Playwright connection:

```js
const { chromium } = require("playwright");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
```

## Security Model

- MD-Browser does not export browser login state, cookies, or raw local profile contents through team sharing or support bundles.
- Support bundles are sanitized before export.
- Route startup refuses to use the system default Chrome profile.
- Route actions refuse to operate on a CDP port that belongs to another browser identity.

## Docs

- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Team install guide](docs/team-install-guide.md)
- [Client release and upgrade notes](docs/client-release-and-upgrade.md)

## License

Released under the [MIT License](LICENSE).
