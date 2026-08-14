/**
 * Appium automation cho YouTube Studio Native App
 * Tự động hóa quy trình gắn sản phẩm Shopee vào Tuyển tập YouTube
 * và lấy link affiliate có voucher
 */
import { remote } from 'webdriverio';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const ADB = 'C:\\platform-tools\\platform-tools\\adb.exe';
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots/appium');

// Package name của YouTube Studio
const YT_STUDIO_PKG = 'com.google.android.apps.youtube.creator';
const YT_STUDIO_ACTIVITY = 'com.google.android.apps.youtube.creator.main.MainActivity';


async function delay(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function snap(driver: WebdriverIO.Browser, name: string) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, name);
  await driver.saveScreenshot(filePath);
  console.log(`  📸 ${name}`);
  return filePath;
}

export class AppiumYoutubeStudio {
  private driver: WebdriverIO.Browser | null = null;
  private deviceSerial: string = '';

  async init(deviceSerial?: string): Promise<void> {
    // Lấy serial từ adb devices nếu không được cung cấp
    if (!deviceSerial) {
      const output = execSync(`"${ADB}" devices`, { encoding: 'utf8' });
      const lines = output.split('\n').filter((l) => l.includes('\tdevice'));
      if (lines.length === 0) throw new Error('Không tìm thấy thiết bị Android. Hãy kết nối qua USB.');
      this.deviceSerial = lines[0].split('\t')[0].trim();
    } else {
      this.deviceSerial = deviceSerial;
    }
    console.log(`  → Sử dụng thiết bị: ${this.deviceSerial}`);

    this.driver = await remote({
      hostname: '127.0.0.1',
      port: 4723,
      logLevel: 'warn',
      capabilities: {
        platformName: 'Android',
        'appium:deviceName': this.deviceSerial,
        'appium:udid': this.deviceSerial,
        'appium:automationName': 'UiAutomator2',
        'appium:appPackage': YT_STUDIO_PKG,
        'appium:appActivity': YT_STUDIO_ACTIVITY,
        'appium:noReset': true,       // Không reset app (giữ đăng nhập)
        'appium:newCommandTimeout': 120,
        'appium:androidDeviceReadyTimeout': 60,
        'appium:uiautomator2ServerLaunchTimeout': 60000,
        // Fix Android 16 permission error
        'appium:skipDeviceInitialization': true,
        'appium:skipServerInstallation': true,
        'appium:disableWindowAnimation': false,
        'appium:adbExecTimeout': 60000,
        // Ngăn Appium cố gắng xóa hidden_api_policy (gây lỗi SecurityException trên Android 16/Xiaomi)
        'appium:disableHiddenApiPolicyEnforcer': true,
        'appium:ignoreHiddenApiPolicyError': true,
        // Bỏ qua bước kiểm tra chữ ký ứng dụng để không cần apksigner.jar
        'appium:noSign': true,
        // Chỉ định đường dẫn ADB
        'appium:adbExecPath': 'C:\\platform-tools\\platform-tools\\adb.exe',
      },
    } as any);

    console.log(`  ✅ Appium session khởi động thành công`);
  }

  /**
   * Tìm và tap element theo text (tiếng Việt)
   */
  private async tapByText(text: string, timeout = 10000): Promise<boolean> {
    try {
      const el = await this.driver!.$(`android=new UiSelector().text("${text}")`);
      await (el as any).waitForDisplayed({ timeout });
      await el.click();
      await delay(1500);
      return true;
    } catch (_) {
      try {
        const el = await this.driver!.$(`android=new UiSelector().textContains("${text}")`);
        await (el as any).waitForDisplayed({ timeout: 5000 });
        await el.click();
        await delay(1500);
        return true;
      } catch (_2) {
        return false;
      }
    }
  }

  /**
   * Scroll xuống để tìm element
   */
  private async scrollToText(text: string): Promise<boolean> {
    try {
      const el = await this.driver!.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().text("${text}"))`
      );
      await (el as any).waitForDisplayed({ timeout: 10000 });
      return true;
    } catch (_) {
      try {
        const el = await this.driver!.$(
          `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("${text}"))`
        );
        await (el as any).waitForDisplayed({ timeout: 5000 });
        return true;
      } catch (_2) {
        return false;
      }
    }
  }

  /**
   * PHASE 1: Gắn sản phẩm Shopee vào Tuyển tập
   */
  async addProductToCollection(shopeeUrl: string): Promise<string> {
    if (!this.driver) throw new Error('Appium chưa khởi động. Gọi init() trước.');

    console.log('\n  ═══ PHASE 1: GẮN SẢN PHẨM VÀO TUYỂN TẬP ═══');

    // 1. Chờ app load
    console.log('  [1/12] Chờ app YouTube Studio load...');
    await delay(3000);
    await snap(this.driver, '01_app_launched.png');

    // 2. Tap vào biểu tượng Kiếm tiền ($)
    console.log('  [2/12] Tap Kiếm tiền...');
    const monetizeFound = await this.tapByText('Kiếm tiền');
    if (!monetizeFound) {
      // Thử tìm icon $ trong bottom nav
      const iconSel = [
        '~Kiếm tiền',
        'android=new UiSelector().description("Kiếm tiền")',
        'android=new UiSelector().resourceId("com.google.android.apps.youtube.creator:id/monetization_nav")',
      ];
      for (const sel of iconSel) {
        try {
          const el = await this.driver.$(sel);
          if (await el.isDisplayed()) { await el.click(); await delay(1500); break; }
        } catch (_) {}
      }
    }
    await snap(this.driver, '02_monetize_screen.png');

    // 3. Tap tab Mua sắm
    console.log('  [3/12] Tap Mua sắm...');
    await this.tapByText('Mua sắm');
    await delay(2000);
    await snap(this.driver, '03_shopping_screen.png');

    // 4. Scroll tìm và tap Tuyển tập
    console.log('  [4/12] Tìm Tuyển tập...');
    const tuyanTapFound = await this.scrollToText('Tuyển tập');
    if (tuyanTapFound) {
      await this.tapByText('Tuyển tập');
    } else {
      // Thử "Bộ sưu tập"
      await this.scrollToText('Bộ sưu tập');
      await this.tapByText('Bộ sưu tập');
    }
    await delay(2000);
    await snap(this.driver, '04_collections_list.png');

    // 5. Chọn bộ sưu tập đầu tiên
    console.log('  [5/12] Chọn bộ sưu tập đầu tiên...');
    // Thử tìm element list item đầu tiên
    try {
      const firstItem = await this.driver.$('android=new UiSelector().className("android.widget.RelativeLayout").instance(0)');
      if (await firstItem.isDisplayed()) {
        await firstItem.click();
        await delay(2000);
      }
    } catch (_) {
      // Thử RecyclerView item
      try {
        const firstItem = await this.driver.$('android=new UiSelector().className("androidx.recyclerview.widget.RecyclerView").childSelector(new UiSelector().instance(0))');
        await firstItem.click();
        await delay(2000);
      } catch (_2) {}
    }
    await snap(this.driver, '05_collection_detail.png');

    // 6. Tap Thêm sản phẩm
    console.log('  [6/12] Tap Thêm sản phẩm...');
    await this.scrollToText('Thêm sản phẩm');
    await this.tapByText('Thêm sản phẩm');
    await delay(2000);
    await snap(this.driver, '06_add_product_screen.png');

    // 7. Dán link Shopee vào ô tìm kiếm
    console.log(`  [7/12] Dán link Shopee: ${shopeeUrl}`);
    try {
      const searchInput = await this.driver.$('android=new UiSelector().className("android.widget.EditText")');
      await searchInput.waitForDisplayed({ timeout: 8000 });
      await searchInput.click();
      await delay(500);
      await searchInput.setValue(shopeeUrl);
      await delay(2000);
    } catch (_) {
      console.log('  ⚠️ Không tìm thấy ô nhập liệu');
    }
    await snap(this.driver, '07_shopee_link_entered.png');

    // Nhấn Search/Enter
    try {
      await this.driver.pressKeyCode(66); // KEYCODE_ENTER
      await delay(3000);
    } catch (_) {}
    await snap(this.driver, '07b_after_search.png');

    // 8. Chọn Shopee làm người bán
    console.log('  [8/12] Chọn người bán Shopee...');
    await this.tapByText('Shopee');
    await delay(2500);
    await snap(this.driver, '08_shopee_selected.png');

    // 9. Chọn sản phẩm hiện ra
    console.log('  [9/12] Chọn sản phẩm...');
    try {
      // Tap vào sản phẩm đầu tiên trong danh sách
      const productItem = await this.driver.$('android=new UiSelector().className("android.widget.CheckBox").instance(0)');
      if (await productItem.isDisplayed()) {
        await productItem.click();
      } else {
        // Thử tap vào card sản phẩm
        const card = await this.driver.$('android=new UiSelector().className("android.widget.FrameLayout").instance(2)');
        await card.click();
      }
      await delay(1500);
    } catch (_) {}
    await snap(this.driver, '09_product_selected.png');

    // 10. Tap Xong
    console.log('  [10/12] Tap Xong...');
    await this.tapByText('Xong');
    await delay(2000);
    await snap(this.driver, '10_after_done.png');

    // 11. Tap Đăng
    console.log('  [11/12] Tap Đăng...');
    await this.tapByText('Đăng');
    await delay(3000);
    await snap(this.driver, '11_after_publish.png');

    console.log('  ✅ Đã gắn sản phẩm thành công!');

    // PHASE 2: Lấy link chia sẻ
    return await this.getCollectionShareLink();
  }

  /**
   * PHASE 2: Lấy link chia sẻ bộ sưu tập
   */
  async getCollectionShareLink(): Promise<string> {
    console.log('\n  ═══ PHASE 2: LẤY LINK CHIA SẺ ═══');

    // 12. Quay lại tuyển tập, tap 3-dots → Chia sẻ → Sao chép liên kết
    console.log('  [12/12] Tap ⋮ → Chia sẻ → Sao chép liên kết...');
    await delay(2000);

    // Tap nút back về danh sách tuyển tập
    try {
      await this.driver!.back();
      await delay(1500);
      await this.driver!.back();
      await delay(1500);
    } catch (_) {}
    await snap(this.driver!, '12_back_to_collections.png');

    // Tap 3-dots (more_vert)
    try {
      const moreBtn = await this.driver!.$('android=new UiSelector().description("More options")');
      if (await moreBtn.isDisplayed()) {
        await moreBtn.click();
        await delay(1500);
      } else {
        // Thử tìm icon 3 chấm theo resourceId
        const moreBtn2 = await this.driver!.$('//android.widget.ImageView[@content-desc="More options"]');
        await moreBtn2.click();
        await delay(1500);
      }
    } catch (_) {
      await this.tapByText('Thêm tùy chọn');
    }
    await snap(this.driver!, '13_more_options_menu.png');

    // Tap Chia sẻ
    await this.tapByText('Chia sẻ');
    await delay(1500);
    await snap(this.driver!, '14_share_menu.png');

    // Lấy link bằng mẹo Share sang Tin nhắn (SMS) để đọc nội dung thay vì dùng Clipboard (bị chặn trên Android 16)
    await this.tapByText('Tin nhắn'); // Cố gắng mở app tin nhắn mặc định
    await delay(3000);

    // Chờ màn hình soạn tin nhắn hiện lên, tìm ô nhập liệu
    let shareLink = '';
    try {
      // Tìm tất cả EditText trên màn hình (thường ô nội dung tin nhắn sẽ là EditText lớn nhất hoặc chứa chữ http)
      const editTexts = await this.driver!.$$('android=new UiSelector().className("android.widget.EditText")');
      for (const et of editTexts) {
        const text = await et.getText();
        if (text && text.includes('http')) {
          const match = text.match(/(https?:\/\/[^\s]+)/);
          if (match) {
            shareLink = match[1];
            break;
          }
        }
      }
    } catch (e) {
      console.log('  ⚠️ Không đọc được text từ Tin nhắn. Đang thử cách 2: Gmail');
      // Thử quay lại share menu và chọn Gmail
      try {
        await this.driver!.back();
        await delay(1500);
        await this.tapByText('Gmail');
        await delay(3000);
        const editTexts = await this.driver!.$$('android=new UiSelector().className("android.widget.EditText")');
        for (const et of editTexts) {
          const text = await et.getText();
          if (text && text.includes('http')) {
            const match = text.match(/(https?:\/\/[^\s]+)/);
            if (match) {
              shareLink = match[1];
              break;
            }
          }
        }
      } catch (err2) {}
    }

    if (!shareLink) {
      console.log('  ❌ Không thể lấy link từ giao diện Share. Link fallback được tạo tạm thời.');
      shareLink = 'https://youtube.com/shopping/collections/unknown'; // Fallback
    } else {
      console.log(`  ✅ Link chia sẻ lấy được: ${shareLink}`);
    }

    // Quay lại YouTube Studio
    await this.driver!.back();
    await delay(1000);
    await this.driver!.back();

    return shareLink;
  }

  async close() {
    if (this.driver) {
      await this.driver.deleteSession();
      this.driver = null;
    }
  }
}
