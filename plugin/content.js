// ========================================
// Aria2 Bridge — Content Script
// ========================================
// Intercepts clicks on download-looking links
// at the navigation level, preventing blank-page
// navigation before aria2 gets the URL.

// 读取用户语言偏好（toast 文案跟随设置而非浏览器 UI 语言）
Aria2I18n.init();

// ========================================
// Toast feedback helper（SweetAlert2 toast）
// ========================================

// 背景/文字色与旧自绘 toast 保持一致：
// 绿色 = 已发送到 aria2，橙色 = 已回退浏览器下载
// （颜色硬编码，测试断言语言无关）
const Toast = Sweetalert2.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 1800,
  timerProgressBar: false,
  didOpen: (toast) => {
    toast.addEventListener("mouseenter", Sweetalert2.stopTimer);
    toast.addEventListener("mouseleave", Sweetalert2.resumeTimer);
  },
});

function showToast(type) {
  const isSuccess = type === "success";
  Toast.fire({
    icon: isSuccess ? "success" : "warning",
    background: isSuccess ? "#e8f5e9" : "#fff3e0",
    color: isSuccess ? "#2e7d32" : "#e65100",
    title: isSuccess ? Aria2I18n.t("toastSent") : Aria2I18n.t("toastFallback"),
  });
}

// ========================================
// Click interception helpers
// ========================================

// 默认拦截的下载文件后缀（正匹配 — 只拦截这些后缀）
const DEFAULT_DOWNLOAD_EXTS = [
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".zst",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".mp3",
  ".mp4",
  ".avi",
  ".mkv",
  ".mov",
  ".flv",
  ".wmv",
  ".webm",
  ".iso",
  ".dmg",
  ".exe",
  ".msi",
  ".apk",
  ".deb",
  ".rpm",
  ".pkg",
  ".torrent",
  ".psd",
  ".ai",
  ".skp",
  ".epub",
  ".mobi",
  ".cbr",
];

let downloadExts = null;
let interceptMagnet = true;

// 从 storage 读取拦截后缀列表
chrome.storage.sync
  .get({ downloadExts: DEFAULT_DOWNLOAD_EXTS, interceptMagnet: true })
  .then((result) => {
    downloadExts = result.downloadExts;
    interceptMagnet = result.interceptMagnet;
  });

// 监听配置变化，实时更新
chrome.storage.onChanged.addListener((changes) => {
  if (changes.downloadExts) {
    downloadExts = changes.downloadExts.newValue;
  }
  if (changes.interceptMagnet) {
    interceptMagnet = changes.interceptMagnet.newValue;
  }
});

// Check if a URL looks like a downloadable file
function looksLikeDownload(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const path = u.pathname.toLowerCase();

    // 提取文件扩展名
    const extMatch = path.match(/\/[^/]+(\.[a-z0-9]{2,})(?:[?#]|$)/);
    if (!extMatch) return false;

    const ext = extMatch[1];

    // 只拦截 downloadExts 中列出的后缀
    if (downloadExts && downloadExts.includes(ext)) return true;

    return false;
  } catch {
    return false;
  }
}

// Send download to background, then show toast
function sendToAria2(url, referer) {
  chrome.runtime.sendMessage({ action: "download", url, referer }, (response) => {
    const type = response && response.success ? "success" : "fallback";
    showToast(type);
  });
}

// Intercept left-click on download links
document.addEventListener(
  "click",
  (e) => {
    // 只拦截真实用户点击。JS 脚本调 a.click() 触发的（isTrusted=false）
    // 不拦截 → 走 background 的 downloads.onCreated 兜底（那里有黑名单+队列查重），
    // 避免页面自动/重复触发时被当作“用户主动下载”反复添加
    if (!e.isTrusted) return;

    // Only handle left clicks without modifiers
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;

    const link = e.target.closest("a");
    if (!link || !link.href) return;

    const url = link.href;

    // 磁力链接：aria2 原生支持，开关开启时拦截转发
    // （magnet: 不会触发浏览器下载，无需 downloads.onCreated 兜底）
    if (url.startsWith("magnet:")) {
      if (!interceptMagnet) return; // 开关关闭 → 交给浏览器默认行为（本地 BT 客户端）
      e.preventDefault();
      e.stopPropagation();
      sendToAria2(url, location.href);
      return;
    }

    // Skip non-HTTP(S)
    if (!url.startsWith("http://") && !url.startsWith("https://")) return;

    // Skip same-origin anchors (hash-only links)
    if (link.hash && link.origin === location.origin && !link.pathname && !link.search) return;

    // Skip browser-internal URLs
    if (
      url.startsWith("chrome://") ||
      url.startsWith("vivaldi://") ||
      url.startsWith("about:") ||
      url.startsWith("edge://")
    )
      return;

    const isFileUrl = looksLikeDownload(url);

    /**
     * 三档拦截策略：
     *
     * 1. URL 含文件扩展名（.pdf / .zip 等）→ 直接拦截，送往 aria2。
     *    这类 URL 一般是直接的文件下载地址，可以安全截获。
     *
     * 2. URL 无扩展名但链接有 download 属性 → 不拦截，交由页面 JS 处理。
     *    常见于 SPA（如税务发票系统），页面用 canvas→toBlob→createObjectURL
     *    生成 blob URL 再触发下载。如果此时 stopPropagation，会阻止页面
     *    click handler 执行，导致下载流程中断。背景脚本的 downloads.onCreated
     *    会兜底捕获 HTTP 下载；blob 下载由浏览器原生处理。
     *
     * 3. 非下载链接 → 跳过。
     */
    if (isFileUrl) {
      // 有文件后缀 → 直接拦截
      e.preventDefault();
      e.stopPropagation();
      sendToAria2(url, location.href);
    }
    // 无后缀 + download 属性 → 不拦截，让页面 JS 自己处理
    // 背景脚本会通过 downloads.onCreated 兜底
  },
  true
); // useCapture to intercept before page handlers

// Also intercept middle-clicks on <a download> links
// 中键只拦截有文件后缀的链接
document.addEventListener(
  "auxclick",
  (e) => {
    if (!e.isTrusted) return; // 同上：只拦截真实用户点击
    if (e.button !== 1) return;

    const link = e.target.closest("a");
    if (!link || !link.href) return;
    if (!link.hasAttribute("download")) return;
    if (!looksLikeDownload(link.href)) return;

    e.preventDefault();
    sendToAria2(link.href, location.href);
  },
  true
);

// ========================================
// Hugging Face — 读取模型文件列表
// ========================================

const HF_MODEL_PATTERN = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+?)(?:\/|$)/;

function getHfModelId() {
  const match = location.href.match(HF_MODEL_PATTERN);
  return match ? match[1] : null;
}

// 监听 background 发来的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getHfModelId") {
    // 只负责从 URL 提取 model ID，API 调用由 background 完成
    sendResponse({ modelId: getHfModelId() });
  }

  /**
   * background 在 onCreated 兜底时，URL 可能无后缀且 MIME 未知。
   * content script 与页面同源，没有 CORS 和 Cookie 问题，
   * 可以获取真实的 Content-Disposition / Content-Type。
   */
  if (message.action === "fetchDownloadHeaders") {
    fetch(message.url, { method: "HEAD" })
      .then((resp) =>
        sendResponse({
          contentDisposition: resp.headers.get("Content-Disposition"),
          contentType: resp.headers.get("Content-Type"),
        })
      )
      .catch(() => sendResponse({}));
    return true; // async response
  }

  // 右键菜单触发：在夸克网盘页面提取选中文件直链并批量发送
  if (message.action === "quarkDownload") {
    injectQuarkScript().then(() => {
      // 等注入脚本加载完成后再发指令（脚本 onload 后监听器才就绪）
      window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*");
    });
    sendResponse({ ok: true });
  }
});

// ========================================
// Quark 网盘 — 选中文件批量发送
// ========================================

let quarkInjected = false;

/**
 * 把 quark.js 注入页面上下文（MAIN world）。
 * 只有页面上下文才能访问夸克页面的 React fiber 变量。
 * 注入脚本通过 window.postMessage 与 content script 通信。
 */
function injectQuarkScript() {
  if (quarkInjected) return Promise.resolve();
  quarkInjected = true;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("quark.js");
    script.onload = () => {
      script.remove();
      resolve();
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

// 监听注入脚本回传的直链结果
window.addEventListener("message", (event) => {
  // 只接受本页面（window 自身）发来的消息，防止其他 frame/扩展伪造
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data.type !== "string") return;

  if (data.type === "QUARK_SUCCESS") {
    sendQuarkLinks(data.data || []);
  } else if (data.type === "QUARK_ERROR") {
    const isNoSelection = data.message === "no-selection";
    showQuarkToast(
      isNoSelection
        ? Aria2I18n.t("quarkNoSelection")
        : Aria2I18n.t("quarkFetchFail", [data.message])
    );
  }
});

/**
 * 批量发送夸克直链到 aria2。
 * 直链 URL 带签名参数（无文件后缀），必须用 API 返回的 file_name 作为 out，
 * 否则 aria2 保存的文件名会是签名 URL 的路径名。
 */
function sendQuarkLinks(items) {
  if (!items || items.length === 0) {
    showQuarkToast(Aria2I18n.t("quarkNoSelection"));
    return;
  }

  let done = 0;
  let success = 0;
  const total = items.length;

  items.forEach((item) => {
    chrome.runtime.sendMessage(
      {
        action: "download",
        url: item.download_url,
        referer: location.href,
        out: item.file_name || undefined,
      },
      (response) => {
        done++;
        if (response && response.success) success++;
        // 全部返回后再统一提示，避免连续弹多个 toast
        if (done === total) {
          const message =
            success === total
              ? Aria2I18n.t("quarkSent", [String(total)])
              : Aria2I18n.t("quarkPartial", [String(success), String(total - success)]);
          showQuarkToast(message, success === total ? "success" : "warning");
        }
      }
    );
  });
}

// 夸克相关 toast：绿色=成功，橙色=失败/未选中（与全局 Toast 配色一致）
function showQuarkToast(title, type = "warning") {
  const isSuccess = type === "success";
  Toast.fire({
    icon: isSuccess ? "success" : "warning",
    background: isSuccess ? "#e8f5e9" : "#fff3e0",
    title,
  });
}
