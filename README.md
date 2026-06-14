# MD-Browser

本工具把跨境团队原来的“手动切 Clash Verge 节点”改成“浏览器环境配置中心”。团队成员通过本地 WebUI 管理配置名称、CDP 端口、代理入口、`user-data-dir`、Chrome `profile-directory` 和 Mihomo 节点；Agent 只需要读取配置并连接对应 CDP 端口。

## 快速开始

### 构建和发布

```bash
npm test
npm run package:mac
MD_BROWSER_RELEASE_MANIFEST_COPY=/Users/liyanpeng/Downloads/MD-Browser-latest-mac-arm64.json npm run release:manifest
```

`release:manifest` 会读取 `dist/MD-Browser-0.1.0-arm64.dmg`，生成 `dist/latest-mac-arm64.json`。这份 JSON 用于后续客户端启动时检查是否有新版，也方便负责人核对下载包的 SHA-256。

### 使用 Mac 客户端内测包

当前内测安装包已经生成到：

```text
/Users/liyanpeng/Downloads/MD-Browser-0.1.0-arm64.dmg
```

SHA-256：

```text
774b202e63d39584a734d6f2ef1436f7872e867df7b9555788d80013ddde9c82
```

打开 `.dmg` 后把 `MD-Browser.app` 拖到 `/Applications`。当前包未签名、未公证，如果 macOS 提示无法打开，内测阶段可以用下面两种方式之一处理：

- 在访达里右键 `MD-Browser.app`，选择“打开”，再确认打开。
- 如果仍被拦截，在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/MD-Browser.app
open /Applications/MD-Browser.app
```

正式分发包会走 Apple Developer 签名和公证，届时不需要这一步。

给团队成员分发时，可以直接附上 [团队内测安装与首次配置指南](docs/team-install-guide.md)。

### 使用本地 WebUI 调试

```bash
cd tk-browser-node-routing
chmod +x scripts/*.sh
scripts/start_webui.sh
```

停止页面服务：

```bash
scripts/stop_webui.sh
```

打开：

```text
http://127.0.0.1:18777
```

WebUI 会显示并维护一组“浏览器环境配置”，每条配置至少包含：

| 配置名称 | Agent/CDP 端口 | 浏览器代理入口 | User Data Dir | Chrome Profile |
|---|---:|---:|---|---|
| TikTok US 主号 | 9222 | 18101 | `.../TK-US` | `Default` |
| TikTok Brazil 采集 | 9223 | 18102 | `.../TK-BR` | `Profile 1` |
| XHS 采集 | 9333 | 18333 | `.../Xiaohongshu` | `Default` |

注意：CDP 端口和代理入口端口在 WebUI 内会做防重校验。

## WebUI 能做什么

- 查看每条浏览器配置是否已启动
- 查看每个代理入口是否已监听
- 启动指定配置对应的浏览器
- 把 Chrome 窗口拉到前台
- 新增、编辑、删除浏览器配置
- 编辑 CDP 端口、代理入口、`user-data-dir`、Chrome `profile-directory` 和节点绑定
- 维护多个 `user-data-dir` 目录池，不写死 `TKCountryProfiles` 或 `SocialScraperProfiles`
- 选择外部代理客户端或内置 Mihomo
- 检测当前代理后端是否可用，并展示可绑定节点池

配置保存在每个人本机：

```text
~/.md-browser/config.json
```

旧版本的 `~/.tk-browser-router/config.json` 会在首次启动时自动迁移到新路径，并在旧目录生成一份 `config.legacy-backup.<时间>.json` 备份；旧文件本身也会保留。

浏览器资料目录也保存在每个人本机：

```text
~/Library/Application Support/Google/
```

团队共享工具包时，不会共享账号登录态。

设置页的“诊断信息”卡片会显示配置文件、脚本日志、内置 Mihomo Core 和内置配置路径，方便团队成员遇到问题时直接把关键信息发给负责人。

## 代理服务模式

WebUI 负责 Chrome、资料目录、CDP 端口、代理入口端口和状态显示；代理服务负责真正的网络节点。当前支持两种模式：

### 外部代理客户端

这是默认模式，适合已经在用 Clash Verge Rev 的同事。

设置页选择“外部代理客户端”，点击“选择客户端”后，MD-Browser 会检测本机 Clash Verge Rev，并读取：

- Mihomo `external-controller`
- Merge / 覆写配置路径
- 运行配置路径

首次配置时，如果本机还没有 listener，可以打开 `config/mihomo-listeners.example.yaml`，把里面的监听入口改成你本机真实使用的代理入口和节点名，然后复制到 Clash Verge 的 Merge / 覆写配置里。

保存后执行：

```text
保存覆写配置
重新启用当前订阅
重启 Clash / Mihomo 内核
```

后续只要 Mihomo API 可用，WebUI 可以直接把某条浏览器配置绑定到具体节点，不需要频繁手动改 Clash Verge YAML。

### 内置 Mihomo

内置模式适合后续把 MD-Browser 做成完整本地客户端时使用。

设置页选择“内置 Mihomo”后，流程是：

1. 填写代理订阅地址。
2. 点击“安装并启用”。

MD-Browser 会自动先保存当前设置，再从 MetaCubeX/mihomo 最新 release 下载适合当前 macOS 架构的 `.gz` 二进制，解压到：

```text
~/Library/Application Support/MD-Browser/bin/mihomo
```

随后生成内置 Mihomo 配置：

```text
~/Library/Application Support/MD-Browser/mihomo/config.yaml
```

最后按这份配置启动内置 Mihomo。

内置模式不会修改 Clash Verge 配置；切回外部模式后，仍然使用本机外部代理客户端。

### 节点页的定位

左侧“节点池”页面只展示当前代理后端返回的可绑定节点：

- 外部模式：读取外部 Clash Verge / Mihomo API
- 内置模式：读取内置 Mihomo API

订阅地址、一键安装启用、启动和停止都在“设置”页面完成，节点页不承担代理服务管理。

## Agent 如何连接

推荐让 Codex / Agent 通过 MD-Browser 的 Agent 通道读取配置，而不是自己猜端口。

本地 API：

```text
GET  http://127.0.0.1:18777/api/agent/routes
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/launch
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/open-url
POST http://127.0.0.1:18777/api/agent/routes/{routeKey}/node-delay
```

MCP stdio 服务：

```bash
npm run mcp
```

当前 MCP 工具包括：

- `list_browser_configs`
- `get_browser_config`
- `launch_browser_config`
- `open_url_in_config`
- `test_config_node_delay`

本机 Codex 个人插件入口是 `MD-Browser`。它读取同一个本地服务，不另外保存浏览器登录态或节点配置。

Agent 读取到配置后，仍然通过 CDP 端口连接浏览器。Playwright / Puppeteer 的底层连接方式如下：

```js
const { chromium } = require("playwright");

const tiktokUs = await chromium.connectOverCDP("http://127.0.0.1:9222");
const xhs = await chromium.connectOverCDP("http://127.0.0.1:9333");
```

## 本地 API 排障

不打开页面时，可以直接通过本地 Agent API 查看配置：

```bash
curl http://127.0.0.1:18777/api/agent/routes
```

启动某个浏览器配置：

```bash
curl -X POST http://127.0.0.1:18777/api/agent/routes/<routeKey>/launch
```

在指定配置里打开网站：

```bash
curl -X POST http://127.0.0.1:18777/api/agent/routes/<routeKey>/open-url \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.tiktok.com/"}'
```

这里的 `<routeKey>` 不再固定为某个国家，必须以 MD-Browser 里实际创建的浏览器配置为准。

## 常见问题

### 浏览器配置显示“不可用 / 代理离线”

说明 Chrome 已经启动，但对应的 Clash/Mihomo 代理入口还没有监听。需要检查对应 listener 是否已配置并重启内核。

### 浏览器里还是显示 7897

不要看 macOS 系统代理页面。打开该浏览器里的：

```text
chrome://version
```

看 `Command Line` 是否包含：

```text
--proxy-server=http://127.0.0.1:18101
```

如果不是，通常是旧 Chrome 进程或旧资料目录被复用了。用 WebUI 重新启动对应配置。

### 每个人节点名称不同

这是正常的。团队共享这个目录时，保留 WebUI 和脚本不变；每个人只改自己本机 Clash Verge / Mihomo 里的节点配置即可。
