import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildChromeArgs,
  buildForegroundChromeWindowScript,
  browserIdentityUrl,
  assertRoutePortOwner,
  bringCdpPageToFront,
  closeCdpBrowser,
  expandHome,
  fetchRoutePageTargets,
  fetchRouteWindowTitles,
  listChromiumBrowserCandidates,
  listImportableUserDataRootCandidates,
  launchRoute,
  normalizeTargetUrl,
  openUrlInCdp,
  listProfiles,
  listProfileDirectories,
  listUserDataDirs,
  listUserDataDirsForRoots,
  profileDir,
  userDataDir,
  userDataDirName,
  isRoutePortOwnedByUserDataDir
} from "../src/chrome.js";

test("expandHome replaces leading tilde", () => {
  assert.equal(
    expandHome("~/Library/Application Support/MD-Browser/Profiles", "/Users/example"),
    "/Users/example/Library/Application Support/MD-Browser/Profiles"
  );
});

test("buildChromeArgs includes CDP port profile and proxy", () => {
  const args = buildChromeArgs({
    cdpPort: 9222,
    profileDir: "/Users/example/Profile-A",
    profileDirectory: "Profile 1",
    proxyUrl: "http://127.0.0.1:18101"
  });
  assert.ok(args.includes("--remote-debugging-port=9222"));
  assert.ok(args.includes("--user-data-dir=/Users/example/Profile-A"));
  assert.ok(args.includes("--profile-directory=Profile 1"));
  assert.ok(args.includes("--proxy-server=http://127.0.0.1:18101"));
  assert.ok(args.includes("--new-window"));
});

test("buildChromeArgs opens Google when start URL is empty", () => {
  const args = buildChromeArgs({
    cdpPort: 9222,
    profileDir: "/Users/example/Profile-A",
    proxyUrl: "http://127.0.0.1:18101",
    startUrl: ""
  });

  assert.equal(args.at(-1), "https://www.google.com/");
});

test("buildChromeArgs can open identity page before target site", () => {
  const args = buildChromeArgs({
    cdpPort: 9222,
    profileDir: "/Users/example/Profile-A",
    proxyUrl: "http://127.0.0.1:18101",
    identityUrl: "http://127.0.0.1:18777/identity.html?route=tk-us",
    startUrl: "https://example.com/profile"
  });

  assert.equal(args.at(-2), "http://127.0.0.1:18777/identity.html?route=tk-us");
  assert.equal(args.at(-1), "https://example.com/profile");
});

test("normalizeTargetUrl accepts domains and empty values", () => {
  assert.equal(normalizeTargetUrl("example.com"), "https://example.com/");
  assert.equal(normalizeTargetUrl("https://example.com/profileprofile"), "https://example.com/profileprofile");
  assert.equal(normalizeTargetUrl(""), "https://www.google.com/");
});

test("openUrlInCdp opens a new tab through Chrome debugging endpoint", async () => {
  const calls = [];
  const result = await openUrlInCdp(9222, "example.com", {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { id: "target-1", title: "Example Site", webSocketDebuggerUrl: "ws://127.0.0.1/page/1" };
        }
      };
    }
  });

  assert.equal(calls[0].url, "http://127.0.0.1:9222/json/new?https%3A%2F%2Fexample.com%2F");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(result.opened, true);
  assert.equal(result.targetId, "target-1");
});

test("browserIdentityUrl points at local identity page", () => {
  assert.equal(
    browserIdentityUrl({ server: { host: "127.0.0.1", port: 18777 } }, "tk us"),
    "http://127.0.0.1:18777/identity.html?route=tk%20us"
  );
});

test("launchRoute reports CDP port owner when the port is occupied by a non-CDP process", async () => {
  await assert.rejects(
    launchRoute("test", {
      chromeAppName: "Google Chrome",
      server: { host: "127.0.0.1", port: 18777 },
      profileRoot: "~/Library/Application Support/MD-Browser/Profiles",
      routes: {
        test: {
          label: "Test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101"
        }
      }
    }, {
      isTcpListeningImpl: async () => true,
      fetchCdpVersionImpl: async () => null,
      inspectTcpPortImpl: async () => ({
        port: 9222,
        listening: true,
        processes: [{ pid: 1234, command: "Google Chrome", user: "localuser" }]
      })
    }),
    (error) => {
      assert.equal(error.code, "CDP_PORT_CONFLICT");
      assert.equal(error.port, 9222);
      assert.deepEqual(error.processes, [{ pid: 1234, command: "Google Chrome", user: "localuser" }]);
      assert.match(error.message, /端口 9222 已被占用/);
      return true;
    }
  );
});

test("launchRoute refuses to reuse a CDP port owned by another Chrome identity", async () => {
  await assert.rejects(
    launchRoute("test", {
      chromeAppName: "Google Chrome",
      server: { host: "127.0.0.1", port: 18777 },
      profileRoot: "~/Library/Application Support/MD-Browser/Profiles",
      routes: {
        test: {
          label: "Test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          userDataDir: "/Users/example/Library/Application Support/MD-Browser/Profiles/Test"
        }
      }
    }, {
      isTcpListeningImpl: async () => true,
      fetchCdpVersionImpl: async () => ({ Browser: "Chrome" }),
      inspectTcpPortImpl: async () => ({
        port: 9222,
        listening: true,
        processes: [{
          pid: 1234,
          command: "Google Chrome",
          user: "localuser",
          fullCommand: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/Google/Chrome"
        }]
      })
    }),
    /不是由这个浏览器配置启动/
  );
});

test("route port ownership requires the matching user data dir", () => {
  assert.equal(
    isRoutePortOwnedByUserDataDir({
      processes: [{
        fullCommand: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/MD-Browser/Profiles/Test"
      }]
    }, 9222, "/Users/example/Library/Application Support/MD-Browser/Profiles/Test"),
    true
  );
  assert.equal(
    isRoutePortOwnedByUserDataDir({
      processes: [{
        fullCommand: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/Google/Chrome"
      }]
    }, 9222, "/Users/example/Library/Application Support/MD-Browser/Profiles/Test"),
    false
  );
});

test("assertRoutePortOwner reports owner mismatch instead of operating on another browser", async () => {
  await assert.rejects(
    assertRoutePortOwner(
      { cdpPort: 9222 },
      "/Users/example/Library/Application Support/MD-Browser/Profiles/Test",
      async () => ({
        port: 9222,
        listening: true,
        processes: [{
          pid: 1234,
          command: "Google Chrome",
          fullCommand: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/Google/Chrome"
        }]
      })
    ),
    (error) => {
      assert.equal(error.code, "CDP_PORT_OWNER_MISMATCH");
      assert.equal(error.port, 9222);
      assert.match(error.message, /不会接管默认浏览器/);
      return true;
    }
  );
});

test("fetchRouteWindowTitles returns page target titles from CDP", async () => {
  const titles = await fetchRouteWindowTitles(9222, async (url) => {
    assert.equal(url, "http://127.0.0.1:9222/json/list");
    return {
      ok: true,
      async json() {
        return [
          { type: "page", title: "Example Site - Make Your Day" },
          { type: "other", title: "Ignored" },
          { type: "page", title: "Example Site - Make Your Day" },
          { type: "page", title: "  " }
        ];
      }
    };
  });

  assert.deepEqual(titles, ["Example Site - Make Your Day"]);
});

test("fetchRoutePageTargets returns page targets with debugger URLs", async () => {
  const targets = await fetchRoutePageTargets(9222, async () => ({
    ok: true,
    async json() {
      return [
        { type: "page", title: "Example Site", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/1" },
        { type: "browser", title: "Browser", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/1" }
      ];
    }
  }));

  assert.deepEqual(targets, [
    { type: "page", title: "Example Site", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/1" }
  ]);
});

test("bringCdpPageToFront sends Page.bringToFront", async () => {
  const sent = [];
  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }

    send(message) {
      sent.push(JSON.parse(message));
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: 1, result: {} }) }));
      });
    }

    close() {}
  }

  await bringCdpPageToFront("ws://127.0.0.1/devtools/page/1", FakeWebSocket);
  assert.deepEqual(sent, [{ id: 1, method: "Page.bringToFront" }]);
});

test("closeCdpBrowser sends Browser.close to browser websocket", async () => {
  const sent = [];
  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }

    send(message) {
      sent.push(JSON.parse(message));
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: 1, result: {} }) }));
      });
    }

    close() {}
  }

  const result = await closeCdpBrowser(9222, {
    fetchImpl: async (url) => {
      assert.equal(url, "http://127.0.0.1:9222/json/version");
      return {
        ok: true,
        async json() {
          return { webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/1" };
        }
      };
    },
    WebSocketImpl: FakeWebSocket
  });

  assert.deepEqual(sent, [{ id: 1, method: "Browser.close" }]);
  assert.deepEqual(result, { closed: true, cdpPort: 9222 });
});

test("buildForegroundChromeWindowScript matches Chrome window titles", () => {
  const script = buildForegroundChromeWindowScript(['Example Site "US"']);
  assert.match(script, /tell application "Google Chrome"/);
  assert.match(script, /set active tab index of chromeWindow/);
  assert.match(script, /Example Site \\"US\\"/);
});

test("listProfiles returns profile directories sorted by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-profiles-"));
  try {
    mkdirSync(join(dir, "TK-TH"));
    mkdirSync(join(dir, "TK-US"));
    writeFileSync(join(dir, "not-a-profile.txt"), "ignore");

    assert.deepEqual(listProfiles(dir), ["TK-TH", "TK-US"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listUserDataDirs returns selectable directory entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-user-data-dirs-"));
  try {
    mkdirSync(join(dir, "TK-TH"));
    mkdirSync(join(dir, "TK-US"));
    writeFileSync(join(dir, "not-a-user-data-dir.txt"), "ignore");

    assert.deepEqual(listUserDataDirs(dir), [
      { name: "TK-TH", path: join(dir, "TK-TH"), profileDirectories: ["Default"] },
      { name: "TK-US", path: join(dir, "TK-US"), profileDirectories: ["Default"] }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listProfileDirectories returns Chrome profile directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-chrome-user-data-"));
  try {
    mkdirSync(join(dir, "Default"));
    mkdirSync(join(dir, "Profile 2"));
    mkdirSync(join(dir, "Crashpad"));
    mkdirSync(join(dir, "System Profile"));
    writeFileSync(join(dir, "Profile 2", "Preferences"), "{}");

    assert.deepEqual(listProfileDirectories(dir), ["Default", "Profile 2"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listUserDataDirsForRoots accepts a root pool or an exact user-data-dir", () => {
  const pool = mkdtempSync(join(tmpdir(), "tk-user-data-pool-"));
  const direct = mkdtempSync(join(tmpdir(), "tk-direct-user-data-"));
  try {
    mkdirSync(join(pool, "TK-US"));
    mkdirSync(join(direct, "Default"));
    writeFileSync(join(direct, "Local State"), "{}");

    assert.deepEqual(
      listUserDataDirsForRoots([pool, direct]).map((entry) => ({
        name: entry.name,
        path: entry.path,
        label: entry.label,
        profileDirectories: entry.profileDirectories
      })),
      [
        {
          name: "TK-US",
          path: join(pool, "TK-US"),
          label: `${pool.split("/").at(-1)}/TK-US`,
          profileDirectories: ["Default"]
        },
        {
          name: direct.split("/").at(-1),
          path: direct,
          label: direct.split("/").at(-1),
          profileDirectories: ["Default"]
        }
      ]
    );
  } finally {
    rmSync(pool, { recursive: true, force: true });
    rmSync(direct, { recursive: true, force: true });
  }
});

test("listUserDataDirsForRoots labels managed MD-Browser profiles clearly", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-managed-label-"));
  const managedRoot = join(home, "Library/Application Support/MD-Browser/Profiles");
  try {
    mkdirSync(join(managedRoot, "TK-US", "Default"), { recursive: true });
    const entries = listUserDataDirsForRoots([managedRoot]);
    assert.equal(entries[0].rootLabel, "MD-Browser/Profiles");
    assert.equal(entries[0].label, "MD-Browser/Profiles/TK-US");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listUserDataDirsForRoots presents a neutral label for legacy managed profiles", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-legacy-managed-label-"));
  const managedRoot = join(home, "Library/Application Support/TK Browser Router/Profiles");
  try {
    mkdirSync(join(managedRoot, "TK-US", "Default"), { recursive: true });
    const entries = listUserDataDirsForRoots([managedRoot]);
    assert.equal(entries[0].rootLabel, "Legacy Managed Profiles");
    assert.equal(entries[0].label, "Legacy Managed Profiles/TK-US");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("userDataDir supports explicit directory while preserving legacy profileName fallback", () => {
  const config = { profileRoot: "/Users/example/LegacyProfiles" };

  assert.equal(
    userDataDir(config, { profileName: "TK-US" }),
    "/Users/example/LegacyProfiles/TK-US"
  );
  assert.equal(
    userDataDir(config, { profileName: "OLD", userDataDir: "/Users/example/Custom/TK-BR" }),
    "/Users/example/Custom/TK-BR"
  );
  assert.equal(
    userDataDirName(config, { profileName: "OLD", userDataDir: "/Users/example/Custom/TK-BR" }),
    "TK-BR"
  );
  assert.equal(
    profileDir(config, { profileName: "OLD", userDataDir: "/Users/example/Custom/TK-BR", profileDirectory: "Profile 2" }),
    "/Users/example/Custom/TK-BR/Profile 2"
  );
});

test("listImportableUserDataRootCandidates returns existing known roots with already-added state", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-import-roots-"));
  try {
    mkdirSync(join(home, "Library/Application Support/Google/Chrome"), { recursive: true });
    mkdirSync(join(home, "Library/Application Support/Google/TKCountryProfiles"), { recursive: true });

    const candidates = listImportableUserDataRootCandidates(
      ["~/Library/Application Support/Google/TKCountryProfiles"],
      home
    );

    assert.deepEqual(
      candidates.map((candidate) => ({
        path: candidate.path,
        alreadyAdded: candidate.alreadyAdded
      })),
      [
        {
          path: "~/Library/Application Support/Google/TKCountryProfiles",
          alreadyAdded: true
        },
        {
          path: "~/Library/Application Support/MD-Browser/Profiles",
          alreadyAdded: false
        }
      ]
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listUserDataDirsForRoots hides the system default Chrome profile from selectable identities", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-user-data-roots-"));
  try {
    const chromeRoot = join(home, "Library/Application Support/Google/Chrome");
    mkdirSync(join(chromeRoot, "Default"), { recursive: true });
    writeFileSync(join(chromeRoot, "Local State"), "{}");
    writeFileSync(join(chromeRoot, "Default/Preferences"), "{}");

    const dirs = listUserDataDirsForRoots([chromeRoot]);

    assert.deepEqual(dirs, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("launchRoute refuses the system default Chrome user data dir", async () => {
  await assert.rejects(
    launchRoute("test", {
      chromeAppName: "Google Chrome",
      routes: {
        test: {
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
          profileDirectory: "Default"
        }
      }
    }, {
      isTcpListeningImpl: async () => false,
      execFileImpl: async () => {
        throw new Error("should not launch default Chrome profile");
      }
    }),
    /不能使用系统默认 Chrome 资料目录/
  );
});

test("listImportableUserDataRootCandidates creates managed profile root", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-import-managed-"));
  try {
    const candidates = listImportableUserDataRootCandidates([], home);
    const managed = candidates.find((candidate) => candidate.kind === "managed");
    assert.ok(managed);
    assert.equal(managed.path, "~/Library/Application Support/MD-Browser/Profiles");
    assert.equal(managed.exists, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("listChromiumBrowserCandidates returns common CDP browser options", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-browser-candidates-"));
  try {
    const candidates = listChromiumBrowserCandidates(home);
    const names = candidates.map((candidate) => candidate.appName);
    assert.ok(names.includes("Google Chrome"));
    assert.ok(names.includes("Microsoft Edge"));
    assert.ok(candidates.every((candidate) => candidate.cdpSupported));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
