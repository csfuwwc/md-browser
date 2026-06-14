# Tauri Shell Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron desktop shell with a Tauri shell while preserving the existing local Node service, MCP endpoint, WebUI behavior, and browser/proxy control plane.

**Architecture:** Tauri becomes a thin desktop host that manages one bundled Node runtime and one child MD-Browser service process. Development keeps loading the existing local service URL; production loads embedded static UI assets while continuing to call the local API on `127.0.0.1:18777`.

**Tech Stack:** Tauri 2, Rust, bundled Node runtime, existing Node service, existing web assets, npm scripts.

---

### Task 1: Add Tauri project skeleton and configuration

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/tauri.conf.json`
- Modify: `package.json`

- [ ] **Step 1: Add Tauri dependencies and scripts**

Update `package.json` to add Tauri dev/build scripts and required dev dependencies.

- [ ] **Step 2: Create minimal Rust crate metadata**

Add `src-tauri/Cargo.toml` with app metadata, Tauri dependencies, serde, and process/runtime helpers.

- [ ] **Step 3: Add Tauri config**

Create `src-tauri/tauri.conf.json` with:
- product name `MD-Browser`
- bundle target `dmg` and `app`
- Apple Silicon target assumptions
- dev URL pointing at `http://127.0.0.1:18777`
- production frontend dist directory pointing at generated static web assets

- [ ] **Step 4: Add minimal Rust entrypoint**

Create `src-tauri/src/main.rs` with a compilable shell app that can open a window.

- [ ] **Step 5: Add build script**

Create `src-tauri/build.rs` using standard Tauri build setup.

### Task 2: Introduce production web asset build for Tauri

**Files:**
- Create: `scripts/build_tauri_web.cjs`
- Modify: `package.json`
- Reuse: `web/index.html`
- Reuse: `web/app.js`
- Reuse: `web/styles.css`

- [ ] **Step 1: Create static asset staging script**

Add `scripts/build_tauri_web.cjs` to copy the current `web/` assets into a dedicated Tauri dist directory such as `dist-tauri/web`.

- [ ] **Step 2: Ensure production entrypoint is valid**

Make sure the copied production HTML can be loaded from Tauri assets and still call the local API using absolute `http://127.0.0.1:18777` endpoints where needed.

- [ ] **Step 3: Add npm helper scripts**

Add scripts for:
- `tauri:web`
- `tauri:dev`
- `tauri:build`

### Task 3: Add Tauri-side Node service supervisor

**Files:**
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/service.rs` or keep logic in `main.rs`
- Reuse: `src/server.js`
- Reuse: `src/config.js`

- [ ] **Step 1: Mirror existing Electron startup contract**

Use the current Electron shell behavior as the functional baseline:
- start local service
- tolerate reuse when an existing MD-Browser service is already running
- wait for service readiness
- show startup failure clearly

- [ ] **Step 2: Add bundled Node/runtime path resolution**

Implement dev vs production path logic:
- dev: use current workspace Node and service source tree
- prod: use bundled Node runtime and bundled service files in app resources

- [ ] **Step 3: Spawn and track child process**

Add Rust logic to spawn the service process, store child handle, and prevent duplicate launch during one app lifetime.

- [ ] **Step 4: Wait for readiness**

Poll `http://127.0.0.1:18777/api/status` and verify `productName === "MD-Browser"` before considering startup complete.

- [ ] **Step 5: Shutdown cleanup**

Terminate the child service process when the Tauri app exits.

### Task 4: Bundle Node runtime and service resources for production

**Files:**
- Create: `scripts/prepare_tauri_bundle.cjs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`

- [ ] **Step 1: Choose bundle layout**

Bundle these under Tauri resources:
- a private Node runtime
- app service files needed to run `src/server.js`
- `mcp/`
- `src/`
- `config/`
- minimal package metadata

- [ ] **Step 2: Add preparation script**

Create `scripts/prepare_tauri_bundle.cjs` to stage the Node runtime and required service files into a deterministic bundle directory before `tauri build`.

- [ ] **Step 3: Register resources in Tauri config**

Point Tauri bundle resources to the prepared directory.

### Task 5: Provide shell-side loading strategy for dev and production

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Development shell loads localhost**

Confirm dev shell points to the existing local service URL for current workflow continuity.

- [ ] **Step 2: Production shell loads embedded static assets**

Make the production window load the staged static HTML bundle rather than asking the Node service for HTML.

- [ ] **Step 3: Keep API contract stable**

Ensure the embedded frontend continues to use the same local API and MCP URLs.

### Task 6: Preserve diagnostics and release workflow

**Files:**
- Modify: `README.md`
- Modify: `docs/client-release-and-upgrade.md`
- Modify: `docs/team-install-guide.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document new dev/build commands**

Add Tauri dev/build usage and describe the coexistence period with Electron scripts.

- [ ] **Step 2: Document production packaging behavior**

Explain that Tauri bundles a private Node runtime and still serves the same local API/MCP endpoints.

- [ ] **Step 3: Update release notes**

Record the shell migration stage and any changed packaging expectations.

### Task 7: Verification

**Files:**
- Reuse: `tests/*.test.js`
- Potentially create: `tests/tauri-shell-smoke.md` or small helper docs if needed

- [ ] **Step 1: Run Node test suite**

Run: `npm test`
Expected: existing Node tests pass unchanged.

- [ ] **Step 2: Validate Tauri config/build integrity**

Run a Tauri build validation command or a full `tauri build` if environment permits.

- [ ] **Step 3: Smoke test dev shell**

Open Tauri dev shell against the local service and confirm the main window loads.

- [ ] **Step 4: Smoke test production package**

Build the Tauri macOS app and confirm:
- window opens
- local API is reachable
- settings page loads
- `/mcp` still resolves through the local service

- [ ] **Step 5: Record known gaps**

If Electron remains temporarily present, explicitly note that final Electron script removal is deferred until Tauri parity is confirmed.
