# aria2-bridge 开发笔记

## 项目
- Chrome Extension MV3，拦截浏览器下载转发到 aria2 RPC
- 纯原生 Chrome Extension API，无构建步骤
- 内置 AriaNg 管理面板（submodule + 预构建文件提交到 repo）

## Chrome Extension 开发经验

### CSP 限制
- 扩展页面默认 CSP `script-src 'self'`，**不允许内联 `<script>`**
- 嵌入外部应用时必须用多文件版本（独立的 .js 文件），不要用 AllInOne 单文件内联

### Manifest V3 注意事项
- Service Worker 非驻留，空闲 30s 后休眠
- 状态用 `chrome.storage.sync` 持久化，每次唤醒重新加载
- `cookies` + 宽 `host_permissions`（http://*/*）在 Chrome Web Store 上架时会审核

### 拦截架构
- Content Script 拦截 click 事件（阻止导航到空白页）+ sendMessage → SW
- Service Worker `onCreated` 兜住 JS 触发的下载（双层保障）
- 回退机制：aria2 不可用时自动用 `chrome.downloads.download()` 回退到浏览器原生下载

### 用户反馈
- Toast 在点击位置弹出（1.8s 淡出），`pointer-events: none`
- Badge 闪烁（✓/✗/!），1.5s 后恢复
- 两种反馈互补，Toast 即时，Badge 确认

### RPC 通信
- 插件内: `fetch()` → JSON-RPC 到 aria2
- Content ↔ SW: `chrome.runtime.sendMessage`
- 给嵌入页面传参: URL hash/query 参数
- AriaNg的secret参数需要URL-safe base64（`btoa + replace +/= + 去 padding`）

### 工程化
- 外部依赖（submodule）配合自动化脚本（update + package）
- 打包的第三方项目必须保留 LICENSE 文件
