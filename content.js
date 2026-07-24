// ========================================
// Aria2 Bridge — Content Script
// ========================================
// Intercepts clicks on download-looking links
// at the navigation level, preventing blank-page
// navigation before aria2 gets the URL.

// Default file extensions (override via extension settings)
const DEFAULT_EXTS = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.webm',
  '.iso', '.dmg', '.exe', '.msi', '.apk', '.deb', '.rpm',
  '.torrent', '.nzb',
  '.csv', '.json', '.xml',
  '.psd', '.ai', '.skp',
  '.epub', '.mobi', '.cbr'
];

// Mutable, loaded from storage on script start
let downloadExts = new Set(DEFAULT_EXTS);

// Load user-configured extensions from storage
(async () => {
  try {
    const { downloadExts: stored } = await chrome.storage.sync.get({ downloadExts: DEFAULT_EXTS });
    if (stored && Array.isArray(stored) && stored.length > 0) {
      downloadExts = new Set(stored.map(s => s.startsWith('.') ? s : '.' + s));
    }
  } catch {
    // Fall back to defaults
  }
})();

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
  const text = isSuccess ? '已发送到 Aria2' : '已回退到浏览器';

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

// Check if a URL looks like a downloadable file
function looksLikeDownload(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const path = u.pathname.toLowerCase();
    const match = path.match(/\.([a-z0-9]+)(?:[?#]|$)/);
    return match ? downloadExts.has('.' + match[1]) : false;
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

  const shouldIntercept =
    link.hasAttribute('download') ||          // <a download> always triggers a download
    looksLikeDownload(url);                    // Known file extension

  if (!shouldIntercept) return;

  // Intercept!
  e.preventDefault();
  e.stopPropagation();

  sendToAria2(url, location.href, e.clientX, e.clientY);
}, true); // useCapture to intercept before page handlers

// Also intercept middle-clicks on <a download> links
document.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;

  const link = e.target.closest('a');
  if (!link || !link.href) return;
  if (!link.hasAttribute('download')) return;

  e.preventDefault();
  sendToAria2(link.href, location.href, e.clientX, e.clientY);
}, true);
