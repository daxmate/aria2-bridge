// Playwright Test Runner 配置
// 运行：npm test（npx playwright test）
const { defineConfig } = require("playwright/test");
const path = require("path");

const MOCK_PORT = 18951;

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: /\.spec\.(mjs|js)$/,
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false, // 扩展测试共享浏览器，串行更稳
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 15000,
    trace: "off",
  },
  webServer: {
    command: `node tests/mock-server.js`,
    port: MOCK_PORT,
    reuseExistingServer: true,
    timeout: 15000,
  },
});

process.env.MOCK_PORT = String(MOCK_PORT);
process.env.EXT_PATH = path.resolve(__dirname, "plugin");
