# 匿名聊天室

一個不用登入的匿名聊天室,網頁放在 GitHub Pages,即時傳訊用 Supabase Realtime。

- 開始任何工作前,先讀 `docs/architecture.md`。
- 目前在「階段一」:只做前端,使用假的傳輸層(`js/transport-mock.js`),還不接 Supabase。
- 不可以把金鑰檔案 commit 進 git。`service_role` key、資料庫密碼、`.env*`、`*.key`、`secrets*` 都不能進 repo。
