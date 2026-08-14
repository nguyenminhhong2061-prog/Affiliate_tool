/**
 * Script kiểm tra kết nối ADB và điện thoại Android
 * Chạy: npm run check-adb
 */
import { execSync } from 'child_process';

const ADB = 'C:\\platform-tools\\platform-tools\\adb.exe';

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 });
  } catch (e: any) {
    return e.stdout || e.stderr || e.message || '';
  }
}

async function checkAdb() {
  console.log('=======================================================');
  console.log(' 🔍 KIỂM TRA KẾT NỐI ADB & ANDROID DEVICE');
  console.log('=======================================================');

  // 1. Kiểm tra ADB version
  console.log('\n[1] ADB Version:');
  const version = run(`"${ADB}" version`);
  console.log(version.trim());

  // 2. Kiểm tra thiết bị kết nối
  console.log('\n[2] Danh sách thiết bị:');
  const devices = run(`"${ADB}" devices`);
  console.log(devices.trim());

  const lines = devices.split('\n').filter((l) => l.includes('\t'));
  if (lines.length === 0) {
    console.log('\n❌ KHÔNG có thiết bị nào kết nối!');
    console.log('\n📋 Hướng dẫn kết nối:');
    console.log('  1. Cắm cáp USB vào điện thoại và máy tính');
    console.log('  2. Trên điện thoại: Cài đặt → Tùy chọn nhà phát triển');
    console.log('  3. Bật "Gỡ lỗi qua USB" (USB Debugging)');
    console.log('  4. Chấp nhận hộp thoại "Cho phép gỡ lỗi qua USB" trên điện thoại');
    console.log(`  5. Chạy lại: npm run check-adb`);
    process.exit(1);
  }

  console.log(`\n✅ Tìm thấy ${lines.length} thiết bị:`);
  for (const line of lines) {
    const [serial, status] = line.split('\t');
    console.log(`  → ${serial.trim()} [${status?.trim()}]`);
  }

  // 3. Lấy thông tin thiết bị đầu tiên
  const firstSerial = lines[0].split('\t')[0].trim();
  console.log(`\n[3] Thông tin thiết bị: ${firstSerial}`);

  const manufacturer = run(`"${ADB}" -s ${firstSerial} shell getprop ro.product.manufacturer`).trim();
  const model = run(`"${ADB}" -s ${firstSerial} shell getprop ro.product.model`).trim();
  const androidVersion = run(`"${ADB}" -s ${firstSerial} shell getprop ro.build.version.release`).trim();
  const apiLevel = run(`"${ADB}" -s ${firstSerial} shell getprop ro.build.version.sdk`).trim();

  console.log(`  Hãng: ${manufacturer}`);
  console.log(`  Model: ${model}`);
  console.log(`  Android: ${androidVersion} (API ${apiLevel})`);

  // 4. Kiểm tra YouTube Studio đã cài chưa
  console.log('\n[4] Kiểm tra YouTube Studio app:');
  const ytStudio = run(`"${ADB}" -s ${firstSerial} shell pm list packages | findstr creator`);
  if (ytStudio.includes('creator')) {
    console.log(`  ✅ YouTube Studio đã cài: ${ytStudio.trim()}`);
  } else {
    const ytStudio2 = run(`"${ADB}" -s ${firstSerial} shell pm list packages | findstr youtube`);
    console.log(`  Apps YouTube tìm thấy:\n  ${ytStudio2.trim()}`);
    if (!ytStudio2.includes('creator')) {
      console.log('  ⚠️ Không tìm thấy YouTube Studio. Hãy cài từ Play Store.');
    }
  }

  // 5. In package name chính xác
  console.log('\n[5] Package YouTube Studio:');
  const pkgCheck = run(`"${ADB}" -s ${firstSerial} shell pm list packages -f | findstr creator`);
  console.log(pkgCheck.trim() || '  (không tìm thấy)');

  console.log('\n✅ ADB kiểm tra xong! Thiết bị sẵn sàng cho Appium.');
  console.log(`\n   Serial ID thiết bị: ${firstSerial}`);
  console.log('   Dùng serial này trong cấu hình Appium.\n');
}

checkAdb().catch(console.error);
