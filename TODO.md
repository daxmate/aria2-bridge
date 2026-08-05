# Aria2 Bridge TODO

> **优先级规则**：每加一个功能前，先清一条 P0。P1 择机清理，P2 可以一直拖。
> 🔴 P0 = 结构性债务，越拖越贵（改一次的地方要改两处、文档与实现不一致、找逻辑要找半天）
> 🟡 P1 = 重要，值得做（真实 bug 或明显体验缺口）
> 🟢 P2 = 无害，有空再说
>
> ✅ 已完成项已归档，历史变更详见 [CHANGELOG.md](./CHANGELOG.md)

## 🔴 P0 结构性债务

- [x] **background.js 880 行单文件** ✅ 已完成 — 拆分为 `plugin/lib/` 六个模块（config / rpc / removed / hf / intercept / context-menu），background.js 瘦身为入口（importScripts + 事件监听 + 初始化）。MV3 SW 共享全局作用域，顶层函数/const 跨文件可见；eslint 以 globals 声明 SW 共享符号（no-redeclare off），与 DeepPage content script 模式一致。39 个 E2E 全绿兜底

## 🟡 P1 重要

- [x] **磁力/种子链接支持（magnet:）** ✅ 已完成（v1.5.0）— content script 点击拦截 magnet: 链接（新增 `interceptMagnet` 设置项，默认开）+ 右键菜单发送；background `processDownload` 放行 `magnet:`；.torrent 原已在默认扩展名列表。AriaNg 侧 BT 任务展示子模块原生支持，无需改
- [x] **下载完成系统通知** ✅ 已完成（v1.6.0）— 转发到 aria2 的任务被跟踪（GID 列表，`storage.session` 持久化），alarms 每 30s 轮询 `aria2.tellStatus`，complete → 完成通知（带文件名）、error → 失败通知（带错误信息）、removed → 静默清理；点击通知打开 AriaNg；跟踪超 24h 自动清理；设置项「下载完成时通知」默认开启（`notifyDownloadComplete`）；只跟踪本扩展转发的任务，HF 批量下载不跟踪（避免刷屏）
- [ ] **按域名/文件类型自动分类目录** — options 加「下载目录规则」：域名或文件后缀 → 目标目录，`aria2.addUri` 时带 `dir` 参数（aria2 原生支持）。匹配顺序建议：域名精确 → 域名后缀 → 文件后缀 → 默认。规则 UI 可参考 bypassDomains 的 textarea 行格式

## 🟢 P2 无害

- [ ] **iframe 内下载拦截** — manifest `all_frames: false`，网盘/文档站内嵌 iframe 的下载链接不拦。改 `true` 需处理：toast 只在顶层 frame 显示、消息去重（iframe 与顶层同时触发）
- [ ] **Badge 显示活动任务数** — alarms 每分钟 `aria2.tellActive` → badge 显示数字。⚠️ 与 `flashBadge` 冲突：闪烁 1.5s 后 `updateBadge()` 恢复，若 badge 承载任务数，需让 updateBadge 恢复为数字而非空
- [ ] **页面批量下载** — 右键「下载本页所有文件链接」（HF 一键下载的通用版）。防误抓：只抓 `a[href]` 且路径带已配置后缀的链接、去重、上限保护（如 100 个）

## ✨ Feature Ideas

> 功能优先级是产品决策，不在这里排。注意：**磁力支持建议和「下载完成通知」分开做**——前者是发送链路，后者是状态感知，各自独立可测。

- [ ] **右键「复制 aria2 命令」** — 链接/图片右键直接复制 `aria2c -x16 -s16 "<url>"` 命令行，给命令行用户用（零依赖，纯生成字符串）

## ❌ 已评估放弃

- **下载体积限制（最小拦截体积）**（2026-08-03 探讨后放弃）— 点击拦截路径在转发时拿不到文件大小（URL 只有后缀），所有方案都要付代价：HEAD 探测（延迟/签名直链失效/无 Content-Length 无从判断）+ 放行恢复（referer 丢失）。而收益存疑：小文件走 aria2 与走浏览器结果相同。若未来再遇痛点，先确认具体场景（误拦小资源 vs 嫌小文件走 aria2 麻烦），后者可能更适合用后缀名单/bypass 域名解决
- [ ] **多 RPC 配置切换** — 目前单一 RPC 地址。AriaNg 本身支持多 server，扩展只需存多套配置 + 切换（options 加下拉）。价值中等：多数用户单机单实例
- [ ] **限速/优先级右键项** — 右键菜单「限速下载」（aria2 `--max-download-limit`）、「暂停其他任务」（`aria2.pauseAll`）。低频但操作爽快
- [ ] **下载历史列表** — 扩展弹窗（action popup）显示最近转发记录（URL/文件名/时间），点击跳 AriaNg 对应任务。需要本地记录表 + storage 持久化

## 📦 已完成归档（摘要）

### v1.4.0 — 代码质量 + CI（2026-08-02）

- ESLint（flat config 四分区）+ Prettier（与 DeepPage 一致）
- CI workflow：push main/PR → lint + format:check + 版本一致性 + 39 E2E 全过
- 修复：content.js 漏调 `Aria2I18n.init()`（toast 语言偏好不生效）；死代码清理（saveConfig、hasDownloadAttr 等）
- 测试平台兼容：语言无关断言（toast 颜色）、document_idle 注入缓冲、SW 启动竞态处理

### v1.3.0 — 测试框架（2026-08-02）

- Playwright E2E（39 用例）+ mock aria2 JSON-RPC（18951）+ check-i18n 校验脚本（53 key × 2 locales）
- 覆盖：点击拦截 / RPC 转发 / 回退 / onCreated 兜底 / 右键菜单 / HF 下载 / 设置页 / AriaNg 面板
