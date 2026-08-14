/**
 * Script kiểm tra kết nối ADB và điện thoại Android
 * Chạy: npm run check-adb
 */
import 'dotenv/config';
import { automationEnv } from '../automation/env';
import { listConnectedDevices, isYoutubeStudioInstalled, runAdb } from '../automation/adb';

async function checkAdb() {
  console.log('=======================================================');
  console.log(' 🔍 KIỂM TRA KẾT NỐI ADB & ANDROID DEVICE');
  console.log('=======================================================');
  console.log(`  ADB path: ${automationEnv.ADB_PATH}`);

  console.log('\n[1] ADB Version:');
  const version = runAdb('version');
  console.log(version.trim() || '(không chạy được adb — kiểm tra ADB_PATH)');

  console.log('\n[2] Danh sách thiết bị:');
  const devices = listConnectedDevices();

  if (devices.length === 0) {
    console.log('  (trống)');
    console.log('\n❌ KHÔNG có thiết bị nào kết nối!');
    console.log('\n📋 Hướng dẫn kết nối:');
    console.log('  1. Cắm cáp USB vào điện thoại và máy tính');
    console.log('  2. Trên điện thoại: Cài đặt → Tùy chọn nhà phát triển');
    console.log('  3. Bật "Gỡ lỗi qua USB" (USB Debugging)');
    console.log('  4. Chấp nhận hộp thoại "Cho phép gỡ lỗi qua USB" trên điện thoại');
    console.log('  5. Chạy lại: npm run check-adb');
    process.exit(1);
  }

  console.log(`\n✅ Tìm thấy ${devices.length} thiết bị:`);
  for (const serial of devices) {
    console.log(`  → ${serial} [device]`);
  }

  const firstSerial = devices[0];
  console.log(`\n[3] Thông tin thiết bị: ${firstSerial}`);

  const manufacturer = runAdb('shell getprop ro.product.manufacturer', firstSerial);
  const model = runAdb('shell getprop ro.product.model', firstSerial);
  const androidVersion = runAdb('shell getprop ro.build.version.release', firstSerial);
  const apiLevel = runAdb('shell getprop ro.build.version.sdk', firstSerial);

  console.log(`  Hãng: ${manufacturer}`);
  console.log(`  Model: ${model}`);
  console.log(`  Android: ${androidVersion} (API ${apiLevel})`);

  console.log('\n[4] Kiểm tra YouTube Studio app:');
  if (isYoutubeStudioInstalled(firstSerial)) {
    console.log('  ✅ YouTube Studio đã cài (com.google.android.apps.youtube.creator)');
  } else {
    console.log('  ⚠️ Không tìm thấy YouTube Studio. Hãy cài từ Play Store.');
  }

  console.log('\n[5] Cấu hình Appium:');
  console.log(`  Host: ${automationEnv.APPIUM_HOST}:${automationEnv.APPIUM_PORT}`);
  console.log(`  Automation mode: ${automationEnv.AUTOMATION_MODE}`);

  console.log('\n✅ ADB kiểm tra xong! Thiết bị sẵn sàng cho Appium.');
  console.log(`\n   Serial ID thiết bị: ${firstSerial}`);
  console.log('   Bước tiếp theo: appium --port 4723 → npm run test-appium\n');
}

checkAdb().catch(console.error);
