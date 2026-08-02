// 下载完成/失败系统通知：转发跟踪 → 轮询 tellStatus → 通知 + 清理
// 通过 sw.evaluate 直接调用 checkDownloadStatus 绕过 30s alarm 等待
import { test, expect, gotoTestPage } from "./fixtures.mjs";

test.describe("下载完成通知", () => {
  test.beforeEach(async ({ sw, setupConfig }) => {
    await setupConfig();
    // 捕获系统通知创建（patch chrome.notifications.create，记录调用参数）
    await sw.evaluate(() => {
      self.__notifs = [];
      const origCreate = chrome.notifications.create.bind(chrome.notifications);
      chrome.notifications.create = (idOrOpts, maybeOpts) => {
        const id = typeof idOrOpts === "string" ? idOrOpts : undefined;
        const opts = typeof idOrOpts === "string" ? maybeOpts : idOrOpts;
        self.__notifs.push({ id, title: opts && opts.title, message: opts && opts.message });
        return origCreate(idOrOpts, maybeOpts);
      };
    });
  });

  const trackedGids = (sw) => sw.evaluate(() => [...trackedDownloads.keys()]);
  const notifs = (sw) => sw.evaluate(() => self.__notifs || []);

  test("完整链路：点击下载 → 任务被跟踪 → 完成后发系统通知并清理", async ({ page, sw, mock }) => {
    await gotoTestPage(page);
    await page.click("#link-zip");

    // 转发成功后任务进入跟踪列表
    await expect.poll(async () => (await trackedGids(sw)).length).toBe(1);
    const gid = (await trackedGids(sw))[0];

    // mock 标记任务完成 → 触发轮询
    await mock.config({ tasks: { [gid]: { gid, status: "complete" } } });
    await sw.evaluate(() => checkDownloadStatus());

    const list = await notifs(sw);
    expect(list).toHaveLength(1);
    expect(list[0].id).toContain("complete-");
    expect(list[0].message).toContain("pack.zip");
    // 任务已从跟踪列表移除
    expect(await trackedGids(sw)).toEqual([]);
  });

  test("任务 error → 发失败通知（含错误信息）并移除跟踪", async ({ sw, mock }) => {
    await sw.evaluate(() =>
      trackDownload("gid-test-error", "broken.zip", "http://127.0.0.1:18951/files/broken.zip")
    );
    await mock.config({
      tasks: {
        "gid-test-error": {
          gid: "gid-test-error",
          status: "error",
          errorMessage: "File not found",
        },
      },
    });

    await sw.evaluate(() => checkDownloadStatus());

    const list = await notifs(sw);
    expect(list).toHaveLength(1);
    expect(list[0].id).toContain("error-gid-test-error");
    expect(list[0].message).toContain("File not found");
    expect(await trackedGids(sw)).toEqual([]);
  });

  test("任务 removed（用户删除）→ 静默移除跟踪，不通知", async ({ sw }) => {
    await sw.evaluate(() =>
      trackDownload("gid-test-removed", "gone.zip", "http://127.0.0.1:18951/files/gone.zip")
    );
    // mock 未注入该任务 → tellStatus 返回 removed
    await sw.evaluate(() => checkDownloadStatus());

    expect(await notifs(sw)).toHaveLength(0);
    expect(await trackedGids(sw)).toEqual([]);
  });

  test("active 任务 → 保留跟踪，不通知", async ({ sw, mock }) => {
    await sw.evaluate(() =>
      trackDownload("gid-test-active", "slow.iso", "http://127.0.0.1:18951/files/slow.iso")
    );
    await mock.config({
      tasks: { "gid-test-active": { gid: "gid-test-active", status: "active" } },
    });

    await sw.evaluate(() => checkDownloadStatus());

    expect(await notifs(sw)).toHaveLength(0);
    expect(await trackedGids(sw)).toEqual(["gid-test-active"]);
  });

  test("开关关闭 → 不轮询不通知，任务保留", async ({ sw, mock }) => {
    await sw.evaluate(() =>
      trackDownload("gid-test-off", "quiet.zip", "http://127.0.0.1:18951/files/quiet.zip")
    );
    await mock.config({ tasks: { "gid-test-off": { gid: "gid-test-off", status: "complete" } } });
    // 关闭开关（模拟 options 页取消勾选）
    await sw.evaluate(() => {
      config.notifyDownloadComplete = false;
    });

    await sw.evaluate(() => checkDownloadStatus());

    expect(await notifs(sw)).toHaveLength(0);
    // 任务保留：重新开启开关后继续轮询
    expect(await trackedGids(sw)).toEqual(["gid-test-off"]);
  });

  test("跟踪超 24h 的任务自动清理，不通知", async ({ sw }) => {
    await sw.evaluate(() => {
      trackedDownloads.set("gid-test-old", {
        name: "old.zip",
        url: "",
        addedAt: Date.now() - 25 * 3600 * 1000,
      });
      persistTrackedDownloads();
    });

    await sw.evaluate(() => checkDownloadStatus());

    expect(await notifs(sw)).toHaveLength(0);
    expect(await trackedGids(sw)).toEqual([]);
  });

  test("alarm aria2-download-status 已注册（30s 周期）", async ({ sw }) => {
    const alarm = await sw.evaluate(() => chrome.alarms.get("aria2-download-status"));
    expect(alarm).not.toBeNull();
  });

  test("通知点击监听已注册（点击完成/失败通知 → 打开 AriaNg）", async ({ sw }) => {
    const hasListener = await sw.evaluate(() => chrome.notifications.onClicked.hasListeners());
    expect(hasListener).toBe(true);
  });
});
