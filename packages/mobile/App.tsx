import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';

import { ApiRequestError, createJob, getJob } from './src/api';
import { getUserId } from './src/userId';
import {
  POLL_INTERVAL_MS,
  POLL_INTERVAL_QUEUED_MS,
  POLL_TIMEOUT_MS,
} from './src/config';

/**
 * Màn hình duy nhất: dán link Shopee → bấm "Lấy link" → nhận link affiliate.
 *
 * Vì sao vẫn có trạng thái chờ dù giao diện chỉ cần 1 ô + 1 nút: hệ thống là
 * hàng đợi bất đồng bộ, một job đo thật ~40 giây khi hàng đợi trống và ~50 giây
 * cho job đầu sau quãng nghỉ (điều khiển app YouTube Studio trên điện thoại thật).
 * Không hiển thị tiến trình thì màn hình đứng im gần một phút và người dùng sẽ
 * tưởng app treo.
 *
 * Con số hiển thị phải khớp thực tế đo được (CLAUDE.md §10.6) — nó từng ghi
 * "khoảng 2 phút" từ thời job mất 123 giây, thừa gấp ba sau các đợt tối ưu.
 */
type Phase = 'idle' | 'working' | 'done' | 'error';

/** Số lần gọi API lỗi liên tiếp được bỏ qua khi đang chờ (mạng chập chờn) */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export default function App() {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [waitInfo, setWaitInfo] = useState('Đang gửi yêu cầu…');
  const [affiliateUrl, setAffiliateUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const pollErrorsRef = useRef(0);

  // ─── Đồng hồ đếm thời gian đã chờ ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'working') return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // ─── Hỏi lại trạng thái job cho tới khi xong ───────────────────────────────
  useEffect(() => {
    if (phase !== 'working' || !jobId) return;

    let cancelled = false;
    const startedAt = Date.now();
    pollErrorsRef.current = 0;

    /**
     * Hỏi một lượt. Trả về số ms nên chờ trước lượt kế, hoặc `null` để DỪNG hẳn
     * (job đã xong/hỏng, hoặc đã chuyển sang màn lỗi).
     */
    const check = async (): Promise<number | null> => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (cancelled) return null;
        setErrorMessage(
          'Đã chờ quá lâu mà chưa có kết quả. Job có thể vẫn đang chạy — thử lại sau ít phút.',
        );
        setPhase('error');
        return null;
      }

      try {
        const job = await getJob(jobId);
        if (cancelled) return null;
        pollErrorsRef.current = 0;

        if (job.status === 'done') {
          if (job.result) {
            setAffiliateUrl(job.result.affiliate_url);
            setExpiresAt(job.result.expires_at);
            setPhase('done');
          } else {
            // Job xong nhưng link đã hết hạn TTL trong Redis. Không bịa link cũ —
            // người dùng phải tạo lại để nhận link còn hiệu lực.
            setErrorMessage('Link đã hết hạn. Bấm "Lấy link" lần nữa để tạo link mới.');
            setPhase('error');
          }
          return null;
        }

        if (job.status === 'failed') {
          setErrorMessage(job.error_message ?? 'Job thất bại, không rõ nguyên nhân.');
          setPhase('error');
          return null;
        }

        // Còn pending / processing → cập nhật dòng trạng thái, và chọn nhịp hỏi
        // theo đúng trạng thái vừa nhận (xem config.ts).
        if (job.status === 'processing') {
          setWaitInfo('Đang gắn sản phẩm vào YouTube…');
          return POLL_INTERVAL_MS;
        }

        // Còn người phía trước → chắc chắn còn ít nhất một job ~35 giây nữa mới
        // tới lượt mình, hỏi mỗi giây ở đây là hỏi lại cùng một câu trả lời.
        if (job.queue_position && job.queue_position > 1) {
          setWaitInfo(`Đang xếp hàng — còn ${job.queue_position - 1} người trước bạn`);
          return POLL_INTERVAL_QUEUED_MS;
        }

        // Sắp tới lượt (hoặc chưa biết vị trí) → giữ nhịp nhanh. Khi hàng đợi
        // trống, job chỉ ở `pending` khoảng 250ms rồi chạy ngay; chậm nhịp ở đây
        // sẽ làm người dùng chờ thêm hàng chục giây cho một job đã xong từ lâu.
        setWaitInfo('Đang chờ tới lượt…');
        return POLL_INTERVAL_MS;
      } catch (err) {
        if (cancelled) return null;

        // Mạng chập chờn giữa chừng không nên làm hỏng cả job đang chạy trên
        // điện thoại. Chỉ bỏ cuộc khi lỗi lặp lại liên tiếp.
        pollErrorsRef.current += 1;
        if (pollErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
          setErrorMessage(
            err instanceof ApiRequestError ? err.message : 'Mất kết nối tới server.',
          );
          setPhase('error');
          return null;
        }
        // Lỗi lẻ tẻ: vẫn hỏi tiếp theo nhịp thường. Chuỗi setTimeout chỉ hẹn lượt
        // kế sau khi lượt này kết thúc, nên request không thể dồn đống lên nhau.
        return POLL_INTERVAL_MS;
      }
    };

    // Vòng TỰ LÊN LỊCH thay cho setInterval, vì hai lý do:
    //
    // 1. Ở nhịp 1 giây, `setInterval` có thể bắn lượt mới trong khi lượt trước
    //    CHƯA trả lời — mạng chậm một nhịp là các request chồng lên nhau và càng
    //    làm nghẽn thêm. Chuỗi setTimeout chỉ hẹn lượt kế SAU KHI lượt này xong,
    //    nên khoảng cách giữa hai request luôn được đảm bảo.
    //
    // 2. Nhịp phải đổi được GIỮA CHỪNG: 35 giây khi còn người xếp hàng phía trước,
    //    1 giây khi sắp tới lượt hoặc đang chạy. Chu kỳ của `setInterval` thì cố
    //    định từ lúc tạo, còn ở đây `check()` trả về số ms cho đúng lượt kế tiếp.
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      const nextDelay = await check();
      if (cancelled || nextDelay === null) return;
      timer = setTimeout(loop, nextDelay);
    };

    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, jobId]);

  // ─── Bấm nút "Lấy link" ────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setErrorMessage('Chưa có link. Dán link sản phẩm Shopee vào ô trên.');
      setPhase('error');
      return;
    }

    setPhase('working');
    setJobId(null);
    setAffiliateUrl('');
    setExpiresAt(null);
    setErrorMessage('');
    setElapsed(0);
    setCopied(false);
    setWaitInfo('Đang gửi yêu cầu…');

    try {
      const userId = await getUserId();
      const created = await createJob(userId, trimmed);

      setJobId(created.jobId);
      setWaitInfo(
        created.resumed
          ? 'Bạn đang có một yêu cầu chạy dở — đang lấy kết quả của yêu cầu đó.'
          : created.queuePosition && created.queuePosition > 1
            ? `Đang xếp hàng — còn ${created.queuePosition - 1} người trước bạn`
            : 'Đang chờ tới lượt…',
      );
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Không gửi được yêu cầu.',
      );
      setPhase('error');
    }
  }, [url]);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(affiliateUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [affiliateUrl]);

  const handleReset = useCallback(() => {
    setPhase('idle');
    setJobId(null);
    setAffiliateUrl('');
    setExpiresAt(null);
    setErrorMessage('');
    setCopied(false);
  }, []);

  const busy = phase === 'working';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <StatusBar style="dark" />

        <Text style={styles.title}>Lấy link áp voucher</Text>

        <TextInput
          style={[styles.input, busy && styles.inputDisabled]}
          value={url}
          onChangeText={setUrl}
          placeholder="Dán link sản phẩm Shopee"
          placeholderTextColor="#9AA0A6"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
          multiline
        />

        <Pressable
          style={({ pressed }) => [
            styles.button,
            busy && styles.buttonDisabled,
            pressed && !busy && styles.buttonPressed,
          ]}
          onPress={handleSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Lấy link</Text>
          )}
        </Pressable>

        {/* ── Đang chờ ────────────────────────────────────────────────────── */}
        {phase === 'working' && (
          <View style={styles.panel}>
            <Text style={styles.waitText}>{waitInfo}</Text>
            <Text style={styles.waitSub}>
              Đã chờ {formatElapsed(elapsed)} · thường mất khoảng 40-60 giây
            </Text>
          </View>
        )}

        {/* ── Có kết quả ──────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <View style={styles.panel}>
            <Text style={styles.resultLabel}>Link đã áp voucher</Text>
            <Text style={styles.resultUrl} selectable>
              {affiliateUrl}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.copyButton, pressed && styles.buttonPressed]}
              onPress={handleCopy}
            >
              <Text style={styles.copyButtonText}>{copied ? 'Đã sao chép' : 'Sao chép'}</Text>
            </Pressable>

            {expiresAt && (
              <Text style={styles.expiryNote}>Link có hạn đến {formatClock(expiresAt)}</Text>
            )}

            <Pressable onPress={handleReset}>
              <Text style={styles.resetLink}>Lấy link khác</Text>
            </Pressable>
          </View>
        )}

        {/* ── Lỗi ─────────────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <View style={[styles.panel, styles.errorPanel]}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable onPress={handleReset}>
              <Text style={styles.resetLink}>Thử lại</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Helper hiển thị ──────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} phút ${s} giây` : `${s} giây`;
}

/** Giờ hết hạn dạng HH:MM để người dùng biết còn bao lâu */
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 48,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#16181A',
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#16181A',
    minHeight: 88,
    textAlignVertical: 'top',
  },
  inputDisabled: { backgroundColor: '#F5F6F7', color: '#5F6368' },
  button: {
    marginTop: 16,
    backgroundColor: '#D0021B',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: '#E88A95' },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  panel: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F5F6F7',
  },
  waitText: { fontSize: 15, color: '#16181A', fontWeight: '500' },
  waitSub: { marginTop: 6, fontSize: 13, color: '#5F6368' },
  resultLabel: { fontSize: 13, color: '#5F6368', marginBottom: 8 },
  resultUrl: { fontSize: 14, color: '#16181A', lineHeight: 20 },
  copyButton: {
    marginTop: 16,
    backgroundColor: '#16181A',
    borderRadius: 10,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  expiryNote: { marginTop: 12, fontSize: 13, color: '#5F6368' },
  resetLink: {
    marginTop: 16,
    fontSize: 15,
    color: '#1A73E8',
    fontWeight: '500',
  },
  errorPanel: { backgroundColor: '#FDECEE' },
  errorText: { fontSize: 15, color: '#A50E0E', lineHeight: 21 },
});
