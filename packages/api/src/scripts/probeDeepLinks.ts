/**
 * Dò xem YouTube Studio có tuyến deep link nào mở SÂU hơn màn "Mua sắm" không.
 *
 * ── Vì sao đáng dò ───────────────────────────────────────────────────────────
 * Bước `mo-sheet-chinh-sua` (deep link → màn Mua sắm → thẻ bộ sưu tập → menu ngữ
 * cảnh → "Chỉnh sửa" → sheet) đo được 19,8-33,5 giây, tức 40-65% một job. Nếu có
 * URL mở thẳng vào bộ sưu tập thì phần lớn quãng đó biến mất.
 *
 * Cơ chế có tồn tại: intent filter của app là wildcard trên `studio.youtube.com`
 * KHÔNG giới hạn path (kiểm bằng `dumpsys package`), nên mọi đường dẫn đều được
 * giao cho MainActivity và app tự định tuyến bên trong.
 *
 * ── Vì sao phải có nhóm đối chứng ────────────────────────────────────────────
 * App nhận MỌI path, nên một URL bịa cũng "mở được" — nó chỉ rơi về màn mặc định.
 * Nếu chỉ nhìn "app có mở không" thì URL nào cũng có vẻ thành công. Phải so với:
 *
 *   ĐỐI CHỨNG : một path chắc chắn vô nghĩa → cho biết màn mặc định trông thế nào
 *   MỐC       : path đang dùng thật (.../monetization/shopping) → màn Mua sắm
 *
 * Ứng viên nào cho ra tập nhãn KHÁC cả hai mới đáng quan tâm.
 *
 * CHỈ ĐỌC: bắn intent rồi dump cây a11y. Không tap, không sửa gì.
 *
 *   npx ts-node src/scripts/probeDeepLinks.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { remote } from 'webdriverio';
import { runAdbArgs } from '../automation/adb';
import { preflightCheck } from '../automation/deviceHealth';
import { automationEnv } from '../automation/env';

const PKG = 'com.google.android.apps.youtube.creator';
const ACT = 'com.google.android.apps.youtube.creator.main.MainActivity';
const OUT_DIR = path.join(__dirname, '../../logs/ui-dumps/deeplink');

const CH = automationEnv.YT_CHANNEL_ID;
/** Mã bộ sưu tập bóc từ link chia sẻ công khai */
const COLLECTION_ID = 'SCUCNWkaKv5uJZkFrKH503EWIKyAPnZzfJZqg';

/** Nhãn chỉ có trên sheet chỉnh sửa bộ sưu tập (dump flow_05_collection_edit) */
const EDIT_SHEET_MARKERS = ['Chỉnh sửa bộ sưu tập', 'Đăng', 'Tải ảnh bìa mới lên'];

interface Candidate {
  ten: string;
  url: string;
  loai: 'doi-chung' | 'moc' | 'ung-vien';
}

const CANDIDATES: Candidate[] = [
  {
    ten: 'ĐỐI CHỨNG — path vô nghĩa',
    url: `https://studio.youtube.com/channel/${CH}/monetization/shopping/khong-ton-tai-xyz123`,
    loai: 'doi-chung',
  },
  {
    ten: 'MỐC — path đang dùng thật',
    url: `https://studio.youtube.com/channel/${CH}/monetization/shopping`,
    loai: 'moc',
  },
  {
    ten: 'ứng viên: /shopping/collections',
    url: `https://studio.youtube.com/channel/${CH}/monetization/shopping/collections`,
    loai: 'ung-vien',
  },
  {
    ten: 'ứng viên: /shopping/collection/<id>',
    url: `https://studio.youtube.com/channel/${CH}/monetization/shopping/collection/${COLLECTION_ID}`,
    loai: 'ung-vien',
  },
  {
    ten: 'ứng viên: /shopping/collections/<id>',
    url: `https://studio.youtube.com/channel/${CH}/monetization/shopping/collections/${COLLECTION_ID}`,
    loai: 'ung-vien',
  },
  {
    ten: 'ứng viên: /shopping?collection=<id>',
    url: `https://studio.youtube.com/channel/${CH}/monetization/shopping?collection=${COLLECTION_ID}`,
    loai: 'ung-vien',
  },
  {
    ten: 'ứng viên: /shopcollection/<id>',
    url: `https://studio.youtube.com/shopcollection/${COLLECTION_ID}`,
    loai: 'ung-vien',
  },
  {
    ten: 'ứng viên: /channel/<ch>/shopcollection/<id>',
    url: `https://studio.youtube.com/channel/${CH}/shopcollection/${COLLECTION_ID}`,
    loai: 'ung-vien',
  },
];

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function labelsOf(xml: string): string[] {
  const out = new Set<string>();
  const re = /(?:text|content-desc)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const v = m[1].trim();
    if (v) out.add(v);
  }
  return [...out];
}

async function main() {
  if (!CH) throw new Error('Thiếu YT_CHANNEL_ID');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const status = await preflightCheck();
  const serial = status.serial;

  const driver = await remote({
    hostname: automationEnv.APPIUM_HOST,
    port: automationEnv.APPIUM_PORT,
    logLevel: 'error',
    capabilities: {
      platformName: 'Android',
      'appium:deviceName': serial,
      'appium:udid': serial,
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': PKG,
      'appium:appActivity': ACT,
      'appium:noReset': true,
      'appium:newCommandTimeout': 600,
      'appium:adbExecPath': automationEnv.ADB_PATH,
    },
  } as any);

  const ket: Array<{ c: Candidate; labels: string[] }> = [];

  try {
    for (const c of CANDIDATES) {
      // Trạng thái sạch cho từng lượt: không force-stop thì deep link chỉ được
      // giao cho instance đang chạy và app có thể giữ nguyên màn hình cũ, khiến
      // ta tưởng URL không có tác dụng.
      await runAdbArgs(['shell', 'am', 'force-stop', PKG], serial);
      await delay(1200);
      await runAdbArgs(
        ['shell', `am start -a android.intent.action.VIEW -d '${c.url}' -p ${PKG}`],
        serial,
      );
      await delay(6000); // rộng tay: đang dò, không phải đang tối ưu

      const xml = await driver.getPageSource();
      const labels = labelsOf(xml);
      fs.writeFileSync(
        path.join(OUT_DIR, `${c.ten.replace(/[^a-zA-Z0-9]+/g, '_')}.xml`),
        xml,
        'utf8',
      );
      ket.push({ c, labels });
      console.log(`  ${c.loai.padEnd(10)} ${c.ten}`);
      console.log(`      ${labels.length} nhãn: ${labels.slice(0, 10).join(' | ')}`);
    }
  } finally {
    await driver.deleteSession();
  }

  const doiChung = ket.find((k) => k.c.loai === 'doi-chung')!.labels;
  const moc = ket.find((k) => k.c.loai === 'moc')!.labels;

  console.log('\n┌─ PHÂN TÍCH ───────────────────────────────────────────────────');
  console.log(`│ ĐỐI CHỨNG (path vô nghĩa) : ${doiChung.length} nhãn`);
  console.log(`│ MỐC (màn Mua sắm)         : ${moc.length} nhãn`);
  const giongNhau =
    doiChung.length === moc.length && doiChung.every((l) => moc.includes(l));
  console.log(
    `│ Đối chứng ${giongNhau ? 'GIỐNG' : 'KHÁC'} mốc → path vô nghĩa ${
      giongNhau ? 'rơi về đúng màn Mua sắm' : 'rơi về màn khác'
    }`,
  );
  console.log('│');

  for (const { c, labels } of ket) {
    if (c.loai !== 'ung-vien') continue;
    const khacDoiChung = labels.filter((l) => !doiChung.includes(l));
    const khacMoc = labels.filter((l) => !moc.includes(l));
    const coSheet = EDIT_SHEET_MARKERS.filter((m) => labels.includes(m));

    let ketLuan: string;
    if (coSheet.length >= 2) ketLuan = `🎯 MỞ ĐƯỢC SHEET CHỈNH SỬA (${coSheet.join(', ')})`;
    else if (khacMoc.length === 0) ketLuan = '❌ y hệt màn Mua sắm — app bỏ qua phần path thừa';
    else ketLuan = `🔎 khác mốc ${khacMoc.length} nhãn: ${khacMoc.slice(0, 6).join(' | ')}`;

    console.log(`│ ${c.ten}`);
    console.log(`│    ${ketLuan}`);
    console.log(`│    (khác đối chứng ${khacDoiChung.length} nhãn)`);
  }
  console.log('└───────────────────────────────────────────────────────────────');
  console.log(`\nDump lưu ở: ${OUT_DIR}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
