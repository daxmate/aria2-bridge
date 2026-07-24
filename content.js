// ========================================
// Aria2 Bridge — Content Script
// ========================================
// Intercepts clicks on download-looking links
// at the navigation level, preventing blank-page
// navigation before aria2 gets the URL.

// Common downloadable file extensions
const DOWNLOAD_EXTS = new Set([
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.webm',
  '.iso', '.dmg', '.exe', '.msi', '.apk', '.deb', '.rpm',
  '.torrent', '.nzb',
  '.csv', '.json', '.xml',
  '.psd', '.ai', '.skp',
  '.epub', '.mobi', '.cbr'
]);

// Check if a URL looks like a downloadable file
function looksLikeDownload(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const path = u.pathname.toLowerCase();
    const match = path.match(/\.([a-z0-9]+)(?:[?#]|$)/);
    return match ? DOWNLOAD_EXTS.has('.' + match[1]) : false;
  } catch {
    return false;
  }
}

// Click interception
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

  // Ask background to send to aria2 (fallback handled by background)
  chrome.runtime.sendMessage({
    action: 'download',
    url: url,
    referer: location.href
  });
}, true); // useCapture to intercept before page handlers

// Also intercept middle-clicks on <a download> links
document.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;

  const link = e.target.closest('a');
  if (!link || !link.href) return;
  if (!link.hasAttribute('download')) return;

  e.preventDefault();
  chrome.runtime.sendMessage({
    action: 'download',
    url: link.href,
    referer: location.href
  });
}, true);
