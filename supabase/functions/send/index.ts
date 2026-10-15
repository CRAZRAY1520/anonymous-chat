// 發送訊息的 Edge Function:聊天室裡「唯一能發送訊息的地方」。
//
// 頻道是私有的,瀏覽器沒有發送(Broadcast)的權限(見 supabase/migrations),
// 所以所有訊息、輸入中提示、表情回應、收回都要經過這裡。
// 這裡檢查格式、字詞、頻率,通過才轉發給頻道。訊息只是經過,不保存。
//
// 管理金鑰:SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 是 Supabase 自動提供給 Edge Function 的環境變數,
// 不需要(也不可以)寫進 repo,我們沒有另外設定任何 secret。
import { handleSend, MAX_BODY_BYTES } from '../_shared/handle.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// 網站在 github.io,函式在 supabase.co,是不同來源,所以要回應 CORS。
// 沒有 cookie 或登入資料,所以允許任何來源;擋人靠的是函式裡的檢查,不是來源。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const serviceHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// 頻率計數放在資料庫的 rate_limits 表,只存次數(見 migration)
async function checkRate(key: string, max: number, windowMs: number): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_rate_limit`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ p_key: key, p_max: max, p_window_ms: windowMs }),
  });
  if (!res.ok) throw new Error(`check_rate_limit ${res.status}: ${await res.text()}`);
  return (await res.json()) === true;
}

// 用 Realtime 的 REST 介面轉發到私有頻道(服務端金鑰可以發送,不受瀏覽器那邊的權限限制)
async function broadcast(topic: string, event: string, payload: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
  });
  if (!res.ok) throw new Error(`broadcast ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, reason: 'badRequest', message: '只接受 POST。' });

  // 先擋太大的請求,再讀內容
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { ok: false, reason: 'invalid', message: '內容太大。' });
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json(413, { ok: false, reason: 'invalid', message: '內容太大。' });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, reason: 'badRequest', message: '格式不正確。' });
  }

  // 來源位址:Supabase 的閘門會把真正的用戶位址放在 x-forwarded-for 的第一個
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';

  const result = await handleSend(body, { ip }, { checkRate, broadcast, now: Date.now });
  return json(result.status, result.body);
});
