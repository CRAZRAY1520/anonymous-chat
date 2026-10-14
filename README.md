# 匿名聊天室

不用註冊、不用登入的匿名聊天室。打開網頁、輸入一個代號,就進到同一個聊天室。訊息不保存,聊完就消失。

**網站:https://crazray1520.github.io/anonymous-chat/**

## 如何確認這個網站由這個 repo 產生

網站是由這個 repo 的 GitHub Actions 流程 build 並部署的。可以這樣確認:

1. 打開網站,輸入代號畫面的最下方有「原始碼」連結,指向 https://github.com/CRAZRAY1520/anonymous-chat 。
2. 本 repo 的 About 欄位填的網站網址就是 https://crazray1520.github.io/anonymous-chat/ 。
3. 部署流程定義在 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):每次 push 到 `main`,它會 `npm ci` 安裝套件、`npm test`、`npm run build`(用 Vite 打包),再把 `dist/` 發佈到 GitHub Pages。repo 的 **Actions** 頁籤可以看到每次執行,repo 首頁右側的 **Deployments → github-pages** 有對應的部署紀錄與 commit。
4. 連 Supabase 的程式在 [`src/transport-supabase.js`](src/transport-supabase.js),最上面是 `import { createClient } from '@supabase/supabase-js'`。這個套件寫在 [`package.json`](package.json) 的 `dependencies`,固定使用 2.117.2 版,精確的相依套件版本記錄在 `package-lock.json`。`src/main.js` 最上面的 `import { createTransport } ...` 那一行載入它。
5. Supabase 的專案網址與公開金鑰存放在 GitHub 的 Actions **Variables**(`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`),build 時由 Vite 注入,程式在 [`src/config.js`](src/config.js) 讀取。在瀏覽器開發人員工具的 Network 分頁,可以看到網站對該專案網址建立 WebSocket 連線。

這個 repo 曾經叫 `anonymous-chat1`,後來改名。舊 repo 網址會自動轉址到現在的 repo,但舊的網站網址 `.../anonymous-chat1/` 已經失效。

## 怎麼運作

- 網頁(純 HTML、CSS、JavaScript,沒有框架,用 Vite 打包)放在 GitHub Pages。
- 即時傳訊用 [Supabase Realtime](https://supabase.com/docs/guides/realtime):訊息用 Broadcast 傳送,線上名單與進出提示用 Presence。沒有資料庫,也沒有自己的伺服器。

詳細的設計、資料流與限制見 [`docs/architecture.md`](docs/architecture.md),畫面細節見 [`docs/design.md`](docs/design.md),需求見 [`docs/requirements.md`](docs/requirements.md)。

## 新增功能

| 功能 | 說明 | 對應檔案 | 怎麼操作才看得到 |
|---|---|---|---|
| **分頁標題未讀數** | 你切到別的分頁時,有人說話,分頁標題前面會出現「(1)」、「(2)」…,切回來就清掉 | `src/main.js`(`updateTitle`、`visibilitychange`) | 開兩個分頁(分頁 A、B),各輸入不同代號進入聊天室。在分頁 A 切換到別的分頁(例如 B),在 B 說一句話,再看分頁 A 的標題 |
| **輸入框即時字數** | 聊天室輸入框下方顯示「還能輸入 N 字」,超過 200 字變紅色「超過 N 字」並停用送出鈕;輸入代號時右側顯示「n/12」,超過 12 字變紅色並停用進入鈕 | `src/ui.js`(`refreshComposer`、`refreshNickField`)、`index.html` | 在輸入代號畫面輸入文字,看輸入框右側的數字;進入聊天室後在輸入框打字或貼上一大段文字,看下方的數字與送出鈕 |
| **收訊端過濾冒用代號與洗版** | 收到別人的訊息時先檢查:格式不對或超過 200 字的丟掉;不在線上名單的代號丟掉;有人冒用「你自己的代號」送來的訊息丟掉;同一個代號兩則訊息間隔不到 0.7 秒,後到的丟掉 | `src/main.js`(`onMessage`)、`src/validate.js`(`isValidIncoming`、`createRateLimiter`、`RECEIVE_INTERVAL_MS`) | 這個過濾擋的是「不正常的資料」,一般聊天看不到效果。要看到:執行 `npm test`,`tests/validate.test.js` 有對應的測試。另外,在聊天室裡一秒內連按兩次送出,會看到送出端的提示「送太快了,等一秒再送」(那是送出端的限制) |
| **50 人上限與「已滿」重試畫面** | 聊天室同時最多 50 人,第 51 位會看到「聊天室已滿」畫面和「重試」按鈕;有人離開後按「重試」就能進入 | `src/validate.js`(`ROOM_LIMIT`)、`src/transport-supabase.js`、`src/ui.js`(`showFull`)、`index.html`(`screen-full`) | 正式網站很難湊到 50 人。在自己的電腦上看:把 `src/main.js` 最上面的 `import` 暫時換成 `./transport-mock.js`,執行 `npm run dev`,打開 `http://localhost:5173/?crowd=50`(假裝已有 50 人),輸入代號就會看到「已滿」畫面;在瀏覽器主控台執行 `__mock.setCrowd(0)` 再按「重試」就能進入 |

這四項我都用瀏覽器自動化實測過(包括用 50 個原始連線占滿真的 Supabase 頻道測「已滿」),結果記錄在 [`docs/architecture.md`](docs/architecture.md) 第 13 節。

## 程式在哪裡

| 檔案 | 做什麼 |
|---|---|
| `src/transport-supabase.js` | **連 Supabase 的程式**。負責進入與離開頻道、收發訊息、線上名單、斷線重連 |
| `src/main.js` | 總指揮。最上面的 `import { createTransport } ...` 那一行載入 `transport-supabase.js`,它是唯一決定「用哪一個收發零件」的地方 |
| `src/config.js` | 讀取 Supabase 的專案網址與公開金鑰(來自環境變數,見下一節) |
| `src/transport-mock.js` | 階段一用的假收發零件(只在同一個瀏覽器的分頁之間互傳),留作測試用 |
| `src/ui.js`、`src/validate.js`、`src/color.js`、`src/style.css` | 畫面更新、代號與訊息的檢查規則、代號顏色、外觀 |
| `index.html`、`vite.config.js` | 網頁入口、Vite 設定 |
| `package.json`、`package-lock.json` | 依賴套件(`@supabase/supabase-js`、`vite`)與指令 |
| `.github/workflows/deploy.yml` | **部署流程**:build 之後發佈到 GitHub Pages |
| `tests/` | 單元測試 |

## 開發歷程

以下依 `git log` 的實際紀錄整理(時間是 UTC+8,2026 年)。完整紀錄見 [commits](https://github.com/CRAZRAY1520/anonymous-chat/commits/main)。

| 順序 | 時間 | commit | 做了什麼 |
|---|---|---|---|
| 1 | 10/13 15:13–15:23 | [`8487c73`](https://github.com/CRAZRAY1520/anonymous-chat/commit/8487c73)、[`ffb77af`](https://github.com/CRAZRAY1520/anonymous-chat/commit/ffb77af)、[`05037e3`](https://github.com/CRAZRAY1520/anonymous-chat/commit/05037e3) | 建立 repo,寫下並補完需求(`docs/requirements.md`) |
| 2 | 10/13 15:39–15:51 | [`9a1136e`](https://github.com/CRAZRAY1520/anonymous-chat/commit/9a1136e)、[`7bde952`](https://github.com/CRAZRAY1520/anonymous-chat/commit/7bde952)、[`41e7e86`](https://github.com/CRAZRAY1520/anonymous-chat/commit/41e7e86) | 先寫文件再寫程式:架構文件(`docs/architecture.md`)、`CLAUDE.md`、畫面設計(`docs/design.md`) |
| 3 | 10/13 16:10 | [`a10539b`](https://github.com/CRAZRAY1520/anonymous-chat/commit/a10539b) `frontend stage 1` | **先做前端與假零件**:畫面、輸入檢查、線上名單、捲動、未讀數都完成,收發訊息用 `transport-mock.js`(只在同一個瀏覽器的分頁之間互傳),放上 GitHub Pages 就能看到效果。13 個檔案 |
| 4 | 10/13 16:55 | [`b5ebc82`](https://github.com/CRAZRAY1520/anonymous-chat/commit/b5ebc82) `frontend stage 2` | **再接上 Supabase**:新增 `transport-supabase.js`,`main.js` 只改一行 `import`。當時 Supabase 函式庫是從 jsDelivr CDN 用動態 `import()` 載入 |
| 5 | 10/13 18:13–19:22 | [`d82c371`](https://github.com/CRAZRAY1520/anonymous-chat/commit/d82c371)、[`86e6d52`](https://github.com/CRAZRAY1520/anonymous-chat/commit/86e6d52)、[`11096c9`](https://github.com/CRAZRAY1520/anonymous-chat/commit/11096c9)、[`d54e6fa`](https://github.com/CRAZRAY1520/anonymous-chat/commit/d54e6fa) 等 | 實測後的修正與補強:擋掉冒用自己代號的訊息、收訊端間隔調為 0.7 秒避免誤丟訊息、repo 改名後更新網址、輸入代號畫面加上原始碼連結、函式庫改成最上面的一般 `import` |
| 6 | 10/15 01:37 | [`b765fef`](https://github.com/CRAZRAY1520/anonymous-chat/commit/b765fef) | 新增 GitHub Actions 部署流程(當時仍不需要 build,直接上傳 repo 檔案) |
| 7 | 10/15 01:55 | [`ab95e63`](https://github.com/CRAZRAY1520/anonymous-chat/commit/ab95e63) | **改成 npm + Vite**:`js/`、`css/` 搬到 `src/`(其中 6 個檔案只是改名、內容完全沒變),把函式庫改成 npm 套件(`@supabase/supabase-js` 2.117.2),Supabase 設定改由 Actions Variables 在 build 時注入,部署流程改成 build 後上傳 `dist/` |

說明:

- 這個順序是刻意的,對應需求文件「先把前端做好、最後才接 Supabase」。因為收發訊息被獨立成一個零件,從第 3 步到第 4 步,畫面程式沒有重寫。
- 第 7 步**不是只有搬移**:除了搬移之外,還改了 `transport-supabase.js` 最上面的 `import`(7 行)、`config.js`(改讀環境變數)、`index.html` 的路徑、測試檔的 `import` 路徑,並新增 `vite.config.js`、`package.json` 的依賴、`package-lock.json`、`.env.example`,改寫 `deploy.yml`。聊天室的畫面與邏輯沒有改。
- 這個 repo 原本叫 `anonymous-chat1`,在第 5 步中改名為 `anonymous-chat`。

## 設定與金鑰

Supabase 的專案網址與公開金鑰**不寫在原始碼裡**,build 時由環境變數注入:

| 情境 | 放在哪裡 |
|---|---|
| 部署到 GitHub Pages | repo 的 Settings → Secrets and variables → Actions → **Variables**:`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` |
| 本機開發 | 專案根目錄的 `.env.local`(不會被 commit),格式見 `.env.example` |

- 這兩個值本來就是給瀏覽器用的公開值,build 之後會寫進網站的 JavaScript,任何人打開網頁都看得到,所以放 Variables,不是 Secrets。**放進 Variables 不會讓它變成機密。**
- **絕對不要**把 secret key(`sb_secret_...`)、`service_role` key、資料庫密碼放進這個 repo。

## 在自己的電腦上開發

需要 Node.js(我在 24 版上跑過;`@supabase/supabase-js` 要求 22 以上)。

```
npm install                 # 安裝套件
cp .env.example .env.local  # 然後把 .env.local 裡的兩個值改成自己的
npm run dev                 # 開發伺服器,改程式會即時更新
npm run build               # 打包成 dist/,和 GitHub Actions 做的事一樣
npm run preview             # 預覽打包後的版本
```

## 測試

```
npm test
```

測試涵蓋檢查規則、顏色與假收發零件,不會連到 Supabase。

## 部署

用 GitHub Actions 部署,流程在 `.github/workflows/deploy.yml`。推送到 `main` 分支後會自動執行(通常一到兩分鐘),也可以到 repo 的 **Actions** 頁籤手動執行。

第一次使用要在 GitHub 網頁上設定:

1. **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
2. **Settings → Secrets and variables → Actions → Variables**,新增 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。沒設定的話,build 會直接失敗,不會發佈一個連不上 Supabase 的網站。
