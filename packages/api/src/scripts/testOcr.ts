/**
 * Kiểm chứng OCR trên ảnh chụp màn hình đã có (không cần điện thoại).
 * Chạy: npx ts-node src/scripts/testOcr.ts <đường-dẫn-ảnh> [nhãn cần tìm...]
 */
import * as path from 'path';
import { readScreen, locateLabel, closeOcr } from '../automation/ocr';

async function main() {
  const imgArg = process.argv[2] ?? '../../logs/ui-dumps/shopping_screen.png';
  const imgPath = path.isAbsolute(imgArg) ? imgArg : path.join(__dirname, imgArg);
  const labels = process.argv.slice(3);

  console.log(`🔍 OCR: ${imgPath}`);
  const t0 = Date.now();
  const ocr = await readScreen(imgPath);
  console.log(`⏱  Mất ${((Date.now() - t0) / 1000).toFixed(1)}s — ${ocr.lines.length} dòng\n`);

  console.log('📃 Các dòng đọc được:');
  for (const l of ocr.lines) {
    if (!l.text) continue;
    console.log(`   [${l.confidence.toFixed(0)}%] "${l.text}" @(${l.bbox.x0},${l.bbox.y0})`);
  }

  if (labels.length > 0) {
    console.log('\n🎯 Kết quả tìm nhãn:');
    for (const label of labels) {
      const hit = locateLabel(ocr, label);
      console.log(
        hit
          ? `   ✅ "${label}" → tap tại (${hit.x},${hit.y}) [khớp "${hit.matched}", ${hit.confidence.toFixed(0)}%]`
          : `   ❌ "${label}" → KHÔNG tìm thấy`,
      );
    }
  }

  await closeOcr();
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exitCode = 1;
});
