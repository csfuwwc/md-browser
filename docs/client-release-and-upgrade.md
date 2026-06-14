# 客户端发布与升级逻辑

## 目标

MD-Browser 客户端最终面向团队成员分发。客户端只负责承载本地配置中心、启动本机浏览器、读取/写入本机配置和连接本机 Mihomo；账号登录态、节点订阅和本机配置都留在每个人自己的电脑上。

## 发布包类型

当前保留两条打包线：

- 本地调试包：`npm run package:mac`
- 正式签名包：`npm run package:mac:signed`

本地调试包不会签名，适合快速看产品效果。正式签名包会输出到 `dist-signed/`，用于发给同事安装。

## 当前内测构建

- 版本：`0.2.0`
- 架构：Apple Silicon / arm64，适用于 M 系列 Mac
- 本地安装包：`/Users/liyanpeng/Downloads/MD-Browser-0.2.0-arm64.dmg`
- SHA-256：`774b202e63d39584a734d6f2ef1436f7872e867df7b9555788d80013ddde9c82`
- 构建时间：`2026-06-12 15:36 CST`
- 签名状态：未签名、未公证，仅适合本机或内部临时验证
- 已验证：测试通过；打包后需验证 DMG 校验和本地 `/api/status` 版本。
- 正式签名前置检查：`2026-06-12 15:00 CST` 已执行，当前缺少 `Developer ID Application` 证书和 Apple 公证凭据

这个构建包含内置 Mihomo 的“一键安装并启用”、填写订阅后自动保存设置并切换为内置后端、优先选择普通 `darwin-arm64` Mihomo 二进制、旧配置迁移前备份、设置页诊断信息卡片、节点页代理后端状态、设置页版本显示、团队配置导入导出、发布清单生成等当前内测功能。

## 内测包安装方式

当前 `package:mac` 输出的是未签名、未公证包，适合产品验证，不适合作为长期团队正式分发包。

面向团队成员的简版说明见：[MD-Browser 团队内测安装与首次配置](team-install-guide.md)。

安装步骤：

1. 打开 `/Users/liyanpeng/Downloads/MD-Browser-0.2.0-arm64.dmg`。
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

3. 生成签名和公证后的 Apple Silicon 安装包。

```bash
npm run package:mac:signed
```

正式打包会先执行 preflight：检查 `Developer ID Application` 证书，以及 App Store Connect API Key 或 Apple ID 公证凭据。缺少任一项会提前失败，不会继续生成半成品。

4. 验证签名、公证和 Gatekeeper。

```bash
npm run verify:mac:signed
```

这个脚本会依次执行 `codesign --verify`、`xcrun stapler validate`、`spctl --assess` 和 `hdiutil verify`。

5. 分发 `dist-signed/*.dmg`。

6. 生成版本清单。

```bash
MD_BROWSER_RELEASE_BASE_URL=https://example.com/downloads \
MD_BROWSER_RELEASE_MANIFEST_COPY=/Users/liyanpeng/Downloads/MD-Browser-latest-mac-arm64.json \
MD_BROWSER_RELEASE_NOTES='优化节点绑定|修复启动日志' \
npm run release:manifest
```

默认会读取 `dist/MD-Browser-0.2.0-arm64.dmg`，生成：

```text
dist/latest-mac-arm64.json
```

如果使用正式签名包，可以通过 `MD_BROWSER_RELEASE_ARTIFACT` 指向 `dist-signed/` 下的 `.dmg`。清单里包含版本号、渠道、文件名、下载地址、文件大小和 SHA-256，后续客户端升级提醒会读取这份清单。

## 客户端升级策略

### 阶段 1：手动升级

这是当前最稳的方式。

- 团队成员下载新版 `.dmg`
- 拖动覆盖 `/Applications/MD-Browser.app`
- 本机配置保存在 `~/.md-browser/config.json`
- 旧版本的 `~/.tk-browser-router/config.json` 会在首次启动时自动迁移到新路径，并在旧目录生成 `config.legacy-backup.<时间>.json`
- Chrome 登录态继续保存在用户选择的 `user-data-dir`
- 升级 App 不覆盖任何登录态和本机配置

适合内测期，因为发布节奏快，问题也容易回滚。

### 阶段 2：半自动升级提醒

客户端启动时读取一个远端版本文件，例如：

```json
{
  "productName": "MD-Browser",
  "version": "0.2.0",
  "channel": "internal",
  "platform": "mac",
  "arch": "arm64",
  "fileName": "MD-Browser-0.2.0-arm64.dmg",
  "downloadUrl": "https://example.com/MD-Browser-0.2.0-arm64.dmg",
  "sha256": "....",
  "size": 123456789,
  "generatedAt": "2026-06-12T07:30:00.000Z",
  "minimumConfigVersion": 1,
  "notes": ["优化节点绑定", "修复启动日志"]
}
```

如果远端版本高于本地版本，客户端顶部显示“发现新版本”，点击后打开下载地址。这个阶段不在客户端内自动替换 App，风险低。

### 阶段 3：自动更新

功能稳定后再接入自动更新。

推荐路线：

- 使用 `electron-updater`
- 发布渠道分成 `latest` 和 `beta`
- 更新元数据与安装包放在 GitHub Releases、S3、OSS 或公司内部分发域名
- 每次发布都必须签名、公证、staple
- 自动更新只更新 App 本体，不修改 `~/.md-browser/config.json`

自动更新需要额外处理：

- 更新下载失败重试
- 更新前提醒用户关闭正在运行的浏览器任务
- 更新后保留本地端口、节点、目录池、profile 选择
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
