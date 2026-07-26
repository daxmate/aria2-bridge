/**
 * Aria2 Bridge — 多语言工具模块
 *
 * 统一 t() 替代 chrome.i18n.getMessage()，支持运行时切换语言。
 * 会被 background.js (importScripts) / options.js / content.js 加载使用。
 */

;(function () {
  const I18n = {
    _messages: null,
    _ready: false,
    _pending: null
  };

  /**
   * 初始化：从 storage 读取用户语言偏好并加载对应 messages.json
   */
  I18n.init = async function () {
    if (I18n._pending) return I18n._pending;
    try {
      I18n._pending = (async () => {
        const data = await chrome.storage.sync.get('locale');
        const locale = data.locale || '';
        await I18n._load(locale);
      })();
      await I18n._pending;
    } finally {
      I18n._pending = null;
    }
  };

  I18n._load = async function (locale) {
    I18n._ready = false;
    // 不加载、自动模式、或与 Chrome 语言相同时，直接使用 chrome.i18n
    if (!locale || locale === 'auto') {
      I18n._messages = null;
      I18n._ready = true;
      return;
    }

    try {
      const resp = await fetch(chrome.runtime.getURL('_locales/' + locale + '/messages.json'));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      I18n._messages = await resp.json();
      I18n._ready = true;
    } catch (e) {
      console.warn('[Aria2 Bridge] Failed to load locale "' + locale + '":', e);
      I18n._messages = null;
      I18n._ready = true;
    }
  };

  /**
   * 获取翻译文本
   * @param {string} key - 消息 key
   * @param {string[]} [subs] - 替换参数
   * @returns {string}
   */
  I18n.t = function (key, subs) {
    // 已加载自定义 locale
    if (I18n._messages && I18n._messages[key]) {
      let msg = I18n._messages[key].message || '';
      const placeholders = I18n._messages[key].placeholders;

      if (placeholders && subs && subs.length > 0) {
        // 替换 $name$ → 通过 placeholders.name.content = "$N" 映射到 subs[N-1]
        msg = msg.replace(/\$([a-zA-Z]\w*)\$/g, function (_, name) {
          const ph = placeholders[name];
          if (ph && ph.content) {
            var m = ph.content.match(/^\$(\d+)$/);
            if (m) {
              var idx = parseInt(m[1], 10) - 1;
              return idx < subs.length ? subs[idx] : '';
            }
          }
          return '';
        });
      } else if (subs && subs.length > 0) {
        // 无 placeholders 但有替换参数时直接替换 $1$
        msg = msg.replace(/\$(\d+)\$/g, function (_, n) {
          var idx = parseInt(n, 10) - 1;
          return idx < subs.length ? subs[idx] : '';
        });
      }
      return msg;
    }

    // 回退到 Chrome 内置 i18n
    if (typeof chrome.i18n !== 'undefined' && chrome.i18n.getMessage) {
      return chrome.i18n.getMessage(key, subs) || key;
    }

    return key;
  };

  // 导出到全局
  self.Aria2I18n = I18n;
})();
