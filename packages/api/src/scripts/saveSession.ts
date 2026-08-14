import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');

async function saveSession() {
  console.log('===========================================================');
  console.log(' 🌐 HƯỚNG DẪN LƯU PHIÊN ĐĂNG NHẬP YOUTUBE STUDIO (SESSION)');
  console.log('===========================================================');
  console.log('1. Trình duyệt Chrome thật sẽ mở ra.');
  console.log('2. Vui lòng đăng nhập tài khoản Google / YouTube Studio.');
  console.log('3. Điều hướng tới trang YouTube Studio Shopping.');
  console.log('4. Quay lại Terminal và nhấn phím ENTER để lưu session.\n');

  // Đảm bảo thư mục session tồn tại
  const sessionDir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  // Khởi chạy Google Chrome thật (channel: 'chrome') với các cờ chống bị Google chặn đăng nhập
  const launchOptions: any = {
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'], // Tắt cờ automation để Google không phát hiện bot
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--start-maximized',
    ],
  };

  // Thử dùng Chrome cài sẵn trên máy (Google Accounts tin tưởng Chrome hơn Chromium thuần)
  try {
    launchOptions.channel = 'chrome';
  } catch {
    // Fallback sang Chromium mặc định nếu máy không có Chrome
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  // Ẩn navigator.webdriver đối với Google Login
  await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });");

  const page = await context.newPage();

  await page.goto('https://studio.youtube.com');

  console.log('👉 Trình duyệt đã mở. Vui lòng hoàn tất đăng nhập trên trình duyệt...');
  console.log('   Sau khi đăng nhập thành công vào YouTube Studio, hãy quay lại đây và nhấn Enter...');

  // Chờ người dùng nhấn ENTER trong console
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  // Lưu storageState
  await context.storageState({ path: SESSION_PATH });
  console.log(`\n✅ ĐÃ LƯU SESSION THÀNH CÔNG VÀO: ${SESSION_PATH}`);

  await browser.close();
  process.exit(0);
}

saveSession().catch((err) => {
  console.error('❌ Lỗi khi lưu session:', err);
  process.exit(1);
});
