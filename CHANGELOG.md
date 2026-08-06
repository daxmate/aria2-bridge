# Changelog

本项目所有重要变更都会记录在此文件，格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.8.2] - 2026-08-06

### 🐛 修复

- **OSS 签名直链下载不再转发 aria2** — 阿里云 OSS 签名直链（URL 带 `OSSAccessKeyId`/`Signature` 参数，如 jiaoyanyun 的 `pdf-cdn.speiyou.com`）转发 aria2 后可能拿到损坏文件：实测同一 URL 浏览器下载正常、aria2 下载返回 CDN 缓存中的旧版损坏文件（7 月 11 日预生成，内容与 11 月 29 日重新生成的完好版不同）。此类签名直链本质是服务器临时签发给浏览器的，CDN 可能按请求特征（UA/Referer/Cookie）返回不同内容 → 现在默认不拦截，直接浏览器原生下载（与 ankiweb 一次性 JWT token 同类处理，受同一开关控制）
- **新增 OSS 签名直链跳过测试** — 覆盖 `OSSAccessKeyId`+`Signature` 参数 URL 不转发 aria2、浏览器下载保留

## [1.8.1] - 2026-08-06

### 🐛 修复

- **设置页 RPC 分区标题与密钥标签显示原始 i18n key** — options.html 引用了不存在的翻译 key（`optionsSectionRpc` / `optionsRpcSecretLabel` / `optionsRpcSecretHint`），设置页直接显示 key 文本（如「optionsSectionRpc」）。已修正为语言文件中实际的 `optionsSectionConnection` / `optionsSecretLabel` / `optionsSecretHint`
- **check-i18n 增加 HTML 引用校验** — 此前只校验 JS 中的 `t()` 引用，options.html 的 `data-i18n` / `data-i18n-placeholder` 引用不存在的 key 无法被发现。现在 HTML 引用也会校验，CI 可拦截同类问题（`npm run check:i18n` 是 `npm test` 的 pretest）
- **新增设置页 i18n 渲染测试** — 断言所有 `data-i18n` 元素无原始 key 残留（zh_CN + 切换英文后），防止界面显示 key 文本的回归

## [1.8.0] - 2026-08-06

### 🐛 修复

- **下载点击永不落空（结构性修复）** — 某些网页（如 ankiweb 共享牌组页）的下载既不进 aria2 也不走浏览器原生下载，关掉插件才能下载
  - **根因**：`onCreated` 兜底路径“先取消、后检查”——先把浏览器下载 `cancel` 掉，再做去重/黑名单/队列检查，检查一旦命中就静默 `return`：下载已被取消，既没转发 aria2 也没恢复浏览器下载，用户点击直接“消失”
  - **修复**：所有检查前置到 cancel 之前（一次性 token / 去重 / 黑名单 / 队列查重）。任何 skip 都不取消浏览器下载，让它原生完成——要么 aria2、要么浏览器，永远不会什么都没有
  - **一次性签名 token 检测**：URL 带 JWT 形状参数（如 ankiweb 的 `?t=eyJ...`）的下载不再转发 aria2——浏览器请求发出时 token 已被消耗，aria2 用同一 URL 重新请求必然失败（一次性/限流），直接交给浏览器原生下载
  - **队列查重逐方法容错**：`isAlreadyInQueue` 对 tellActive/tellWaiting/tellPaused 单独容错，某个方法不可用（本机 daemon 缺 `aria2.tellPaused`）不再拖垮整个查重（此前导致队列查重静默失效，同 URL 会重复加任务）
  - **点击路径 skip 不再假装成功**：content script 拦截的链接在去重/队列命中时抛错走回退（浏览器下载 + 橙色 toast），不再静默显示“已发送”却什么都没发生
- **修复 content script 加载英文 locale 报错** — 设置英文后任意页面控制台报 `Failed to load locale "en": TypeError: Failed to fetch`（`js/i18n.js:47`）：content script 的 fetch 受 `web_accessible_resources` 限制，`_locales/` 不在白名单导致 CORS 失败。已将 `_locales/*` 加入 web_accessible_resources

### ✨ 新功能

- **设置项「跳过带一次性签名 token 的下载」**（默认开启）— options 下载分区新增开关，关闭后一次性 token 下载也会尝试转发 aria2（zh/en 双语）

## [1.7.2] - 2026-08-05

### 🔧 重构

- **emoji 图标 → SVG** — 选项页标题的 ⚡、彩蛋的 🐘 替换为统一风格的内联 SVG（24×24 / 描边 2px / 随主题变色），右键菜单及选项页文案中的 emoji 图标全部移除
  - 新增 `plugin/images/` 目录，存放 11 个 SVG 图标源文件（闪电 / 链接 / 沙漏 / 对勾 / 叉 / 文件夹 / 软盘 / 刷新 / 柱状图 / 下载 / 大象），供后续按钮恢复使用
  - 系统通知标题的 ✅❌ 保留（Chrome notifications API 仅支持文本，emoji 作为视觉标记）
  - 补齐 eslint globals 白名单（上一提交引入的 `cleanupStaleDownloads` 未注册 + options.js 的 `alert`），lint 恢复 0 error

## [1.7.1] - 2026-08-05

### 🐛 修复

- **彻底修复“已删除任务自动复活”** — 删除过的下载任务（张学友歌单 / MacTeX / Codex 等）反复自动回到 aria2 队列，每个 URL 2-8 个副本，持续约一个月
  - **根因（三层叠加）**：① 浏览器下载历史残留的“已取消”记录（拦截后 `erase` 失败）作为种子；② Vivaldi 设置 `start_automatically=true` 在浏览器启动时自动恢复这些中断下载（“重启两次才触发”是恢复流程的两阶段特性）；③ 扩展 `onCreated` 把恢复的下载转发到 aria2，且去重窗口太短 + 已删除黑名单存 `storage.session`（浏览器重启即丢）拦不住
  - **添加前队列查重**：`isAlreadyInQueue()` 检查 aria2 active/waiting 是否已有同 URL 任务，有则跳过——同一 URL 不再重复添加
  - **黑名单持久化**：已删除任务记忆从 `storage.session` 改存 `storage.local`，浏览器重启不再丢失
  - **清理残留种子**：新增 `cleanupStaleDownloads()`，扩展启动时 + 每 5 分钟自动清理下载管理器里 `USER_CANCELED` 的残留下载项，从源头消除“复活种子”
  - **只拦真实点击**：content script 增加 `isTrusted` 过滤，页面 JS 自动触发的下载不再走点击拦截路径，交给有查重保护的 `onCreated` 兜底
  - 排查期间同时发现并清除了 manifest 迁移到 `plugin/` 目录后残留的根目录旧扩展实例（双实例会导致每个 URL 双份转发）

## [1.7.0] - 2026-08-02

### ✨ 新功能

- **夸克网盘一键下载** — 在夸克网盘（pan.quark.cn）页面勾选文件后，右键 →「📥 发送选中文件到 Aria2」，自动提取选中文件的下载直链并批量推送到 aria2
  - **我的网盘**（`/list`）：注入脚本穿透 React fiber，从文件列表读取勾选项（`list + selectedRowKeys`）→ `file/download` 取直链
  - **分享页**（`/s/xxx`）：分享页文件列表不在 React fiber 中（实测），改为读 Ant Design Table 勾选行（`tr.ant-table-row-selected` 的 `data-row-key` = fid）→ 走分享 API 链路：`sharepage/token` 换 stoken → `sharepage/detail` 拿文件列表（fid → share_fid_token 映射）→ `file/download` 带 `pwd_id + stoken + fids_token` 取直链（**无需转存**）
  - 直链域名 `drive-pc.quark.cn`（PC 客户端 API）；DNR 规则把请求 UA 改写为夸克客户端 UA（fetch 无法设置 UA）
  - 文件名用接口返回的 `file_name` 作为 aria2 `out` 参数（直链 URL 带签名参数无后缀，避免文件名错乱）
  - 未勾选文件 / 接口报错（含未登录 31001）/ 勾选不在列表中 → 橙色 Toast 提示，不静默
  - 批量发送逐条反馈，全部返回后统一提示成功/部分失败数量
  - 新增 10 个 E2E 用例（我的网盘 7 + 分享页 3：勾选下载 / token 失败 / 未勾选），共 62 个测试全绿

### 🐛 修复

- **SweetAlert2 升级 v10.16.6 → v11.26.25**：旧版每次 toast 都在控制台报 `Unknown parameter 'color'` 警告（`color` 参数 v11 才正式支持），且文字颜色被忽略（背景色正常但文字是默认色）。升级后警告消失，成功=绿字/失败=橙字配色真正生效。全局 `Sweetalert2`/`mixin`/`Toast.fire`/`didOpen` API 完全兼容，零代码改动

## [1.6.0] - 2026-08-02

### ✨ 新功能

- **下载完成通知** — 转发到 aria2 的长任务下载完成时发系统通知（带文件名），点击通知直达 AriaNg 管理面板；下载失败也会通知（显示错误信息）
  - 只跟踪本扩展转发的任务（GID 列表，`storage.session` 持久化，SW 重启不丢），不动 AriaNg 里手动添加的任务
  - 每 30s alarm 轮询 `aria2.tellStatus`（MV3 alarms 最小周期），无跟踪任务时不产生 RPC 请求
  - 用户在 AriaNg 删除的任务（removed）静默移除跟踪；跟踪超 24h 未完成自动清理，防止列表膨胀
  - 新增设置项「下载完成时通知」，默认开启
  - 新增 9 个 E2E 用例（完整链路 / error / removed / active / 开关关闭 / 超时清理 / alarm 注册 / 通知点击监听 / 设置页开关），共 52 个测试全绿

## [1.5.1] - 2026-08-02

### 🔧 重构

- **Toast 替换为 SweetAlert2** — content script 点击反馈从自绘 toast（40 行）换成 SweetAlert2（`plugin/vendor/sweetalert2/`，MIT 许可，72.6KB），保留原有绿/橙配色与 1.8s 时长；toast 位置改为右上角固定（原为点击位置弹出）；鼠标悬停可暂停计时。43 个 E2E 全绿

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
[1.5.1]: https://github.com/daxmate/aria2-bridge/releases/tag/v1.5.1
