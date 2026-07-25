# ⚡ Aria2 Bridge

轻量 Chrome 扩展，自动拦截浏览器下载并转发到本地 [aria2](https://aria2.github.io/) RPC，让你享受 aria2 的多线程加速。

## 功能

- **自动拦截下载** — 开启后浏览器中的文件下载自动交给 aria2 处理，不占浏览器带宽
- **右键发送** — 在链接、图片、视频上右键 →「用 Aria2 下载」一键发送
- **智能回退** — aria2 不可用时自动回退到浏览器原生下载，不丢文件
- **域名白名单** — 配置不拦截的域名，某些站点仍走浏览器下载
- **工具栏开关** — 点击扩展图标一键切换拦截开关，Badge 显示当前状态
- **弹窗通知** — 发送成功/失败时弹出系统通知
- **点击反馈** — 拦截下载时在点击位置弹出 Toast（绿色=已发送到 Aria2，橙色=已回退），工具栏 Badge 同步闪烁
- **RPC 密钥支持** — 支持 `--rpc-secret` 认证，连接有密码保护的 aria2
- **Cookie/UA 透传** — 自动携带浏览器 Cookie 和 User-Agent，登录态下载无压力
- **可配文件类型** — 自定义 Content Script 拦截的文件扩展名列表
- **连接测试** — 设置页一键测试 aria2 RPC 连接是否正常

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
4. 点击「加载已解压的扩展程序」→ 选择项目目录
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

1. 安装后在扩展栏点击 Aria2 Bridge 图标可切换拦截开关
2. 右键任意链接/图片/视频 →「用 Aria2 下载」发送任务
3. 右键扩展图标 →「📊 打开 AriaNg 管理面板」打开 Web 管理面板
4. 右键扩展图标 →「选项」进入设置页

### 设置项

| 设置 | 说明 |
|------|------|
| **Aria2 RPC 地址** | aria2 JSON-RPC 接口地址，默认 `http://localhost:6800/jsonrpc` |
| **RPC 密钥** | `--rpc-secret=xxx` 中设置的密码，仅填密码本身（扩展自动加 `token:` 前缀）。留空表示无密码 |
| **默认下载目录** | 可选，留空则使用 aria2 配置中的 `dir` |
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

支持的功能：

- 查看下载进度和速度
- 暂停/继续/删除任务
- 管理全局设置和 RPC 连接
- 添加新的下载任务

## 项目结构

```
aria2-bridge/
├── manifest.json            # 扩展清单 (Manifest V3)
├── background.js            # Service Worker — RPC 通信、下载拦截、右键菜单
├── content.js               # Content Script — 页面点击拦截
├── options.html             # 设置页
├── options.js               # 设置页逻辑（含连接测试）
├── submodules/
│   └── AriaNg/              # AriaNg 源码 submodule
├── scripts/
│   ├── update-aria-ng.sh    # 从 submodule 构建并拷贝 AriaNg 到 aria-ng/
│   └── package.sh           # 打包 release zip
└── icons/                   # 图标 (16/48/128)

> `aria-ng/` 为构建产物，不提交到仓库。克隆后先运行 `./scripts/update-aria-ng.sh` 生成。
```

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
| `notifications` | 发送成功/失败通知 |
| `cookies` | 读取目标域名 Cookie，传递到 aria2 以维持登录态 |
| `host_permissions` | 允许 cookies API 和 aria2 RPC 通信 |

## 注意事项

- aria2 默认不开启 RPC，需要在启动时加 `--enable-rpc` 参数
- 如果设置了 `--rpc-secret`，必须在扩展设置页填写对应的密钥（仅填密码本身，扩展自动加 `token:` 前缀）
- 如果 aria2 未运行，下载会自动回退到浏览器原生下载
- `cookies` 权限仅用于读取当前访问站点的 Cookie 并转发给 aria2，不会被记录或上传
- Content Script 只拦截左键（及中键 `<a download>`），不影响右键菜单和快捷键
- 拦截下载时会在点击位置弹出 Toast 提示，同时工具栏 Badge 会短暂闪烁

## License

MIT
