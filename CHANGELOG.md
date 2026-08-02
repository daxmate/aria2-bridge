# Changelog

本项目所有重要变更都会记录在此文件，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.5.0] - 2026-08-02

### ✨ 新功能

- **磁力 / BT 下载** — 点击磁力链接（magnet:）自动转发给 aria2（原生支持，含 .torrent 种子文件），带绿色 Toast 反馈；右键菜单发送磁力链接同样可用
  - 新增设置项「拦截磁力链接（magnet:）」，默认开启；关闭后磁力链接交给本地 BT 客户端
  - 新增 4 个 E2E 用例（点击拦截 / 开关关闭不拦 / RPC 接受 magnet / 设置页开关保存），共 43 个测试全绿

## [1.4.1] - 2026-08-02

### 🔧 重构

- **background.js 拆分为模块** — 880 行单文件拆成 `plugin/lib/` 六个模块（config / rpc / removed / hf / intercept / context-menu），background.js 瘦身为入口（importScripts + 事件监听 + 初始化）；eslint 以 globals 声明 SW 共享符号，39 个 E2E 全绿兜底

### ⚙️ 其他

- README 移除未实现的「连接测试」功能描述（该能力由 AriaNg 提供），目录结构同步 lib/ 布局

## [1.4.0] - 2026-08-02

### ✨ 新增

- **代码质量工具** — ESLint（flat config，按环境分区：扩展全局脚本 / AriaNg fix / CJS / Node ESM）+ Prettier（配置与 DeepPage 一致），`npm run lint` / `npm run format` / `npm run format:check`
- **CI workflow** — push main / PR 时自动执行：AriaNg 构建 → 依赖安装 → 版本一致性检查 → ESLint → Prettier 检查 → 全部 E2E 测试（39 用例）

### 🐛 修复

- content script 漏调 `Aria2I18n.init()`：toast 文案一直跟随浏览器 UI 语言，用户设置的语言偏好不生效
- 清理死代码：`background.js` 未使用的 `saveConfig`、`content.js` 死变量与多余转义、`options.js` 未使用变量

### ⚙️ 其他

- 测试框架平台兼容：固定语言无关断言（toast 颜色）、content script 注入时序缓冲、SW 启动竞态处理，CI（ubuntu）与本地（macOS）全部通过

## [1.3.0] - 2026-08-02

### ✨ 新增

- **Playwright E2E 测试框架** — `npm test` 一键跑 39 个用例：点击拦截、RPC 转发（rpc-secret / UA / Referer / Cookie 透传）、aria2 不可用回退浏览器下载、onCreated 兜底（取消并转发 / 30s 去重 / 已删任务防复活 / SPA 中文文件名提取）、右键菜单、Hugging Face 一键下载、设置页、AriaNg 面板
- **Mock aria2 服务器** — `tests/mock-server.js` 模拟 aria2 JSON-RPC，可配置失败模式（RPC error / HTTP 500 / 挂起），无需真实 aria2 即可跑完整测试
- **i18n 校验脚本** — `scripts/check-i18n.mjs` 检查 zh_CN / en 的 key 一致性、非空、占位符完整性，`npm test` 前自动执行
- README 新增「测试」章节，说明安装与覆盖范围

## [1.2.2] - 2026-07-30

### 🔧 修复

- 用户删除过的任务不再被自动重新添加（本地记忆 + aria2 `tellStopped` 实时查询双重检查）
- 扩展代码统一迁移到 `plugin/` 目录，同步更新 release workflow 路径

## [1.2.1] - 2026-07-29

### ✨ 新增

- 自动发布 workflow：push `v*` tag 时构建 AriaNg、打包 zip、创建 GitHub Release

### 🔧 修复

- SPA `<a download>` 无后缀链接不再由 content script 拦截（避免阻断页面 JS 下载流程），改由 `downloads.onCreated` 兜底
- 无后缀文件名自动补全：解析 Content-Disposition（含 RFC 5987 `filename*`），并按 MIME 猜测扩展名
- AriaNg 密钥无法保存的问题

## [1.2.0] - 2026-07-26

### ✨ 新增

- i18n 多语言支持（zh_CN / en），共享 i18n 模块
- 设置页语言切换，右键菜单语言实时同步

## [1.1.0] - 2026-07-25

### 🔧 修复

- README 流程图修正

[1.1.0]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.1.0
[1.2.0]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.2.0
[1.2.1]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.2.1
[1.2.2]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.2.2
[1.3.0]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.3.0
[1.4.0]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.4.0
[1.4.1]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.4.1
[1.5.0]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.5.0
