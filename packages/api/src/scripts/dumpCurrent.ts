/**
 * Dump màn hình ĐANG hiển thị (không điều hướng, không khởi động lại app).
 * Dùng để khảo sát selector của bất kỳ màn nào bạn đang mở trên điện thoại.
 *
 * Chạy: npx ts-node src/scripts/dumpCurrent.ts <tên-file>
 */
import { remote } from 'webdriverio';
import * as fs from 'fs';
import * as path from 'path';
import { automationEnv } from '../automation/env';
import { resolveDeviceSerial } from '../automation/adb';
import { parseNodes } from '../automation/uiFinder';

const OUT_DIR = path.join(__dirname, '../../logs/ui-dumps');

async function main() {
  const label = process.argv[2] ?? 'current';
  const deviceSerial = await resolveDeviceSerial();

  const driver = await remote({
    hostname: automationEnv.APPIUM_HOST,
    port: automationEnv.APPIUM_PORT,
    logLevel: 'warn',
    capabilities: {
      platformName: 'Android',
      'appium:deviceName': deviceSerial,
      'appium:udid': deviceSerial,
      'appium:automationName': 'UiAutomator2',
      'appium:noReset': true,
      'appium:autoLaunch': false, // KHÔNG khởi động lại app — giữ nguyên màn đang mở
      'appium:newCommandTimeout': 180,
      'appium:adbExecPath': automationEnv.ADB_PATH,
    },
  } as any);

  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const xml = await driver.getPageSource();
    fs.writeFileSync(path.join(OUT_DIR, `${label}.xml`), xml, 'utf8');
    await driver.saveScreenshot(path.join(OUT_DIR, `${label}.png`));

    const nodes = parseNodes(xml);
    const labelled = nodes.filter((n) => n.text || n.desc);
    console.log(`📄 ${label}: ${nodes.length} node, ${labelled.length} có nhãn\n`);
    for (const n of labelled) {
      const cls = n.className.split('.').pop();
      const b = n.bounds;
      console.log(
        `  [${cls}]${n.clickable ? ' (clickable)' : ''} "${n.text || n.desc}" [${b.x1},${b.y1}][${b.x2},${b.y2}]`,
      );
    }
    console.log(`\n  Tổng node clickable: ${nodes.filter((n) => n.clickable).length}`);
  } finally {
    await driver.deleteSession();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exitCode = 1;
});
