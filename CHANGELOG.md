# Changelog

本项目所有重要变更都会记录在此文件，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
