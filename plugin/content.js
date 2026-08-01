// ========================================
// Aria2 Bridge — Content Script
// ========================================
// Intercepts clicks on download-looking links
// at the navigation level, preventing blank-page
// navigation before aria2 gets the URL.

// ========================================
// Toast feedback helper
// ========================================

// Temporary icons for feedback
const TOAST_ICON_OK = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
  '<circle cx="8" cy="8" r="7" fill="#4caf50"/>' +
  '<path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M4.5 8l2.5 2.5 4.5-4.5"/>' +
  '</svg>'
);
const TOAST_ICON_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
  '<circle cx="8" cy="8" r="7" fill="#ff9800"/>' +
  '<path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M8 4.5v4M8 10.5v1"/>' +
  '</svg>'
);

let toastTimeout = null;

function showToast(x, y, type) {
  if (toastTimeout) clearTimeout(toastTimeout);

  // Remove any existing toast
  const existing = document.getElementById('__aria2_bridge_toast');
  if (existing) existing.remove();

  const isSuccess = type === 'success';
  const icon = isSuccess ? TOAST_ICON_OK : TOAST_ICON_FALLBACK;
  const text = isSuccess
    ? Aria2I18n.t('toastSent')
    : Aria2I18n.t('toastFallback');

  const toast = document.createElement('div');
  toast.id = '__aria2_bridge_toast';
  toast.style.cssText = [
    'position: fixed',
    'z-index: 2147483647',
    'left:' + x + 'px',
    'top:' + (y - 36) + 'px',
    'transform: translateX(-50%)',
    'display: flex',
    'align-items: center',
    'gap: 6px',
    'padding: 6px 12px',
    'border-radius: 8px',
    'background: ' + (isSuccess ? '#e8f5e9' : '#fff3e0'),
    'color: ' + (isSuccess ? '#2e7d32' : '#e65100'),
    'font-size: 13px',
    'font-weight: 500',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    'box-shadow: 0 2px 8px rgba(0,0,0,.15)',
    'pointer-events: none',
    'white-space: nowrap',
    'transition: opacity 0.3s ease',
    'opacity: 0'
  ].join(';');

  toast.innerHTML = '<img src="' + icon + '" width="16" height="16" alt=""> ' + text;

  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  toastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
    toastTimeout = null;
  }, 1800);
}

// ========================================
// Click interception helpers
// ========================================

// 默认拦截的下载文件后缀（正匹配 — 只拦截这些后缀）
const DEFAULT_DOWNLOAD_EXTS = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.webm',
  '.iso', '.dmg', '.exe', '.msi', '.apk', '.deb', '.rpm',
  '.pkg', '.torrent', '.nzb',
  '.csv', '.json', '.xml',
  '.psd', '.ai', '.skp',
  '.epub', '.mobi', '.cbr'
];

let downloadExts = null;

// 从 storage 读取拦截后缀列表
chrome.storage.sync.get({ downloadExts: DEFAULT_DOWNLOAD_EXTS }).then(result => {
  downloadExts = result.downloadExts;
});

// 监听配置变化，实时更新
chrome.storage.onChanged.addListener((changes) => {
  if (changes.downloadExts) {
    downloadExts = changes.downloadExts.newValue;
  }
});

// Check if a URL looks like a downloadable file
function looksLikeDownload(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
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
function sendToAria2(url, referer, mouseX, mouseY) {
  chrome.runtime.sendMessage(
    { action: 'download', url, referer },
    (response) => {
      const type = response && response.success ? 'success' : 'fallback';
      showToast(mouseX, mouseY, type);
    }
  );
}

// Intercept left-click on download links
document.addEventListener('click', (e) => {
  // Only handle left clicks without modifiers
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;

  const link = e.target.closest('a');
  if (!link || !link.href) return;

  const url = link.href;

  // Skip non-HTTP(S)
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // Skip same-origin anchors (hash-only links)
  if (link.hash && link.origin === location.origin && !link.pathname && !link.search) return;

  // Skip browser-internal URLs
  if (url.startsWith('chrome://') || url.startsWith('vivaldi://') ||
      url.startsWith('about:') || url.startsWith('edge://')) return;

  const hasDownloadAttr = link.hasAttribute('download');
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
    sendToAria2(url, location.href, e.clientX, e.clientY);
  }
  // 无后缀 + download 属性 → 不拦截，让页面 JS 自己处理
  // 背景脚本会通过 downloads.onCreated 兜底
}, true); // useCapture to intercept before page handlers

// Also intercept middle-clicks on <a download> links
// 中键只拦截有文件后缀的链接
// eslint-disable-next-line max-len
document.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;

  const link = e.target.closest('a');
  if (!link || !link.href) return;
  if (!link.hasAttribute('download')) return;
  if (!looksLikeDownload(link.href)) return;

  e.preventDefault();
  sendToAria2(link.href, location.href, e.clientX, e.clientY);
}, true);

// ========================================
// Hugging Face — 读取模型文件列表
// ========================================

const HF_MODEL_PATTERN = /^https:\/\/huggingface\.co\/([^\/]+\/[^\/]+?)(?:\/|$)/;

function getHfModelId() {
  const match = location.href.match(HF_MODEL_PATTERN);
  return match ? match[1] : null;
}

// 监听 background 发来的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getHfModelId') {
    // 只负责从 URL 提取 model ID，API 调用由 background 完成
    sendResponse({ modelId: getHfModelId() });
  }

  /**
   * background 在 onCreated 兜底时，URL 可能无后缀且 MIME 未知。
   * content script 与页面同源，没有 CORS 和 Cookie 问题，
   * 可以获取真实的 Content-Disposition / Content-Type。
   */
  if (message.action === 'fetchDownloadHeaders') {
    fetch(message.url, { method: 'HEAD' })
      .then(resp => sendResponse({
        contentDisposition: resp.headers.get('Content-Disposition'),
        contentType: resp.headers.get('Content-Type')
      }))
      .catch(() => sendResponse({}));
    return true; // async response
  }
});
