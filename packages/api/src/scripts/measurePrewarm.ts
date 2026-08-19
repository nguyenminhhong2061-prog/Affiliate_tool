/**
 * Ngày 2026-08-18: Script này đã bị vô hiệu hóa vì hệ thống đã chuyển sang dùng
 * HTTP fetch thay cho Playwright trong Phase 3, do đó tính năng prewarm Chromium
 * không còn cần thiết và đã bị gỡ bỏ.
 */

async function main() {
  console.log('Hệ thống hiện tại sử dụng HTTP fetch siêu nhẹ thay vì Playwright.');
  console.log('Tính năng prewarm không còn cần thiết. Vui lòng xem tài liệu CLAUDE.md.');
}

main().then(() => process.exit(0));
