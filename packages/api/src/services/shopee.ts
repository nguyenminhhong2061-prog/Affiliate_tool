import type { ShopeeProduct } from '../types';

// ─── Parse Shopee URL → Product ID ────────────────────────────────────────────
//
// Hỗ trợ các format phổ biến của Shopee Vietnam:
//   Format 1: https://shopee.vn/ten-san-pham-i.SELLER_ID.PRODUCT_ID
//   Format 2: https://shopee.vn/product/SELLER_ID/PRODUCT_ID
//   Format 3: https://shope.ee/SHORTCODE (link rút gọn - chưa hỗ trợ)
//
// TODO: Tích hợp Shopee Affiliate Open API để lấy thông tin thật
//       Hiện tại dùng mock data để phát triển và test
// ─────────────────────────────────────────────────────────────────────────────

const SHOPEE_URL_PATTERNS = [
  // Format 1: /ten-sp-i.123456.789012
  /shopee\.vn\/.+-i\.(\d+)\.(\d+)/,
  // Format 2: /product/123456/789012
  /shopee\.vn\/product\/(\d+)\/(\d+)/,
];

/**
 * Parse Shopee URL để lấy sellerId và productId
 * @returns { sellerId, productId } hoặc null nếu không parse được
 */
export function parseShopeeUrl(url: string): { sellerId: string; productId: string } | null {
  for (const pattern of SHOPEE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return {
        sellerId: match[1],
        productId: match[2],
      };
    }
  }
  return null;
}

/**
 * Kiểm tra xem URL có phải là link Shopee hợp lệ không
 */
export function isValidShopeeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isShopee =
      parsed.hostname === 'shopee.vn' ||
      parsed.hostname === 'shope.ee' ||
      parsed.hostname === 's.shopee.vn' ||
      parsed.hostname === 'vn.shp.ee' ||
      parsed.hostname === 'shp.ee';
    return isShopee;
  } catch {
    return false;
  }
}

// ─── Mock: Lấy thông tin sản phẩm ────────────────────────────────────────────
// Trả về dữ liệu giả lập. Thay bằng Shopee API thật sau.

const MOCK_PRODUCTS = [
  { name: 'Tai nghe Bluetooth Sony WH-1000XM5', image: 'https://cf.shopee.vn/file/sg-11134201-22120-8y7vu9u3gvlvb0' },
  { name: 'Giày thể thao Nike Air Max 270', image: 'https://cf.shopee.vn/file/sg-11134201-23010-s3tph8tceomv78' },
  { name: 'Bình nước thủy tinh 1L Thermos', image: 'https://cf.shopee.vn/file/sg-11134201-22110-dv5jzrr6t4kv52' },
  { name: 'Đồng hồ thông minh Samsung Galaxy Watch 6', image: 'https://cf.shopee.vn/file/sg-11134201-23010-mv6rk2pfbnmva7' },
  { name: 'Máy lọc không khí Xiaomi Air Purifier 4 Pro', image: 'https://cf.shopee.vn/file/sg-11134201-22110-9xjjf6s8vqlv7c' },
];

/**
 * Lấy thông tin sản phẩm Shopee (MOCK)
 * Trong thực tế: gọi Shopee Affiliate API với productId
 */
export async function fetchShopeeProduct(
  shopeeUrl: string,
  productId: string,
  _sellerId: string,
): Promise<ShopeeProduct> {
  // Giả lập delay API call (100-300ms)
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

  // Chọn mock product dựa trên productId để nhất quán
  const idx = parseInt(productId.slice(-1), 10) % MOCK_PRODUCTS.length;
  const mock = MOCK_PRODUCTS[idx];

  return {
    productId,
    name: mock.name,
    imageUrl: mock.image,
    originalUrl: shopeeUrl,
  };
}
