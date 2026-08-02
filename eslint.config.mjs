// ESLint flat config — Aria2 Bridge
// 环境分区：
//   plugin/*.js + plugin/js/*.js → 全局脚本（background SW / content script / options / i18n）
//   tests/mock-server.js + playwright.config.js → CommonJS（Node）
//   tests/*.mjs + scripts/*.mjs → Node ESM
import eslintJs from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "plugin/aria-ng/**", // 第三方 AriaNg 构建产物
      "test-results/**",
      "dist/**",
      "node_modules/**",
    ],
  },
  eslintJs.configs.recommended,
  eslintConfigPrettier,
  {
    // 扩展全局脚本：background.js（SW，importScripts 加载 i18n.js）、
    // content.js（content script）、options.js（options.html 普通 script）、js/i18n.js
    files: ["plugin/*.js", "plugin/js/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Chrome API（SW 与扩展页面）
        chrome: "readonly",
        importScripts: "readonly",
        // browser globals
        self: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        console: "readonly",
        URL: "readonly",
        fetch: "readonly",
        btoa: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        // 项目内部全局（i18n.js 导出，被其他文件共享引用）
        Aria2I18n: "readonly",
      },
    },
    rules: {
      // 全局脚本：顶层声明即全局，与 globals 白名单重叠是预期行为
      "no-redeclare": "off",
      "no-unused-vars": [
        "warn",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-var": "warn",
      "prefer-const": "warn",
      "eqeqeq": ["warn", "smart"],
      // 模板字符串内的转义（如 SVG path 的 \"）无害且常见，不阻塞
      "no-useless-escape": "warn",
      // 空 catch 块是刻意忽略错误，允许
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // scripts/aria-ng-fix.js：注入 AriaNg 页面的浏览器脚本（angular 全局）
    files: ["scripts/aria-ng-fix.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        angular: "readonly",
        location: "readonly",
        console: "readonly",
        window: "readonly",
        document: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // CommonJS：tests/mock-server.js（http server）、playwright.config.js
    files: ["tests/mock-server.js", "playwright.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "eqeqeq": ["warn", "smart"],
    },
  },
  {
    // Node ESM：tests/*.mjs、scripts/*.mjs
    files: ["tests/*.mjs", "scripts/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        URL: "readonly",
        // page.evaluate / sw.evaluate 内是（扩展）浏览器上下文，需要 browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        requestAnimationFrame: "readonly",
        chrome: "readonly",
        // evaluate 回调里访问的扩展内部全局（SW evaluate 可调 top-level 函数）
        markRemoved: "readonly",
        updateContextMenus: "readonly",
        buildAriaNgUrl: "readonly",
        extractFilename: "readonly",
        shouldBypass: "readonly",
        shouldSkipHfFile: "readonly",
        fetchHfFileList: "readonly",
        loadConfig: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-var": "warn",
      "prefer-const": "warn",
      "eqeqeq": ["warn", "smart"],
      "no-empty-pattern": "off",
    },
  },
];
