# MD-Browser

[English](README.md) | [简体中文](README.zh-CN.md)

MD-Browser 是一个本地浏览器配置与代理路由管理器。它提供 WebUI、macOS 桌面壳、本地 HTTP API 和 MCP 入口，用来管理隔离的 Chromium 用户资料、CDP 端口、代理监听端口和节点绑定，同时不碰系统默认浏览器资料。

## 它能做什么

- 创建具名浏览器配置，支持独立 `user-data-dir`、Chrome Profile、CDP 端口、代理入口端口和可选启动网址。
- 启动或重连到匹配的 Chromium 实例，并通过 CDP 进行后续控制。
- 通过外部 Mihomo 兼容客户端或内置 Mihomo Core，把每条浏览器配置绑定到具体节点。
- 通过 HTTP 与 MCP 把同一份本地配置暴露给 Agent，让自动化按正确配置启动或连接浏览器。
- 保护系统默认 Chrome 资料，不接管无关浏览器进程。

## 架构

MD-Browser 把职责拆成四层：

- 浏览器配置管理：路线记录、资料目录、CDP 端口、启动网址和归属校验。
- 代理路由：通过外部或内置 Mihomo 分配监听端口并绑定节点。
- 本地控制面：运行在 `http://127.0.0.1:18777` 的 WebUI 与 REST 接口。
- Agent 集成：MCP stdio 和 HTTP API，提供配置查询、启动、打开网址和节点测速能力。

本地配置保存在：

```text
~/.md-browser/config.json
```

托管的浏览器身份目录和内置代理资源保存在：

```text
~/Library/Application Support/MD-Browser/
```

旧的 `~/.tk-browser-router/config.json` 会在首次启动时自动迁移，并在原路径留下备份。

## 快速开始

### 启动 WebUI

```bash
git clone https://github.com/csfuwwc/md-browser.git
cd md-browser
npm install
npm start
```

打开：

```text
http://127.0.0.1:18777
```

### 运行测试

```bash
npm test
```

### 启动 MCP 服务

```bash
npm run mcp
```

## 构建 macOS 客户端

执行：

```bash
npm run package:mac
```

构建产物：

```text
src-tauri/target/release/bundle/macos/MD-Browser.app
src-tauri/target/release/bundle/dmg/MD-Browser_<version>_aarch64.dmg
```

安装时先把 `MD-Browser.app` 拖到 `/Applications`。

如果首次打开时 macOS 提示“`MD-Browser` 已损坏，无法打开。你应该将它移到废纸篓”，可执行：

```bash
xattr -dr com.apple.quarantine /Applications/MD-Browser.app
open /Applications/MD-Browser.app
```

生成发布清单：

```bash
MD_BROWSER_RELEASE_MANIFEST_COPY=~/Downloads/MD-Browser-latest-mac-arm64.json npm run release:manifest
```

准备完整发布产物：

```bash
npm run package:mac
MD_BROWSER_RELEASE_BASE_URL=https://github.com/csfuwwc/md-browser/releases/latest/download \
npm run release:prepare
```

生成原生更新签名密钥：

```bash
npm run tauri:signer:generate
```

如果要发布支持客户端内直接升级的版本，打包前需要先注入签名私钥：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/md-browser.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run package:mac
MD_BROWSER_RELEASE_BASE_URL=https://github.com/csfuwwc/md-browser/releases/latest/download \
npm run release:prepare
```

更完整的打包与升级说明见 [docs/client-release-and-upgrade.md](docs/client-release-and-upgrade.md)。

## 代理后端

MD-Browser 支持两种代理模式：

- 外部 Mihomo 兼容客户端：
  通过本地控制 API 和 merge/runtime 配置文件读取节点、写入监听绑定。
- 内置 Mihomo：
  在 MD-Browser 应用支持目录下下载、配置并启动本地 Mihomo Core。

节点池页面只展示当前激活后端返回的节点。后端切换和配置都在系统设置页完成。

## Agent 集成

本地 HTTP API：

```text
GET  http://127.0.0.1:18777/api/agent/routes
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/launch
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/open-url
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/node-delay
```

当前 MCP 工具包括：

- `list_browser_configs`
- `get_browser_config`
- `launch_browser_config`
- `open_url_in_config`
- `test_config_node_delay`

Playwright 连接示例：

```js
const { chromium } = require("playwright");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
```

## 安全边界

- MD-Browser 不会通过团队共享或排障包导出浏览器登录态、Cookie 或原始本地资料内容。
- 排障包导出前会自动脱敏。
- 启动浏览器配置时拒绝使用系统默认 Chrome 资料。
- 针对浏览器配置的操作，会拒绝对不属于该配置的 CDP 端口执行动作。

## 文档

- [更新记录](CHANGELOG.md)
- [路线图](ROADMAP.md)
- [贡献说明](CONTRIBUTING.md)
- [安全说明](SECURITY.md)
- [团队安装指南](docs/team-install-guide.md)
- [客户端发布与升级说明](docs/client-release-and-upgrade.md)

## License

基于 [MIT License](LICENSE) 发布。
