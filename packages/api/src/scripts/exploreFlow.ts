/**
 * Khám phá luồng gắn sản phẩm ĐẾN TRƯỚC bước thay đổi dữ liệu.
 *
 * Đi: deep link Mua sắm → Tuyển tập → bộ sưu tập đầu tiên → Thêm sản phẩm → dán link
 * rồi DỪNG. Không chọn sản phẩm, không bấm "Xong", không bấm "Đăng".
 * Mục đích: thu thập cấu trúc màn hình thật để hoàn thiện automation.
 *
 * Chạy: npx ts-node src/scripts/exploreFlow.ts
 */
import { remote } from 'webdriverio';
import { runAdbArgs } from '../automation/adb';
import * as fs from 'fs';
import * as path from 'path';
import { automationEnv } from '../automation/env';
import { resolveDeviceSerial } from '../automation/adb';
import { Screen } from '../automation/screen';
import { parseNodes, tapAt } from '../automation/uiFinder';
import { closeOcr } from '../automation/ocr';

const OUT_DIR = path.join(__dirname, '../../logs/ui-dumps');
const YT_STUDIO_PKG = 'com.google.android.apps.youtube.creator';
const YT_STUDIO_ACTIVITY = 'com.google.android.apps.youtube.creator.main.MainActivity';
const CHANNEL_ID = process.env.YT_CHANNEL_ID ?? 'UC3fFeHphb3dQtKcr0RdAOmA';
const SHOPEE_URL = process.env.TEST_SHOPEE_URL ?? 'https://vn.shp.ee/LcvcKnUG';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thẻ bộ sưu tập trên màn Mua sắm: node clickable, có nhãn, nằm cạnh nhau theo
 * chiều ngang trong một dải. Loại trừ các nút điều khiển đi kèm ("Tạo bộ sưu tập",
 * "Xem thêm"...) vì chúng không phải bộ sưu tập.
 */
const NOT_A_COLLECTION = ['tạo bộ sưu tập', 'xem thêm', 'kết nối cửa hàng', 'tiếp tục', 'action menu'];

function findCollectionCards(nodes: ReturnType<typeof parseNodes>) {
  const candidates = nodes.filter(
    (n) =>
      n.clickable &&
      n.desc &&
      n.bounds.y1 > 300 &&
      n.bounds.y2 < 2200 &&
      !NOT_A_COLLECTION.includes(n.desc.toLowerCase().trim()),
  );
  if (candidates.length === 0) return [];

  // Các thẻ cùng một dải carousel có cùng toạ độ y — gom theo y phổ biến nhất
  const byRow = new Map<number, typeof candidates>();
  for (const c of candidates) {
    const row = byRow.get(c.bounds.y1) ?? [];
    row.push(c);
    byRow.set(c.bounds.y1, row);
  }
  const widest = [...byRow.values()].sort((a, b) => b.length - a.length)[0];
  return widest.length >= 2 ? widest.sort((a, b) => a.bounds.x1 - b.bounds.x1) : [];
}

async function dump(driver: WebdriverIO.Browser, label: string) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const xml = await driver.getPageSource();
  fs.writeFileSync(path.join(OUT_DIR, `${label}.xml`), xml, 'utf8');
  await driver.saveScreenshot(path.join(OUT_DIR, `${label}.png`));

  const nodes = parseNodes(xml);
  console.log(`\n📄 ${label} — ${nodes.length} node:`);
  for (const n of nodes.filter((x) => x.text || x.desc)) {
    const b = n.bounds;
    console.log(
      `   [${n.className.split('.').pop()}]${n.clickable ? '(clickable)' : ''} ` +
        `"${n.text || n.desc}" [${b.x1},${b.y1}][${b.x2},${b.y2}]`,
    );
  }
  const clickables = nodes.filter((n) => n.clickable);
  console.log(`   → ${clickables.length} node clickable:`);
  for (const n of clickables) {
    const b = n.bounds;
    console.log(`      ${n.resourceId || n.className.split('.').pop()} [${b.x1},${b.y1}][${b.x2},${b.y2}]`);
  }
  return nodes;
}

async function main() {
  const deviceSerial = await resolveDeviceSerial();
  console.log(`→ Thiết bị: ${deviceSerial}`);
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
      'appium:newCommandTimeout': 300,
      'appium:adbExecPath': automationEnv.ADB_PATH,
    },
  } as any);

  const screen = new Screen(driver, 'explore');

  try {
    await delay(4000);

    // ── [1] Deep link thẳng vào màn Mua sắm ──────────────────────────────────
    console.log('\n▶ [1] Deep link → Mua sắm');
    await runAdbArgs(
      [
        'shell',
        `am start -a android.intent.action.VIEW ` +
          `-d 'https://studio.youtube.com/channel/${CHANNEL_ID}/monetization/shopping' ` +
          `-p ${YT_STUDIO_PKG}`,
      ],
      deviceSerial,
    );
    await delay(3000);
    await screen.waitFor(['Mua sắm'], 'mo-man-mua-sam', 40000);
    await dump(driver, 'flow_01_shopping');

    // ── [2] Cuộn tới khi thấy dải thẻ bộ sưu tập ─────────────────────────────
    // Không cần mở danh sách đầy đủ: thẻ bộ sưu tập hiện ngay trên màn Mua sắm,
    // và (khác với phần lớn màn hình khác) chúng CÓ nhãn trong accessibility tree.
    console.log('\n▶ [2] Cuộn tìm dải thẻ bộ sưu tập');
    let cards: ReturnType<typeof parseNodes> = [];
    for (let i = 0; i < 8; i++) {
      cards = findCollectionCards(await screen.nodes());
      if (cards.length > 0) break;
      await screen.scrollDown();
      await delay(1200);
    }
    await dump(driver, 'flow_02_shopping_scrolled');

    if (cards.length === 0) {
      throw new Error('Không tìm thấy thẻ bộ sưu tập nào trên màn Mua sắm');
    }
    console.log(`   Thấy ${cards.length} bộ sưu tập: ${cards.map((c) => `"${c.desc}"`).join(', ')}`);

    // ── [3] Mở bộ sưu tập mục tiêu (theo tên, mặc định lấy thẻ đầu tiên) ─────
    const targetName = process.env.YT_COLLECTION_NAME;
    const target = targetName
      ? cards.find((c) => c.desc.toLowerCase().includes(targetName.toLowerCase()))
      : cards[0];
    if (!target) {
      throw new Error(
        `Không thấy bộ sưu tập tên "${targetName}". Hiện có: ${cards.map((c) => c.desc).join(', ')}`,
      );
    }

    console.log(`\n▶ [3] Mở bộ sưu tập "${target.desc}"`);
    await tapAt(
      driver,
      Math.round((target.bounds.x1 + target.bounds.x2) / 2),
      Math.round((target.bounds.y1 + target.bounds.y2) / 2),
    );
    await delay(4500);
    await dump(driver, 'flow_04_context_menu');

    // ── [4] Menu ngữ cảnh → "Chỉnh sửa" ──────────────────────────────────────
    // Tap thẻ bộ sưu tập mở menu: Chỉnh sửa | Chia sẻ | Xem số liệu | Xem trên
    // YouTube | Xoá. Phải chọn đúng "Chỉnh sửa" (nút "Xoá" nằm ngay dưới).
    console.log('\n▶ [4] Chọn "Chỉnh sửa" trong menu ngữ cảnh');
    await screen.tap(['Chỉnh sửa'], 'chon-chinh-sua');
    await delay(4000);
    await dump(driver, 'flow_05_collection_edit');

    // ── [5] Mở sheet "Thêm sản phẩm" ─────────────────────────────────────────
    console.log('\n▶ [5] Tap "Thêm" để mở sheet thêm sản phẩm');
    // Xác minh sheet đã mở thật bằng nhãn chỉ có trên sheet đó — chờ cứng 3.5s
    // rồi đi tiếp là cách cũ đã gõ link vào ô Tiêu đề bộ sưu tập.
    await screen.tapUntilVisible(
      ['Thêm'],
      ['Tìm sản phẩm', 'Người bán'],
      'mo-them-san-pham',
    );
    await dump(driver, 'flow_06_add_product');

    // ── [6] Dán link Shopee (chưa chọn sản phẩm) ─────────────────────────────
    console.log(`\n▶ [6] Dán link Shopee: ${SHOPEE_URL}`);
    await screen.typeIntoLabeledInput(['Tìm sản phẩm'], SHOPEE_URL, 'dan-link-shopee');
    await delay(1500);

    // Gõ xong chưa đủ — phải gửi tìm kiếm (phím Enter) thì kết quả mới hiện
    console.log('   Nhấn Enter để gửi tìm kiếm...');
    await driver.pressKeyCode(66);
    await delay(5000);
    await dump(driver, 'flow_07_after_enter');

    // ── [7] Lọc theo người bán Shopee ────────────────────────────────────────
    // Chỉ dán link là chưa đủ: phải mở bộ lọc "Người bán" rồi chọn "Shopee"
    // thì sản phẩm Shopee mới hiện ra để chọn.
    console.log('\n▶ [7] Mở bộ lọc "Người bán" → chọn "Shopee"');
    await screen.tap(['Người bán'], 'mo-loc-nguoi-ban');
    await delay(3000);
    await dump(driver, 'flow_08_seller_filter');

    await screen.tap(['Shopee'], 'chon-shopee');
    await delay(6000);
    await dump(driver, 'flow_09_search_result');

    console.log('\n✅ DỪNG TẠI ĐÂY — chưa chọn sản phẩm, chưa bấm "Xong"/"Đăng".');
    console.log('   Không có thay đổi nào được lưu lên kênh.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ ${msg}`);
    await dump(driver, 'flow_ERROR').catch(() => {});
    process.exitCode = 1;
  } finally {
    await closeOcr();
    await driver.deleteSession();
  }
}

main();
