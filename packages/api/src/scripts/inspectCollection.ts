/**
 * Xem nội dung thật của một bộ sưu tập trên app (CHỈ ĐỌC — không sửa, không đăng).
 * Mở màn Mua sắm → chọn bộ sưu tập → Chỉnh sửa → cuộn danh sách sản phẩm và
 * đọc tên bằng OCR.
 *
 * Chạy: npx ts-node src/scripts/inspectCollection.ts ["tên bộ sưu tập"]
 */
import { AppiumYoutubeStudio, disposeSharedAppiumSession } from '../automation/appiumYoutubeStudio';
import { closeOcr, readScreen } from '../automation/ocr';
import { Screen } from '../automation/screen';

const COLLECTION = process.argv[2];

async function main() {
  const studio = new AppiumYoutubeStudio();
  studio.setJobId('inspect');

  try {
    await studio.init();
    // openCollectionMenu + Chỉnh sửa được gói trong addProductToCollection nên
    // ở đây ta gọi lại các bước công khai qua reflection tối thiểu.
    const anyStudio = studio as unknown as {
      openShoppingScreen: () => Promise<void>;
      openCollectionMenu: (name?: string) => Promise<string>;
      ui: Screen;
    };

    await anyStudio.openShoppingScreen();
    const name = await anyStudio.openCollectionMenu(COLLECTION);
    console.log(`\n📦 Đang mở bộ sưu tập "${name}"`);

    const ui = anyStudio.ui;
    await ui.waitFor(['Chỉnh sửa'], 'cho-menu', 15000);
    await ui.tap(['Chỉnh sửa'], 'chon-chinh-sua');
    await new Promise((r) => setTimeout(r, 3500));

    console.log('\n📃 Danh sách sản phẩm trong bộ sưu tập:');
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const shot = await ui.snap(`inspect_${i}`);
      const ocr = await readScreen(shot);
      for (const line of ocr.lines) {
        const t = line.text.trim();
        // Bỏ dòng nhiễu: giá, hoa hồng, tên sàn, nhãn giao diện
        if (
          t.length > 12 &&
          line.confidence >= 60 &&
          !/hoa hồng|^shopee$|^lazada$|đ$|₫|Tiêu đề|Mô tả|Sản phẩm|Chỉnh sửa|Đăng/i.test(t)
        ) {
          if (!seen.has(t)) {
            seen.add(t);
            console.log(`   • ${t}`);
          }
        }
      }
      await ui.scrollDown();
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log(`\nTổng cộng đọc được ${seen.size} dòng tên sản phẩm.`);
    console.log('⚠️  KHÔNG bấm "Đăng" — không thay đổi gì.');
  } catch (err: unknown) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await closeOcr();
    await studio.close();
    // Script chạy lẻ: phải đóng hẳn session, không giữ lại cho lần sau
    await disposeSharedAppiumSession();
  }
}

main();
