# 匿名聊天室

一個不用登入的匿名聊天室,網頁放在 GitHub Pages,即時傳訊用 Supabase Realtime。純 JavaScript(沒有框架),用 Vite 打包,Supabase 函式庫用 npm 安裝。

- 開始任何工作前,先讀 `docs/architecture.md`;畫面細節看 `docs/design.md`。
- 目前在「階段二」:前端已經接上 Supabase(`src/transport-supabase.js`)。階段一的假傳輸層(`src/transport-mock.js`)保留作為測試用,見架構文件第 4 節。
- 常用指令:`npm install`、`npm run dev`、`npm run build`、`npm run preview`、`npm test`。
- 不可以把金鑰檔案 commit 進 git。secret key(`sb_secret_...`)、`service_role` key、資料庫密碼、`.env*`(只有 `.env.example` 可以)、`*.key`、`secrets*` 都不能進 repo。
- Supabase 的專案網址與公開金鑰(Publishable key,開頭是 `sb_publishable_`)**不寫在原始碼裡**:部署時放 GitHub Actions 的 Variables(`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`),本機放 `.env.local`(已被 `.gitignore` 擋掉)。`src/config.js` 只負責讀取。見架構文件第 8.4 節。
