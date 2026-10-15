-- 伺服器端強制的限制(架構文件第 9 節)。
--
-- 做兩件事:
--   1. 聊天頻道改成「私有頻道」:瀏覽器可以收、可以登記線上狀態(Presence),
--      但「不能自己發送訊息(Broadcast)」。所有訊息只能由 Edge Function(send)發送。
--   2. 一張頻率計數表,Edge Function 用它限制發送頻率。只存「某個來源在某個時間窗內送了幾次」,
--      不存任何訊息內容。

-- ---------- 1. Realtime 權限 ----------
-- realtime.messages 的 RLS 決定誰能在私有頻道收發。沒有 policy 的動作一律拒絕。
-- 只開放這三個頻道(大廳 lobby、閒聊 room-chat、深夜 room-night,見 src/validate.js 的 ROOMS)。

drop policy if exists "chat: anon can receive" on realtime.messages;
create policy "chat: anon can receive"
  on realtime.messages
  for select
  to anon
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) in ('lobby', 'room-chat', 'room-night')
  );

-- 注意:只允許寫入 presence,沒有 broadcast。所以瀏覽器直接對頻道 send 會被擋下。
drop policy if exists "chat: anon can track presence" on realtime.messages;
create policy "chat: anon can track presence"
  on realtime.messages
  for insert
  to anon
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) in ('lobby', 'room-chat', 'room-night')
  );

-- ---------- 2. 頻率計數 ----------
-- key 是「來源 + 事件」(例如 ip:1.2.3.4:message、nick:lobby:小明:message),
-- 不含任何訊息內容。固定時間窗:窗口過了就從 1 重新算。

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- 開啟 RLS 而且不建立任何 policy:瀏覽器(anon、authenticated)完全碰不到這張表,
-- 只有 Edge Function 用 service_role(會跳過 RLS)才能透過下面的函式使用。
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- 回傳 true 表示這次可以通過,false 表示超過上限。每次呼叫都會計一次(被擋的也算)。
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_ms integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c integer;
  win interval := make_interval(secs => p_window_ms / 1000.0);
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case when now() - r.window_start >= win then now() else r.window_start end,
        count = case when now() - r.window_start >= win then 1 else r.count + 1 end
  returning r.count into c;

  -- 偶爾順手清掉很久沒用的紀錄,表不會一直長大
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '10 minutes';
  end if;

  return c <= p_max;
end;
$$;

-- 只有 service_role(Edge Function)能呼叫
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
