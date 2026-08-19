/**
 * Kiểm tra thiết bị Android đã sẵn sàng chạy job chưa.
 * Chạy: npx ts-node src/scripts/checkDevice.ts
 *
 * Dùng trước khi khởi động server, và để chẩn đoán khi job liên tục thất bại.
 */
import { preflightCheck, readDeviceStatus, findDeviceWithRetry } from '../automation/deviceHealth';
import { automationEnv } from '../automation/env';

async function main() {
  console.log('════════════════════════════════════════════════');
  console.log(' 🔍 KIỂM TRA THIẾT BỊ ANDROID');
  console.log('════════════════════════════════════════════════');
  console.log(`  ADB: ${automationEnv.ADB_PATH}`);
  console.log(`  Serial cấu hình: ${automationEnv.ANDROID_DEVICE_SERIAL || '(tự chọn máy đầu tiên)'}`);
  console.log(`  Chế độ automation: ${automationEnv.AUTOMATION_MODE}\n`);

  try {
    const serial = await findDeviceWithRetry();
    const before = await readDeviceStatus(serial);
    console.log('Trạng thái trước khi chuẩn bị:');
    console.log(`  Màn hình bật:  ${before.screenOn ? 'có' : 'KHÔNG'}`);
    console.log(`  Đang khoá:     ${before.locked ? 'CÓ' : 'không'}`);
    console.log(`  Pin:           ${before.batteryLevel}%`);
    console.log(`  YT Studio:     ${before.studioInstalled ? 'đã cài' : 'CHƯA CÀI'}\n`);

    await preflightCheck();

    console.log('\n✅ Thiết bị sẵn sàng nhận job.');
  } catch (err: unknown) {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main();

