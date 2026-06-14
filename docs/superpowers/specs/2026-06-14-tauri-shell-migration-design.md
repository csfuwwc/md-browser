# MD-Browser Tauri Shell Migration Design

## Summary

This design migrates the desktop shell from Electron to Tauri while preserving the existing local Node control plane, MCP endpoint, browser launch logic, Mihomo integration, and current WebUI behavior. The immediate goal is to reduce desktop package size and improve macOS distribution ergonomics without changing the public local API surface or agent integration contract.

The migration is intentionally narrow in scope. The Node service remains the source of truth for configuration, browser orchestration, proxy routing, and MCP. Tauri replaces Electron only as the desktop window host and local process supervisor.

## Goals

- Replace the Electron desktop shell with a Tauri desktop shell.
- Keep the existing Node service (`src/server.js`) and MCP server behavior intact.
- Bundle a Node runtime inside the macOS app so end users do not need Node installed locally.
- Keep the existing WebUI (`web/*`) with minimal behavioral changes.
- Use Tauri dev mode against the current local service and WebUI during development.
- Use embedded static UI assets in production, with the UI still calling the local Node API at `127.0.0.1:18777`.

## Non-Goals

- Rewriting the Node control plane in Rust.
- Replacing the MCP implementation with a Rust-native MCP service.
- Reworking browser launch semantics, Mihomo behavior, route storage, or the current HTTP API contract.
- Replacing the current UI architecture or redesigning pages as part of this migration.

## Current State

The current app uses:

- Electron shell: `electron/main.cjs`
- Node service: `src/server.js`
- MCP stdio server: `mcp/md-browser-mcp.js`
- WebUI: `web/index.html`, `web/app.js`, `web/styles.css`

The Electron app loads the local service URL and depends on the same Node logic that powers CLI, MCP, browser control, settings, and proxy integration. Package size is dominated by Electron’s embedded Chromium runtime rather than product code.

## Target Architecture

### 1. Tauri Desktop Shell

Tauri becomes the new desktop application host for macOS. It is responsible for:

- Opening and managing the desktop window
- Launching the bundled Node runtime and local service process
- Waiting for local service readiness
- Loading the correct UI source in development and production
- Stopping the child service process on app exit

Tauri does not become the source of truth for browser routes or proxy behavior in this phase.

### 2. Bundled Node Runtime

The production app bundles a private Node runtime inside the app package. Tauri starts this runtime and executes the local MD-Browser service entrypoint.

The bundled runtime must:

- Be local to the app bundle
- Not depend on system-installed Node
- Be resolved through app-relative paths at runtime
- Be treated as internal implementation detail, not a user-managed dependency

### 3. Local Node Control Plane

The existing service remains in place and continues to provide:

- `GET /api/*` and `POST /api/*`
- `http://127.0.0.1:18777/mcp`
- browser route CRUD and launch
- Mihomo integration
- config persistence
- diagnostics, logs, support bundle, updates, and release checks

This keeps Codex / Agent integration stable during shell migration.

### 4. Web UI

The existing UI remains in `web/*`.

Development mode:

- Tauri window loads `http://127.0.0.1:18777`

Production mode:

- Tauri loads embedded static UI assets
- The embedded UI continues to call the local Node API at `127.0.0.1:18777`

This preserves current frontend logic while decoupling first paint from the service owning the HTML entrypoint.

## Runtime Modes

### Development Mode

Purpose: preserve fast frontend and service iteration.

Behavior:

- Developer starts the existing Node service as today
- Tauri runs as a shell pointing at `http://127.0.0.1:18777`
- UI changes remain in `web/*`
- No bundled Node runtime is required for local development

### Production Mode

Purpose: produce a lean macOS app that does not depend on Electron or system Node.

Behavior:

- Tauri app starts
- Tauri resolves bundled Node runtime path and bundled MD-Browser service path
- Tauri launches the Node child process
- Tauri waits for service readiness on `127.0.0.1:18777`
- Tauri loads embedded static UI assets
- UI calls the running local API service

## Packaging Design

### Included in Tauri Package

- Tauri shell
- bundled Node runtime for Apple Silicon macOS
- packaged Node service code and required runtime files
- frontend static assets derived from `web/*`
- current icon assets and app metadata

### Excluded from Tauri Package

- Electron runtime and Electron packaging scripts after final migration cleanup
- development-only packaging helpers not needed by Tauri release flow

### Distribution Strategy

Initial Tauri release can still use the same internal unsigned distribution model if Apple signing is not ready. The difference is that the desktop shell becomes much smaller and no longer depends on Electron’s Chromium bundle.

## Process Supervision

Tauri must treat the Node service as a managed child process.

Required behavior:

- start once per app launch
- avoid duplicate service instances for the same app launch
- detect readiness by polling the existing local service health/status endpoint
- expose a clear startup timeout path
- terminate the child process on app exit
- prevent orphaned service processes on normal shutdown

Failure to start the service must not leave the desktop window in a blank or broken state.

## Startup and Error Handling

The migration needs a minimal shell startup state model:

- `starting`: shell is launching the local service
- `ready`: UI is available and local API is reachable
- `failed`: service could not start or become healthy in time

On failure, the user should see a local startup error screen with:

- short explanation
- retry action
- diagnostics entrypoint or log location hint

The UI should not silently fail into a blank page.

## API Compatibility

The migration must preserve:

- existing `/api/*` paths
- `/mcp`
- current local service port behavior unless explicitly configured otherwise
- current configuration paths and migration behavior

This is mandatory so existing Codex usage, settings UI, startup guidance, and release checks continue to work without retraining users.

## MCP Compatibility

MCP behavior must remain unchanged in this phase.

That means:

- same enable/disable switch semantics
- same local `/mcp` URL
- same agent-facing route operations
- same internal Node implementation for now

The shell migration must be invisible to external agents.

## File and Component Changes

### New

- `src-tauri/` project
- Tauri config
- Rust process supervisor for bundled Node runtime
- production static asset build path for `web/*`
- packaging helpers for bundled Node runtime placement

### Existing files expected to remain central

- `src/server.js`
- `src/config.js`
- `src/chrome.js`
- `src/mihomo.js`
- `src/embedded-mihomo.js`
- `mcp/md-browser-mcp.js`
- `web/index.html`
- `web/app.js`
- `web/styles.css`

### Existing files likely to be retired later

- `electron/main.cjs`
- Electron-specific package scripts and release flow, after Tauri release parity is proven

## Testing Strategy

### Must Verify

1. Tauri dev shell can open current local service UI
2. Tauri production app can launch bundled Node service
3. production UI can call local API successfully
4. MCP remains reachable at the same URL
5. browser route launch still works
6. external proxy and embedded Mihomo settings still work
7. update check, changelog, support bundle, and logs still function
8. macOS app quit cleans up the child service process

### Validation Types

- existing Node test suite remains green
- shell startup smoke test in dev mode
- production package install/run smoke test on Apple Silicon macOS
- manual MCP connectivity verification from Codex

## Migration Sequence

1. Scaffold Tauri app without removing Electron.
2. Make Tauri dev mode open the existing local service.
3. Add a Rust-side process supervisor for the local Node service.
4. Bundle a private Node runtime into the app.
5. Add production static asset loading for `web/*`.
6. Switch production shell to embedded static UI plus local API.
7. Validate API, MCP, browser launch, proxy, and settings flows.
8. Remove Electron packaging only after Tauri parity is verified.

## Risks and Mitigations

### Risk: bundled Node path resolution breaks after packaging

Mitigation:

- centralize runtime path resolution in one Tauri-side component
- test both dev and packaged app path variants

### Risk: child process orphaning on exit

Mitigation:

- explicit shutdown handling in Tauri lifecycle hooks
- kill-on-exit fallback for normal app close

### Risk: blank screen during service startup

Mitigation:

- shell-controlled startup state
- explicit retry path and error UI

### Risk: MCP regression from startup order changes

Mitigation:

- preserve current port and route handling
- verify `/mcp` after Tauri startup in both dev and production

## Decision Summary

- Shell migration only, no Rust rewrite of business logic
- Bundled Node runtime, no dependency on system Node
- Dev mode uses local service URL
- Production mode uses embedded static UI assets plus local local API
- MCP contract remains unchanged

This is the narrowest migration that solves package size and shell distribution problems without destabilizing the browser routing product logic already in use.
