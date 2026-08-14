/**
 * Appium automation cho YouTube Studio Native App
 * Tự động hóa quy trình gắn sản phẩm Shopee vào Tuyển tập YouTube
 * và lấy link chia sẻ bộ sưu tập (Phase 1 + Phase 2 mobile)
 */
import { remote } from 'webdriverio';
import * as path from 'path';
import * as fs from 'fs';
import { automationEnv } from './env';
import { getDeviceClipboard, resolveDeviceSerial } from './adb';

const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots/appium');

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
  private deviceSerial = '';
  private jobId = 'manual';

  /** Gán jobId để đặt tên screenshot khi chạy từ worker */
  setJobId(jobId: string) {
    this.jobId = jobId;
  }

  async init(deviceSerial?: string): Promise<void> {
    this.deviceSerial = resolveDeviceSerial(deviceSerial);
    console.log(`  → Thiết bị: ${this.deviceSerial}`);
    console.log(`  → Appium: ${automationEnv.APPIUM_HOST}:${automationEnv.APPIUM_PORT}`);

    this.driver = await remote({
      hostname: automationEnv.APPIUM_HOST,
      port: automationEnv.APPIUM_PORT,
      logLevel: 'warn',
      capabilities: {
        platformName: 'Android',
        'appium:deviceName': this.deviceSerial,
        'appium:udid': this.deviceSerial,
        'appium:automationName': 'UiAutomator2',
        'appium:appPackage': YT_STUDIO_PKG,
        'appium:appActivity': YT_STUDIO_ACTIVITY,
        'appium:noReset': true,
        'appium:newCommandTimeout': 120,
        'appium:androidDeviceReadyTimeout': 60,
        'appium:uiautomator2ServerLaunchTimeout': 60000,
        'appium:skipDeviceInitialization': true,
        'appium:skipServerInstallation': true,
        'appium:disableWindowAnimation': false,
        'appium:adbExecTimeout': 60000,
        'appium:disableHiddenApiPolicyEnforcer': true,
        'appium:ignoreHiddenApiPolicyError': true,
        'appium:noSign': true,
        'appium:adbExecPath': automationEnv.ADB_PATH,
      },
    } as any);

    console.log('  ✅ Appium session khởi động thành công');
  }

  private ss(name: string) {
    if (!this.driver) return Promise.resolve('');
    return snap(this.driver, `${this.jobId}_${name}`);
  }

  private async tapByText(text: string, timeout = 10000): Promise<boolean> {
    try {
      const el = await this.driver!.$(`android=new UiSelector().text("${text}")`);
      await (el as any).waitForDisplayed({ timeout });
      await el.click();
      await delay(1500);
      return true;
    } catch {
      try {
        const el = await this.driver!.$(`android=new UiSelector().textContains("${text}")`);
        await (el as any).waitForDisplayed({ timeout: 5000 });
        await el.click();
        await delay(1500);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async scrollToText(text: string): Promise<boolean> {
    try {
      const el = await this.driver!.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().text("${text}"))`,
      );
      await (el as any).waitForDisplayed({ timeout: 10000 });
      return true;
    } catch {
      try {
        const el = await this.driver!.$(
          `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textContains("${text}"))`,
        );
        await (el as any).waitForDisplayed({ timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * PHASE 1: Gắn sản phẩm Shopee vào Tuyển tập, trả về link chia sẻ bộ sưu tập
   */
  async addProductToCollection(shopeeUrl: string): Promise<string> {
    if (!this.driver) throw new Error('Appium chưa khởi động. Gọi init() trước.');

    console.log('\n  ═══ PHASE 1: GẮN SẢN PHẨM VÀO TUYỂN TẬP ═══');

    console.log('  [1/12] Chờ app YouTube Studio load...');
    await delay(3000);
    await this.ss('01_app_launched.png');

    console.log('  [2/12] Tap Kiếm tiền...');
    const monetizeFound = await this.tapByText('Kiếm tiền');
    if (!monetizeFound) {
      const iconSel = [
        '~Kiếm tiền',
        'android=new UiSelector().description("Kiếm tiền")',
        'android=new UiSelector().resourceId("com.google.android.apps.youtube.creator:id/monetization_nav")',
      ];
      for (const sel of iconSel) {
        try {
          const el = await this.driver.$(sel);
          if (await el.isDisplayed()) {
            await el.click();
            await delay(1500);
            break;
          }
        } catch {
          // thử selector tiếp theo
        }
      }
    }
    await this.ss('02_monetize_screen.png');

    console.log('  [3/12] Tap Mua sắm...');
    await this.tapByText('Mua sắm');
    await delay(2000);
    await this.ss('03_shopping_screen.png');

    console.log('  [4/12] Tìm Tuyển tập...');
    const tuyanTapFound = await this.scrollToText('Tuyển tập');
    if (tuyanTapFound) {
      await this.tapByText('Tuyển tập');
    } else {
      await this.scrollToText('Bộ sưu tập');
      await this.tapByText('Bộ sưu tập');
    }
    await delay(2000);
    await this.ss('04_collections_list.png');

    console.log('  [5/12] Chọn bộ sưu tập đầu tiên...');
    try {
      const firstItem = await this.driver.$(
        'android=new UiSelector().className("android.widget.RelativeLayout").instance(0)',
      );
      if (await firstItem.isDisplayed()) {
        await firstItem.click();
        await delay(2000);
      }
    } catch {
      try {
        const firstItem = await this.driver.$(
          'android=new UiSelector().className("androidx.recyclerview.widget.RecyclerView").childSelector(new UiSelector().instance(0))',
        );
        await firstItem.click();
        await delay(2000);
      } catch {
        // bỏ qua nếu không tap được
      }
    }
    await this.ss('05_collection_detail.png');

    console.log('  [6/12] Tap Thêm sản phẩm...');
    await this.scrollToText('Thêm sản phẩm');
    await this.tapByText('Thêm sản phẩm');
    await delay(2000);
    await this.ss('06_add_product_screen.png');

    console.log(`  [7/12] Dán link Shopee: ${shopeeUrl}`);
    try {
      const searchInput = await this.driver.$(
        'android=new UiSelector().className("android.widget.EditText")',
      );
      await searchInput.waitForDisplayed({ timeout: 8000 });
      await searchInput.click();
      await delay(500);
      await searchInput.setValue(shopeeUrl);
      await delay(2000);
    } catch {
      console.log('  ⚠️ Không tìm thấy ô nhập liệu');
    }
    await this.ss('07_shopee_link_entered.png');

    try {
      await this.driver.pressKeyCode(66);
      await delay(3000);
    } catch {
      // ignore
    }
    await this.ss('07b_after_search.png');

    console.log('  [8/12] Chọn người bán Shopee...');
    await this.tapByText('Shopee');
    await delay(2500);
    await this.ss('08_shopee_selected.png');

    console.log('  [9/12] Chọn sản phẩm...');
    try {
      const productItem = await this.driver.$(
        'android=new UiSelector().className("android.widget.CheckBox").instance(0)',
      );
      if (await productItem.isDisplayed()) {
        await productItem.click();
      } else {
        const card = await this.driver.$(
          'android=new UiSelector().className("android.widget.FrameLayout").instance(2)',
        );
        await card.click();
      }
      await delay(1500);
    } catch {
      // ignore
    }
    await this.ss('09_product_selected.png');

    console.log('  [10/12] Tap Xong...');
    await this.tapByText('Xong');
    await delay(2000);
    await this.ss('10_after_done.png');

    console.log('  [11/12] Tap Đăng...');
    await this.tapByText('Đăng');
    await delay(3000);
    await this.ss('11_after_publish.png');

    console.log('  ✅ Đã gắn sản phẩm thành công!');
    return this.getCollectionShareLink();
  }

  /**
   * PHASE 2 (mobile): ⋮ → Chia sẻ → Sao chép liên kết → đọc clipboard qua ADB
   */
  async getCollectionShareLink(): Promise<string> {
    if (!this.driver) throw new Error('Appium chưa khởi động.');

    console.log('\n  ═══ PHASE 2: LẤY LINK CHIA SẺ ═══');
    console.log('  [12/12] Tap ⋮ → Chia sẻ → Sao chép liên kết...');
    await delay(2000);

    try {
      await this.driver.back();
      await delay(1500);
      await this.driver.back();
      await delay(1500);
    } catch {
      // ignore
    }
    await this.ss('12_back_to_collections.png');

    try {
      const moreBtn = await this.driver.$('android=new UiSelector().description("More options")');
      if (await moreBtn.isDisplayed()) {
        await moreBtn.click();
        await delay(1500);
      } else {
        const moreBtn2 = await this.driver.$('//android.widget.ImageView[@content-desc="More options"]');
        await moreBtn2.click();
        await delay(1500);
      }
    } catch {
      await this.tapByText('Thêm tùy chọn');
    }
    await this.ss('13_more_options_menu.png');

    await this.tapByText('Chia sẻ');
    await delay(1500);
    await this.ss('14_share_menu.png');

    // Cách 1: Sao chép liên kết + đọc clipboard qua ADB
    const copied =
      (await this.tapByText('Sao chép liên kết')) ||
      (await this.tapByText('Copy link')) ||
      (await this.tapByText('Sao chép URL'));

    if (copied) {
      await delay(1000);
      const clipLink = getDeviceClipboard(this.deviceSerial);
      const match = clipLink.match(/(https?:\/\/[^\s]+)/);
      if (match) {
        console.log(`  ✅ Link chia sẻ (clipboard): ${match[1]}`);
        return match[1];
      }
    }

    // Cách 2: Share sang Tin nhắn / Gmail để đọc URL
    let shareLink = await this.extractLinkFromShareTarget('Tin nhắn');
    if (!shareLink) {
      shareLink = await this.extractLinkFromShareTarget('Gmail');
    }

    if (!shareLink) {
      throw new Error('Không thể lấy link chia sẻ bộ sưu tập từ YouTube Studio app');
    }

    console.log(`  ✅ Link chia sẻ: ${shareLink}`);
    return shareLink;
  }

  private async extractLinkFromShareTarget(appLabel: string): Promise<string> {
    try {
      await this.tapByText(appLabel);
      await delay(3000);

      const editTexts = await this.driver!.$$(
        'android=new UiSelector().className("android.widget.EditText")',
      );
      for (const et of editTexts) {
        const text = await et.getText();
        if (text && text.includes('http')) {
          const match = text.match(/(https?:\/\/[^\s]+)/);
          if (match) {
            await this.driver!.back().catch(() => {});
            await delay(500);
            await this.driver!.back().catch(() => {});
            return match[1];
          }
        }
      }
      await this.driver!.back().catch(() => {});
    } catch {
      // thử app khác
    }
    return '';
  }

  async close() {
    if (this.driver) {
      await this.driver.deleteSession();
      this.driver = null;
    }
  }
}
