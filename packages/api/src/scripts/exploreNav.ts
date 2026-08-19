/**
 * Script khám phá luồng điều hướng (CHỈ ĐIỀU HƯỚNG — KHÔNG thêm/đăng gì).
 *
 * Đi theo luồng thật đã xác nhận qua ảnh chụp màn hình:
 *   Kiếm tiền (tab cuối) → Mua sắm → Tuyển tập (mũi tên >) → danh sách bộ sưu tập
 * và dump UI tree + screenshot ở từng bước để lấy selector chính xác.
 *
 * DỪNG trước bước "+ Thêm" — không chạm vào dữ liệu bộ sưu tập.
 *
 * Chạy: npx ts-node src/scripts/exploreNav.ts
 */
import { remote } from 'webdriverio';
import { runAdbArgs } from '../automation/adb';
import * as fs from 'fs';
import * as path from 'path';
import { automationEnv } from '../automation/env';
import { resolveDeviceSerial } from '../automation/adb';
import { parseNodes, findNodeByLabel, centerOf, tapAt } from '../automation/uiFinder';

const OUT_DIR = path.join(__dirname, '../../logs/ui-dumps');
const YT_STUDIO_PKG = 'com.google.android.apps.youtube.creator';
const YT_STUDIO_ACTIVITY = 'com.google.android.apps.youtube.creator.main.MainActivity';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function capture(driver: WebdriverIO.Browser, label: string) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const xml = await driver.getPageSource();
  fs.writeFileSync(path.join(OUT_DIR, `${label}.xml`), xml, 'utf8');
  await driver.saveScreenshot(path.join(OUT_DIR, `${label}.png`));

  const nodes = parseNodes(xml);
  const labelled = nodes.filter((n) => n.text || n.desc);
  console.log(`\n📄 ${label} — ${nodes.length} node, ${labelled.length} node có nhãn:`);
  for (const n of labelled) {
    const cls = n.className.split('.').pop();
    const b = n.bounds;
    console.log(
      `   [${cls}]${n.clickable ? ' (clickable)' : ''} "${n.text || n.desc}" ` +
        `[${b.x1},${b.y1}][${b.x2},${b.y2}]`,
    );
  }
  return nodes;
}

async function main() {
  const deviceSerial = await resolveDeviceSerial();
  console.log(`→ Thiết bị: ${deviceSerial}`);

  // Khởi động app từ trạng thái sạch để không dính màn hình đang mở dở
  console.log('→ Force-stop app để bắt đầu từ màn hình chính...');
  await runAdbArgs(['shell', 'am', 'force-stop', YT_STUDIO_PKG], deviceSerial);

  const driver = await remote({
    hostname: automationEnv.APPIUM_HOST,
    port: automationEnv.APPIUM_PORT,
    logLevel: 'warn',
    capabilities: {
      platformName: 'Android',
      'appium:deviceName': deviceSerial,
      'appium:udid': deviceSerial,
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': YT_STUDIO_PKG,
      'appium:appActivity': YT_STUDIO_ACTIVITY,
      'appium:noReset': true,
      'appium:newCommandTimeout': 240,
      'appium:adbExecPath': automationEnv.ADB_PATH,
    },
  } as any);

  try {
    console.log('⏳ Chờ app load...');
    await delay(5000);
    const homeNodes = await capture(driver, 'nav_00_home');

    // ── Bước 1: tab "Kiếm tiền" = tab NẰM XA NHẤT BÊN PHẢI trên pivot_bar ──
    // Không dùng index của mảng vì tab đang được chọn không có clickable=true,
    // làm lệch thứ tự. Chọn theo toạ độ x là cách xác định chắc chắn.
    console.log('\n▶ [1] Tap tab "Kiếm tiền" (tab phải nhất trên pivot_bar)...');
    const pivotTabs = homeNodes.filter(
      (n) => n.clickable && n.bounds.y1 >= 2200 && n.className.includes('LinearLayout'),
    );
    if (pivotTabs.length === 0) {
      throw new Error('Không tìm thấy tab nào trên thanh điều hướng dưới cùng');
    }
    const monetizeTab = pivotTabs.reduce((a, b) => (b.bounds.x1 > a.bounds.x1 ? b : a));
    console.log(`   Tab phải nhất: [${monetizeTab.bounds.x1},${monetizeTab.bounds.y1}]`);
    const tabCenter = centerOf(monetizeTab);
    await tapAt(driver, tabCenter.x, tabCenter.y);
    await delay(4000);
    const monetizeNodes = await capture(driver, 'nav_01_monetize');

    // ── Bước 2: "Mua sắm" ──
    console.log('\n▶ [2] Tap "Mua sắm"...');
    const shopping = findNodeByLabel(monetizeNodes, 'Mua sắm');
    if (!shopping) {
      throw new Error('Không tìm thấy "Mua sắm" trên màn Kiếm tiền — xem nav_01_monetize.xml');
    }
    const shoppingCenter = centerOf(shopping);
    await tapAt(driver, shoppingCenter.x, shoppingCenter.y);
    await delay(4500);
    const shoppingNodes = await capture(driver, 'nav_02_shopping');

    // ── Bước 3: mở danh sách "Tuyển tập" đầy đủ ──
    console.log('\n▶ [3] Mở danh sách "Tuyển tập"...');
    const collections = findNodeByLabel(shoppingNodes, 'Tuyển tập');
    if (!collections) {
      throw new Error('Không tìm thấy "Tuyển tập" trên màn Mua sắm — xem nav_02_shopping.xml');
    }
    const colCenter = centerOf(collections);
    await tapAt(driver, colCenter.x, colCenter.y);
    await delay(4000);
    await capture(driver, 'nav_03_collections');

    console.log('\n✅ Dừng tại danh sách Tuyển tập — KHÔNG chạm vào dữ liệu bộ sưu tập.');
  } finally {
    await driver.deleteSession();
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
});
