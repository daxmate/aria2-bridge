# ⚡ Aria2 Bridge

轻量 Chrome 扩展，自动拦截浏览器下载并转发到本地 [aria2](https://aria2.github.io/) RPC，让你享受 aria2 的多线程加速。

## 功能

- **自动拦截下载** — 开启后浏览器中的文件下载自动交给 aria2 处理，不占浏览器带宽
- **磁力 / BT 下载** — 点击磁力链接（magnet:）自动转发给 aria2（原生支持，含 .torrent 种子文件）；可在设置页关闭，留给本地 BT 客户端
- **右键发送** — 在链接、图片、视频上右键 →「用 Aria2 下载」一键发送
- **Hugging Face 一键下载** — 在 Hugging Face 模型页面右键 →「📥 下载该模型所有文件到 Aria2」，自动获取完整文件树并批量发送
- **夸克网盘一键下载** — 在夸克网盘（pan.quark.cn）勾选文件后右键 →「📥 发送选中文件到 Aria2」，自动提取选中文件的下载直链并批量推送到 aria2
- **智能回退** — aria2 不可用时自动回退到浏览器原生下载，不丢文件
- **域名白名单** — 配置不拦截的域名，某些站点仍走浏览器下载
- **工具栏直达 AriaNg** — 点击扩展图标直接打开 AriaNg 管理面板，Badge 显示当前状态
- **弹窗通知** — 发送成功/失败时弹出系统通知
- **下载完成通知** — 转发到 aria2 的长任务下载完成或失败时发送系统通知（点击通知直达 AriaNg），可在设置页关闭
- **点击反馈** — 拦截下载时在点击位置弹出 Toast（绿色=已发送到 Aria2，橙色=已回退），工具栏 Badge 同步闪烁
- **RPC 密钥支持** — 支持 `--rpc-secret` 认证，连接有密码保护的 aria2
- **Cookie/UA 透传** — 自动携带浏览器 Cookie 和 User-Agent，登录态下载无压力
- **可配文件类型** — 自定义 Content Script 拦截的文件扩展名列表

## 工作原理

```
┌─────────────────┐  Intercept  ┌──────────────────┐  JSON-RPC   ┌─────────┐
│     Browser     │ ──────────→ │ Service Worker   │ ──────────→ │  Aria2  │
│ (Click / JS)    │             │ (+Cookie / UA)   │             │ (Local) │
│                 │ ←─ Fallback │                  │             │         │
└─────────────────┘             └──────────────────┘             └─────────┘
```

拦截分两层：

1. **Content Script** — 监听页面点击，匹配 `<a download>` 和可下载文件扩展名，阻止导航到空白页
2. **Service Worker** — 通过 `chrome.downloads.onCreated` 兜住 JS 触发的程序化下载

发送下载时自动携带以下 HTTP 头部：

| 头部 | 来源 | 作用 |
|------|------|------|
| `User-Agent` | 浏览器 navigator.userAgent | 避免被服务器识别为奇怪客户端 |
| `Referer` | 当前页面 URL | 防盗链来源校验 |
| `Cookie` | chrome.cookies API（目标域名） | 登录态下载，无需重新认证 |

## 安装

### 从源码加载（开发模式）

1. 克隆或下载本项目
2. 打开 Chrome → `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」→ 选择 `plugin/` 目录
5. ✅ 完成

### 前提条件

需要本地运行 aria2 并开启 JSON-RPC：

```bash
# macOS (Homebrew)
brew install aria2
aria2c --enable-rpc --rpc-listen-all

# 或带密钥
aria2c --enable-rpc --rpc-listen-all --rpc-secret=MySecret

# 或带配置文件
aria2c --conf-path=/path/to/aria2.conf
```

默认 RPC 地址为 `http://localhost:6800/jsonrpc`，可在设置页修改。

## 使用

1. 右键任意链接/图片/视频 →「用 Aria2 下载」发送任务
2. 点击扩展工具栏图标 → 直接打开 AriaNg 管理面板
3. 右键扩展图标 → 「📊 打开 AriaNg 管理面板」
4. 右键 Hugging Face 模型页面 → 「📥 下载该模型所有文件到 Aria2」
5. 右键扩展图标 →「选项」进入设置页

### 设置项

| 设置 | 说明 |
|------|------|
| **Aria2 RPC 地址** | aria2 JSON-RPC 接口地址，默认 `http://localhost:6800/jsonrpc` |
| **RPC 密钥** | `--rpc-secret=xxx` 中设置的密码，仅填密码本身（扩展自动加 `token:` 前缀）。留空表示无密码 |
| **默认下载目录** | 扩展不提供此设置项。请在 aria2 配置文件或启动参数中设置 `dir`（见下方注意事项） |
| **不拦截的域名** | 每行一个，匹配的域名走浏览器原生下载 |
| **拦截的文件类型** | 每行一个扩展名，Content Script 拦截这些扩展名的链接点击。留空使用默认列表 |
| **启用自动拦截** | 下载拦截总开关 |

设置页还提供了「测试连接」按钮和「恢复默认」按钮。

### AriaNg 管理面板

项目内置了 [AriaNg](https://github.com/mayswind/AriaNg) 管理面板（以 submodule 追踪源码），可通过右键扩展图标 →「📊 打开 AriaNg 管理面板」快速打开。

首次使用前需运行以下命令生成面板文件：

```bash
./scripts/update-aria-ng.sh
```

**自动同步 RPC 配置**：打开 AriaNg 时，插件会自动将设置页中配置的 RPC 地址和密钥通过 URL 参数传递给 AriaNg，无需手动重新配置 RPC 连接。

**Chrome 扩展兼容**：内置了对 `chrome-extension://` 协议的支持，通过 `scripts/aria-ng-fix.js` 解决了 AngularJS $sce 将 `chrome-extension://` 链接标记为不安全的问题。

支持的功能：

- 查看下载进度和速度
- 暂停/继续/删除任务
- 管理全局设置和 RPC 连接
- 添加新的下载任务

## 项目结构

```
aria2-bridge/
├── plugin/                   # 扩展目录 — Chrome 加载此文件夹
│   ├── manifest.json         # 扩展清单 (Manifest V3)
│   ├── background.js         # Service Worker 入口 — 事件监听、初始化
│   ├── lib/                  # SW 模块（importScripts 加载）
│   │   ├── config.js         # 配置加载与 Badge 状态
│   │   ├── rpc.js            # aria2 JSON-RPC 通信、文件名提取
│   │   ├── removed.js        # 去重与已删除任务记忆
│   │   ├── hf.js             # Hugging Face 一键下载
│   │   ├── intercept.js      # 下载拦截（onCreated 兜底）
│   │   └── context-menu.js   # 右键菜单与 AriaNg 入口
│   ├── content.js            # Content Script — 页面点击拦截、HF 模型 ID 提取
│   ├── options.html          # 设置页
│   ├── options.js            # 设置页逻辑
│   ├── _locales/             # 多语言资源
│   ├── icons/                # 图标 (16/48/128)
│   └── aria-ng/              # AriaNg 管理面板（构建产物）
├── submodules/
│   └── AriaNg/               # AriaNg 源码 submodule
├── scripts/
│   ├── update-aria-ng.sh     # 从 submodule 构建并拷贝 AriaNg 到 plugin/aria-ng/
│   ├── aria-ng-fix.js        # Angular $sce chrome-extension 协议白名单（构建时注入）
│   └── package.sh            # 打包 release zip
└── README.md / LICENSE

> `plugin/aria-ng/` 为构建产物，不提交到仓库。克隆后先运行 `./scripts/update-aria-ng.sh` 生成。


## 开发

### 构建/开发

纯原生 Chrome Extension，核心功能无需构建。AriaNg 面板通过 submodule 管理，克隆后运行以下命令生成：

```bash
./scripts/update-aria-ng.sh
```

### 更新 AriaNg 版本

```bash
./scripts/update-aria-ng.sh
```

### 打包发布

```bash
./scripts/package.sh v1.1.0
```

### 权限说明

| 权限 | 用途 |
|------|------|
| `downloads` | 拦截和取消浏览器下载 |
| `contextMenus` | 添加右键菜单 |
| `storage` | 持久化设置 |
| `notifications` | 发送成功/失败/下载完成通知 |
| `cookies` | 读取目标域名 Cookie，传递到 aria2 以维持登录态 |
| `tabs` | 管理 AriaNg 标签页（避免重复打开） |
| `host_permissions` | 允许 cookies API 和 aria2 RPC 通信 |

## 注意事项

- aria2 默认不开启 RPC，需要在启动时加 `--enable-rpc` 参数
- 如果设置了 `--rpc-secret`，必须在扩展设置页填写对应的密钥（仅填密码本身，扩展自动加 `token:` 前缀）
- 如果 aria2 未运行，下载会自动回退到浏览器原生下载
- `cookies` 权限仅用于读取当前访问站点的 Cookie 并转发给 aria2，不会被记录或上传
- Content Script 只拦截左键（及中键 `<a download>`），不影响右键菜单和快捷键
- 拦截下载时会在点击位置弹出 Toast 提示，同时工具栏 Badge 会短暂闪烁
- Hugging Face 下载会跳过 `.gitattributes`、`README.md` 等元数据文件，只下载模型文件
- 批量下载时工具栏 Badge 会显示文件总数，完成后闪烁 ✓

## 测试

项目使用 [Playwright](https://playwright.dev/) 做端到端测试（与 DeepPage 相同的模式）：

```bash
npm install          # 首次安装依赖
npx playwright install chromium   # 首次安装浏览器（如未装过）
npm test             # 一键跑全部测试（pretest 自动做 i18n 校验）
```

代码质量工具（与 DeepPage 一致）：

```bash
npm run lint        # ESLint 检查（flat config，分区：扩展全局脚本 / CJS / Node ESM）
npm run lint:fix    # ESLint 自动修复
npm run format      # Prettier 格式化
npm run format:check # Prettier 检查
```

测试不依赖真实 aria2 —— `tests/mock-server.js` 模拟 aria2 JSON-RPC（端口 18951），可配置失败模式（RPC error / HTTP 500 / 挂起），并记录全部 RPC 请求供断言。

### 覆盖的功能点

- **点击拦截**：左键/中键/Cmd+点击、无后缀链接、hash 链接、自定义 downloadExts、Toast 反馈
- **RPC 转发**：JSON-RPC 请求格式、`rpc-secret`（token: 前缀）、UA/Referer/Cookie 透传、文件名提取
- **回退**：aria2 不可用（error/500）时自动回退浏览器原生下载（点击拦截 + onCreated 两条路径）
- **onCreated 兜底**：JS 触发下载取消并转发、30s 去重、已删除任务防复活（本地记忆 + tellStopped 实时查询）、SPA 场景 Content-Disposition 中文文件名
- **右键菜单**：菜单创建、语言切换实时更新标题
- **Hugging Face**：文件树获取、元数据过滤、URL 编码、失败处理
- **下载完成通知**：转发任务跟踪（storage.session 持久化）、tellStatus 轮询（complete/error/removed）、24h 超时清理、开关关闭不轮询、点击通知打开 AriaNg
- **设置页**：默认值回显、自动保存、字段格式化、enabled → Badge OFF、语言切换
- **AriaNg**：buildAriaNgUrl（secret → URL-safe base64 hash 路由）、页面渲染、aria-ng-fix.js 生效
- **i18n**：zh_CN/en 的 key 一致性、非空、占位符完整性（`scripts/check-i18n.mjs`）

## License

MIT
