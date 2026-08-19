import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Mã người dùng gắn với lần cài đặt app này.
 *
 * TẠM THỜI: backend chưa có xác thực — `user_id` được nhận thẳng từ client
 * (xem TODO trong packages/api/src/db/schema.ts). App sinh một mã ngẫu nhiên
 * lúc chạy lần đầu rồi giữ lại, để chốt chặn "mỗi người chỉ 1 job đang chạy"
 * phía server hoạt động đúng giữa các lần mở app.
 *
 * Khi backend có JWT/Firebase thì thay hàm này bằng id thật của tài khoản.
 * Đây KHÔNG phải là cơ chế bảo mật: người dùng đổi mã là vượt được giới hạn.
 */
const STORAGE_KEY = 'affiliate.user_id';

/** UUID v4 đủ dùng để phân biệt thiết bị. Không dùng cho mục đích bảo mật. */
function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cached: string | null = null;

export async function getUserId(): Promise<string> {
  if (cached) return cached;

  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  if (saved) {
    cached = saved;
    return saved;
  }

  const created = randomId();
  await AsyncStorage.setItem(STORAGE_KEY, created);
  cached = created;
  return created;
}
