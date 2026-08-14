import { AppiumYoutubeStudio } from './appiumYoutubeStudio';
import { extractAffiliateFromCollection } from './collectionAffiliateExtractor';
import { listConnectedDevices } from './adb';
import { automationEnv } from './env';

export interface TagProductParams {
  jobId: string;
  shopeeUrl: string;
  shopeeProductId?: string | null;
}

export interface TagProductResult {
  affiliateUrl: string;
  voucher: string;
}

function buildSimulationResult(jobId: string): TagProductResult {
  const mockHash = jobId.slice(0, 8);
  return {
    affiliateUrl: `https://s.shopee.vn/affiliate_sim_${mockHash}`,
    voucher: `VOUCHER_SIM_${Math.floor(1000 + Math.random() * 9000)}`,
  };
}

function shouldUseSimulation(): boolean {
  if (automationEnv.AUTOMATION_MODE === 'simulation') return true;
  if (automationEnv.AUTOMATION_MODE !== 'appium') return true;

  const devices = listConnectedDevices();
  if (devices.length === 0) {
    console.warn('[Automation] Không có thiết bị Android — chuyển sang chế độ simulation');
    return true;
  }
  return false;
}

/**
 * Pipeline đầy đủ theo automation.md:
 * 1. Appium — gắn sản phẩm Shopee vào Tuyển tập trên YouTube Studio app
 * 2. Appium — lấy link chia sẻ bộ sưu tập
 * 3. Playwright — mở link bộ sưu tập, trích xuất affiliate + voucher
 */
export async function tagShopeeProductOnYoutube(
  params: TagProductParams,
): Promise<TagProductResult> {
  const { jobId, shopeeUrl } = params;
  console.log(`[Automation] 🚀 Bắt đầu Job ID: ${jobId}`);

  if (shouldUseSimulation()) {
    console.log('[Automation] ℹ️ Chế độ simulation — trả kết quả mock');
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    return buildSimulationResult(jobId);
  }

  const studio = new AppiumYoutubeStudio();
  studio.setJobId(jobId);

  try {
    console.log('[Automation] [1/3] Kết nối Appium + thiết bị Android...');
    await studio.init();

    console.log('[Automation] [2/3] Gắn sản phẩm vào Tuyển tập (Appium)...');
    const collectionShareUrl = await studio.addProductToCollection(shopeeUrl);

    if (!collectionShareUrl || !collectionShareUrl.startsWith('http')) {
      throw new Error(`Link chia sẻ bộ sưu tập không hợp lệ: ${collectionShareUrl}`);
    }

    console.log('[Automation] [3/3] Trích xuất link affiliate (Playwright)...');
    const { affiliateUrl, voucher } = await extractAffiliateFromCollection(collectionShareUrl, {
      shopeeUrl,
      jobId,
    });

    console.log(`[Automation] ✅ Hoàn thành Job ${jobId}`);
    return { affiliateUrl, voucher };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Automation] ❌ Job ${jobId} thất bại: ${message}`);

    if (message.includes('ECONNREFUSED') || message.includes('connect')) {
      throw new Error(
        '[Appium Failed] Không kết nối được Appium server. Hãy chạy: appium --port 4723',
      );
    }

    throw new Error(`[Automation Failed] ${message}`);
  } finally {
    await studio.close();
  }
}
