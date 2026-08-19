/**
 * Script chẩn đoán (CHỈ ĐỌC — không tap gì cả): mở app YouTube Studio,
 * chụp screenshot + dump toàn bộ cây UI (accessibility tree) ra file XML
 * để xác định đúng resource-id / content-desc / text của các phần tử điều hướng.
 *
 * Chạy: npx ts-node src/scripts/dumpUi.ts [tên-file-output]
 */
import { remote } from 'webdriverio';
import * as fs from 'fs';
import * as path from 'path';
import { automationEnv } from '../automation/env';
import { resolveDeviceSerial } from '../automation/adb';

const OUT_DIR = path.join(__dirname, '../../logs/ui-dumps');
const YT_STUDIO_PKG = 'com.google.android.apps.youtube.creator';
const YT_STUDIO_ACTIVITY = 'com.google.android.apps.youtube.creator.main.MainActivity';

async function main() {
  const label = process.argv[2] ?? 'screen';
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const deviceSerial = await resolveDeviceSerial();
  console.log(`→ Thiết bị: ${deviceSerial}`);
  console.log(`→ Appium: ${automationEnv.APPIUM_HOST}:${automationEnv.APPIUM_PORT}`);

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
      'appium:newCommandTimeout': 120,
      'appium:adbExecPath': automationEnv.ADB_PATH,
    },
  } as any);

  try {
    console.log('⏳ Chờ app load (3s)...');
    await new Promise((r) => setTimeout(r, 3000));

    const xml = await driver.getPageSource();
    const xmlPath = path.join(OUT_DIR, `${label}.xml`);
    fs.writeFileSync(xmlPath, xml, 'utf8');
    console.log(`📄 Đã lưu UI tree: ${xmlPath}`);

    const shotPath = path.join(OUT_DIR, `${label}.png`);
    await driver.saveScreenshot(shotPath);
    console.log(`📸 Đã lưu screenshot: ${shotPath}`);

    // In nhanh các node có text hoặc content-desc (giúp đọc nhanh không cần mở XML)
    const lines = xml.split(/(?<=>)/g).filter((l) => /\btext="[^"]+"|content-desc="[^"]+"/.test(l));
    console.log(`\n📋 Các phần tử có text/content-desc (${lines.length}):`);
    for (const line of lines) {
      const textMatch = line.match(/\btext="([^"]*)"/);
      const descMatch = line.match(/\bcontent-desc="([^"]*)"/);
      const resMatch = line.match(/\bresource-id="([^"]*)"/);
      const classMatch = line.match(/\bclass="([^"]*)"/);
      const clickableMatch = line.match(/\bclickable="([^"]*)"/);
      const text = textMatch?.[1] ?? '';
      const desc = descMatch?.[1] ?? '';
      if (!text && !desc) continue;
      console.log(
        `  [${classMatch?.[1]?.split('.').pop() ?? '?'}] text="${text}" desc="${desc}" id="${resMatch?.[1] ?? ''}" clickable=${clickableMatch?.[1] ?? '?'}`,
      );
    }
  } finally {
    await driver.deleteSession();
  }
}

main().catch((err) => {
  console.error('❌ Lỗi:', err.message);
  process.exitCode = 1;
});
