// AriaNg Chrome Extension Fix
// 解决 chrome-extension:// 协议下 Angular $sce 将链接标记为 unsafe: 的问题
(function() {
  'use strict';

  if (typeof angular === 'undefined') return;
  if (location.protocol !== 'chrome-extension:') return;

  try {
    angular.module('ariaNg').config(['$compileProvider', function($compileProvider) {
      // 把 chrome-extension: 加到 href 和 src 的安全白名单
      // 否则所有带 ng-href 的链接都会被 Angular 转为 unsafe: URL
      $compileProvider.aHrefSanitizationWhitelist(
        /^\s*(https?|ftp|mailto|tel|file|blob|chrome-extension):/
      );
      $compileProvider.imgSrcSanitizationWhitelist(
        /^\s*((https?|ftp|file|blob|chrome-extension):|data:)/
      );
    }]);
  } catch (e) {
    console.warn('[AriaNg Fix] 配置 Angular $sce 失败:', e.message);
  }
})();
