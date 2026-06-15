# 客户端发布与升级逻辑

## 目标

MD-Browser 客户端最终面向团队成员分发。客户端只负责承载本地配置中心、启动本机浏览器、读取/写入本机配置和连接本机 Mihomo；账号登录态、节点订阅和本机配置都留在每个人自己的电脑上。

## 发布包类型

当前主打包线已经切到 Tauri：

- 本地调试 / 内测打包：`npm run package:mac`

当前 `package:mac` 会输出 Tauri 的 `.app` 和 `.dmg`，用于本机验证或团队内测。

## 当前内测构建

- 版本：`1.0.2`
- 架构：Apple Silicon / arm64，适用于 M 系列 Mac
- 本地安装包：`~/Downloads/MD-Browser_1.0.2_aarch64.dmg`
- SHA-256：`f61fe59fe85782fb6f4e9b0ec3cab7174a44b1274e49ee5c7d63314d81fee548`
- 构建时间：`2026-06-15 11:34 CST`
- 签名状态：未签名、未公证，仅适合本机或内部临时验证
- 已验证：测试通过；打包后需验证 DMG 校验和本地 `/api/status` 版本。
- 正式签名前置检查：`2026-06-12 15:00 CST` 已执行，当前缺少 `Developer ID Application` 证书和 Apple 公证凭据

这个构建包含内置 Mihomo 的“一键安装并启用”、填写订阅后自动保存设置并切换为内置后端、优先选择普通 `darwin-arm64` Mihomo 二进制、旧配置迁移前备份、节点页代理后端状态、设置页版本信息卡片、团队配置导入导出、发布清单生成、客户端检查更新和脱敏排障包导出等当前内测功能。

## 内测包安装方式

当前 `package:mac` 输出的是未签名、未公证的 Tauri 包，适合产品验证，不适合作为长期团队正式分发包。

面向团队成员的简版说明见：[MD-Browser 团队内测安装与首次配置](team-install-guide.md)。

安装步骤：

1. 打开 `~/Downloads/MD-Browser_1.0.2_aarch64.dmg`。
2. 把 `MD-Browser.app` 拖到 `/Applications`。
3. 如果 macOS 提示无法打开，先用访达右键 `MD-Browser.app` 选择“打开”。
4. 如果仍被 Gatekeeper 拦截，内测阶段可以执行：

```bash
xattr -dr com.apple.quarantine /Applications/MD-Browser.app
open /Applications/MD-Browser.app
```

这一步只用于未签名内测包。正式签名和公证包不应要求用户执行 `xattr`。

## Apple 签名和公证前置条件

正式分发前需要准备：

- Apple Developer Program 账号
- `Developer ID Application` 证书，安装到打包机器钥匙串
- Xcode command line tools
- Notarization 凭据，推荐使用 App Store Connect API Key
- 稳定的 `appId`：当前是 `com.local.md-browser`，正式发布前建议改成公司域名反写格式

推荐环境变量：

```bash
export APPLE_API_KEY=/absolute/path/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export APPLE_TEAM_ID=XXXXXXXXXX
```

如果使用 Apple ID 方式：

```bash
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
```

## 正式发布流程

1. 更新版本号。

```bash
npm version patch
```

2. 跑测试。

```bash
npm test
```

3. 生成 Apple Silicon 安装包。

```bash
npm run package:mac
```

当前仓库已经切到 Tauri 桌面壳，后续 Apple 签名、公证和 Gatekeeper 校验也会基于 Tauri 产物补齐，不再走 Electron Builder。

4. 分发：

```text
src-tauri/target/release/bundle/dmg/MD-Browser_<version>_aarch64.dmg
```

5. 生成版本清单。

```bash
MD_BROWSER_RELEASE_BASE_URL=https://example.com/downloads \
MD_BROWSER_RELEASE_MANIFEST_COPY=~/Downloads/MD-Browser-latest-mac-arm64.json \
MD_BROWSER_RELEASE_NOTES='优化节点绑定|修复启动日志' \
npm run release:manifest
```

如果希望一次性把 manifest、发布说明和发布摘要都准备好，直接执行：

```bash
MD_BROWSER_RELEASE_BASE_URL=https://example.com/downloads \
npm run release:prepare
```

会额外生成：

```text
dist/release-notes-v<version>.md
dist/release-summary-v<version>.json
```

默认会读取当前版本的 Tauri 安装包，生成：

```text
dist/latest-mac-arm64.json
```

桌面构建现在会额外生成 Tauri updater 产物：

```text
dist-tauri/latest.json
```

可以通过 `MD_BROWSER_RELEASE_ARTIFACT` 显式指定要发布的 `.dmg` 文件。清单里包含版本号、渠道、文件名、下载地址、文件大小和 SHA-256；`dist-tauri/latest.json` 用于桌面客户端原生更新。

## 客户端升级策略

### 阶段 1：首次安装

首次分发仍然使用 `.dmg`。

- 团队成员下载新版 `.dmg`
- 拖动覆盖 `/Applications/MD-Browser.app`
- 本机配置保存在 `~/.md-browser/config.json`
- 旧版本的 `~/.tk-browser-router/config.json` 会在首次启动时自动迁移到新路径，并在旧目录生成 `config.legacy-backup.<时间>.json`
- Chrome 登录态继续保存在用户选择的 `user-data-dir`
- 升级 App 不覆盖任何登录态和本机配置

适合团队第一次安装客户端。

### 阶段 2：客户端内直接升级

客户端启动时读取一个远端版本文件。当前兼容两种格式：

- Tauri 原生更新清单：`latest.json`
- 兼容旧版 DMG 发布清单：`latest-mac-arm64.json`

Tauri `latest.json` 示例：

```json
{
  "version": "1.0.2",
  "notes": "优化节点绑定\n修复启动日志",
  "pub_date": "2026-06-14T09:30:00.000Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://example.com/MD-Browser.app.tar.gz",
      "signature": "..."
    }
  }
}
```

如果远端版本高于本地版本，客户端会在“设置”的版本信息卡片里提示“发现新版本”，并在桌面 App 内提供“下载并安装”按钮。安装完成后客户端自动重启进入新版本。

`v1.1.0` 已实现这个阶段：

- `GET /api/update-check`：读取 release manifest，判断是否有新版。
- “检查更新”按钮：在页面运行日志里显示结果，并在桌面 App 内直接调用原生 updater。
- 发布时必须同时上传 `.dmg`、`.app.tar.gz`、`.app.tar.gz.sig` 和 `latest.json`。

## 排障包策略

`v1.0.2` 起，设置页支持导出排障包。排障包用于团队成员遇到问题时发给负责人定位，不需要用户打开本机配置文件。

排障包包含：

- 当前 App 版本和生成时间
- 诊断路径摘要
- 浏览器配置状态摘要
- 代理入口和 CDP 监听状态
- 节点是否仍存在
- 最近运行日志

排障包不包含：

- Cookie
- 浏览器登录态
- 完整账号资料目录
- Mihomo secret 明文
- 内置订阅地址明文

### 阶段 3：稳定分发

功能继续稳定后，再补这些增强项：

- 发布渠道分成 `latest` 和 `beta`
- 更新元数据与安装包放在 GitHub Releases、S3、OSS 或公司内部分发域名
- 每次发布都必须签名、公证、staple
- 更新下载失败重试
- 更新前提醒用户关闭正在运行的浏览器任务
- 失败回滚到旧版本

## 配置兼容策略

配置文件必须带版本号。当前 `config.json` 已有：

```json
{
  "version": 1
}
```

后续每次配置结构变化都走迁移逻辑：

- App 启动时读取配置版本
- 低版本配置自动迁移到当前版本
- 迁移前备份一份，例如 `config.legacy-backup.20260612151000.json`
- 迁移失败时继续使用原配置，并提示用户

不要在升级 App 时删除或重建用户配置。

## 推荐版本节奏

- 具体版本拆分见项目根目录的 [Roadmap](../ROADMAP.md)
- 更新记录见项目根目录的 [Changelog](../CHANGELOG.md)
- `0.x`：内部测试，允许快速迭代 UI 和字段
- `1.0`：配置结构稳定，团队可正式使用
- `1.x`：只做兼容升级，不破坏旧配置
- `2.0`：如需破坏性配置变更，必须提供迁移和回滚方案
