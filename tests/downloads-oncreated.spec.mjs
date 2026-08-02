// downloads.onCreated 兜底测试：JS 触发下载 → 取消浏览器下载并转发 aria2
// 去重窗口、已删除任务防复活（本地记忆 + aria2 实时查询）
import { test, expect } from "./fixtures.mjs";

const PAGE = `http://127.0.0.1:${process.env.MOCK_PORT}/`;
const HOLD_URL = `${PAGE}hold.bin`;

test.describe("onCreated 兜底拦截", () => {
  test.beforeEach(async ({ page, setupConfig }) => {
    await setupConfig();
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  });

  test("JS 触发浏览器下载 → 取消浏览器下载并转发 aria2", async ({ page, mock }) => {
    // .bin 不在默认拦截列表 → content script 不拦 → 浏览器下载 → onCreated 兜底
    await page.click("#link-bin");

    // 转发成功即证明链路走通：cancel 失败会直接 return（不转发），
    // 因此 addUri 收到请求 = cancel + erase + 转发全部成功
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    const add = (await mock.addUris())[0];
    expect(add.params[0][0]).toBe(HOLD_URL);
  });

  test("同一 URL 30s 窗口内不重复转发（去重）", async ({ page, mock }) => {
    await page.click("#link-bin");
    // 等第一次转发完成
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);

    await page.click("#link-bin"); // 再次触发同一 URL

    // 等待可能的第二次转发（去重应将其拦截）
    await page.waitForTimeout(1200);
    expect((await mock.addUris()).length).toBe(1);
  });

  test("用户已删除的任务 → 不自动重新添加（本地记忆）", async ({ page, mock, sw }) => {
    // 预置：该 URL 已被用户删除过（markRemoved 是 background 内部函数）
    await sw.evaluate((url) => markRemoved(url), HOLD_URL);

    await page.click("#link-bin");
    await page.waitForTimeout(1200);

    expect((await mock.addUris()).length).toBe(0);
  });

  test("aria2 中状态为 removed 的任务 → 实时查询拦截，不重加", async ({ page, mock }) => {
    // mock tellStopped 返回该 URL 的 removed 任务（模拟用户在 AriaNg 里删过）
    await mock.config({
      stopped: [
        {
          status: "removed",
          files: [{ uris: [{ uri: HOLD_URL }] }],
        },
      ],
    });

    await page.click("#link-bin");
    await page.waitForTimeout(1500);

    expect((await mock.addUris()).length).toBe(0);

    // 确实查询过 tellStopped（实时检查生效的证据）
    const { requests } = await mock.requests();
    const toldStopped = requests.filter((r) => r.method === "aria2.tellStopped");
    expect(toldStopped.length).toBeGreaterThanOrEqual(1);
  });
});
