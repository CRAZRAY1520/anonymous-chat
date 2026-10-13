# 匿名聊天室

一個不用登入的匿名聊天室,網頁放在 GitHub Pages,即時傳訊用 Supabase Realtime。

- 開始任何工作前,先讀 `docs/architecture.md`;畫面細節看 `docs/design.md`。
- 目前在「階段二」:前端已經接上 Supabase(`js/transport-supabase.js`)。階段一的假傳輸層(`js/transport-mock.js`)保留作為測試用,見架構文件第 4 節。
- 不可以把金鑰檔案 commit 進 git。secret key(`sb_secret_...`)、`service_role` key、資料庫密碼、`.env*`、`*.key`、`secrets*` 都不能進 repo。
- `js/config.js` 只放專案網址和公開金鑰(Publishable key,開頭是 `sb_publishable_`),依照架構文件第 8.4 節,這個檔案要 commit。
