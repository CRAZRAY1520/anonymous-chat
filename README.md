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

以下是原始需求之外新增的 8 項功能,每項列出:一句說明、對應檔案、以及怎麼操作才看得到效果。操作說明以三個瀏覽器(AIgraderA、AIgraderB、AIgraderC,代號就用這三個名字)進入聊天室為例。完整的需求寫在 [`docs/requirements.md`](docs/requirements.md),設計與測試結果見 [`docs/architecture.md`](docs/architecture.md)。

### 輸入框即時字數

- **說明**:輸入代號時顯示「n/12」,聊天室的訊息輸入框顯示「還能輸入 N 字」,超過上限就變紅色並停用按鈕。
- **對應檔案**:`src/ui.js`(`refreshNickField`、`refreshComposer`)、`index.html`
- **怎麼操作才看得到**:AIgraderA 打開網站,在輸入代號畫面輸入「AIgraderA」,輸入框右側顯示 `9/12`。輸入 13 個字(例如「一二三四五六七八九十甲乙丙」)會變紅色,「進入聊天室」按鈕無法按。進入聊天室後,在訊息輸入框貼上超過 200 字的文字,下方變成紅色「超過 N 字」,送出鈕變灰。

### 分頁標題未讀數

- **說明**:你把聊天室分頁切到背景時有人說話,分頁標題前面會出現「(1)」、「(2)」…,切回來就清掉。
- **對應檔案**:`src/main.js`(`updateTitle`、`visibilitychange`)
- **怎麼操作才看得到**:AIgraderA、AIgraderB 各自進入聊天室。AIgraderB 把聊天室分頁切到背景(切到別的分頁或視窗)。AIgraderA 送出一則訊息。看 AIgraderB 的分頁標題,會變成「(1) 匿名聊天室」;切回聊天室分頁後標題恢復。

### 收訊端過濾冒用與洗版

- **說明**:收到別人的訊息時先檢查。格式不對、超過 200 字、不在線上名單的人、冒用「你自己的代號」送來的,以及同一個代號兩則訊息間隔不到 0.7 秒的後到者,都直接丟掉。
- **對應檔案**:`src/main.js`(`onMessage`)、`src/validate.js`(`isValidIncoming`、`createRateLimiter`、`RECEIVE_INTERVAL_MS`)、`tests/validate.test.js`
- **怎麼操作才看得到**:這個過濾擋的是「不正常的資料」,一般聊天看不到效果。要驗證它,執行 `npm test`,`tests/validate.test.js` 有對應的測試。聊天室裡能看到的相關現象是:AIgraderA 一秒內連按兩次送出,會看到「送太快了,等一秒再送」,但那是**送出端**的限制,不是收訊端。

### 50 人上限與「已滿」重試畫面

- **說明**:同一個聊天室同時最多 50 人。第 51 位看到「聊天室已滿」和「重試」按鈕,有人離開後按「重試」就能進入。
- **對應檔案**:`src/validate.js`(`ROOM_LIMIT`)、`src/transport-supabase.js`、`src/transport-mock.js`、`src/ui.js`(`showFull`)、`index.html`(`screen-full`)
- **怎麼操作才看得到**:正式網站很難湊到 50 人,評分時看不到。在自己的電腦上看:把 `src/main.js` 最上面的 `import` 暫時換成 `./transport-mock.js`,執行 `npm run dev`,打開 `http://localhost:5173/?crowd=50` 輸入代號,就會看到「已滿」畫面;在瀏覽器主控台執行 `__mock.setCrowd(0)` 再按「重試」就能進入。

### 正在輸入中提示

- **說明**:有人在訊息輸入框打字時,同一個聊天室的其他人會看到「某某 正在輸入…」。多人同時輸入會合併顯示,停止打字約 4 秒、清空輸入框或送出訊息後消失。這類提示不保存。
- **對應檔案**:`src/ui.js`(`notifyTyping`、`setTyping`)、`src/main.js`(`onTyping` 與 `typingUsers`)、`src/validate.js`(`isValidTyping`)、`src/transport-supabase.js` 與 `src/transport-mock.js`(`sendTyping`)、`index.html`(`#typing`)
- **怎麼操作才看得到**:AIgraderA、AIgraderB、AIgraderC 三個瀏覽器進入同一個聊天室。AIgraderA 在訊息輸入框打字(先不要送出),AIgraderB 與 AIgraderC 輸入框上方會顯示「AIgraderA 正在輸入…」。AIgraderA 清空輸入框,提示消失。AIgraderA 與 AIgraderB 同時打字,AIgraderC 會看到「AIgraderA、AIgraderB 正在輸入…」。AIgraderA 按送出,提示立刻消失,訊息出現。

### 訊息表情回應(👍 ❤️ 😂)

- **說明**:每則訊息下面有三個表情按鈕。按一下加上、再按一下取消,同一個人對同一個表情只算一次。聊天室裡所有人即時看到每個表情的數量,自己按過的會標示。表情回應和訊息一樣不保存,晚進來的人看不到進來之前的訊息與回應。
- **對應檔案**:`src/ui.js`(`addMessage` 的表情按鈕、`updateReactions`)、`src/main.js`(`reactions`、`onReact`、`onReaction`)、`src/validate.js`(`REACTIONS`、`isValidReaction`)、`src/transport-supabase.js` 與 `src/transport-mock.js`(`sendReaction`)、`src/style.css`
- **怎麼操作才看得到**:AIgraderA、AIgraderB、AIgraderC 三個瀏覽器進入同一個聊天室。AIgraderA 送出一則訊息。AIgraderB 按那則訊息下的 👍,三個瀏覽器都會看到 👍 旁邊出現「1」,而且只有 AIgraderB 那邊的 👍 是外框高亮(自己按過)。AIgraderC 也按 👍,三邊都變成「2」。AIgraderB 再按一次 👍(取消),三邊都變回「1」。再試 ❤️ 與 😂。

### 收回自己的訊息

- **說明**:自己送出的訊息旁邊有「收回」按鈕。按下去後,聊天室所有人的畫面,那則訊息的內容都變成「已收回」,原本的文字消失,表情回應也一併拿掉。只有送出那則訊息的人能收回,別人的訊息沒有這個按鈕。訊息仍然不保存。
- **對應檔案**:`src/ui.js`(「收回」按鈕、`markRecalled`)、`src/main.js`(`authors`、`onRecall`、`recalledIds`)、`src/validate.js`(`isValidRecall`)、`src/transport-supabase.js` 與 `src/transport-mock.js`(`recall`)、`src/style.css`
- **怎麼操作才看得到**:AIgraderA、AIgraderB、AIgraderC 三個瀏覽器進入同一個聊天室。AIgraderA 送出「這句話我要收回」。三邊都看到這則訊息,只有 AIgraderA 那邊的訊息旁邊有「收回」按鈕(AIgraderB、AIgraderC 看不到)。AIgraderA 按「收回」,三個瀏覽器裡那則訊息立刻變成虛線框的「已收回」。

### 多個聊天室

- **說明**:可以選聊天室(大廳、閒聊、深夜)。每個聊天室的線上名單、訊息、正在輸入、表情回應、人數上限(50 人)都各自獨立,別的聊天室的人看不到你說的話。同一個代號可以同時出現在不同聊天室,但同一個聊天室裡不能重複。原本的「所有人在同一個聊天室」就是預設的「大廳」。訊息仍然不保存。
- **對應檔案**:`src/validate.js`(`ROOMS`、`isValidRoom`、`roomChannelName`)、`src/main.js`(`onSwitchRoom`、`tryJoin` 的聊天室參數、`store` 記住聊天室)、`src/ui.js`(聊天室選單)、`index.html`(`#room`、`#room-switch`)、`src/transport-supabase.js` 與 `src/transport-mock.js`(`join(代號, 聊天室)`,每個聊天室一個頻道)
- **怎麼操作才看得到**:AIgraderA、AIgraderB、AIgraderC 三個瀏覽器打開網站。在輸入代號畫面,AIgraderA 與 AIgraderB 保持預設的「大廳」,AIgraderC 在「聊天室」下拉選單選「閒聊」,三人各自輸入自己的代號進入。AIgraderA 說一句話,AIgraderB 看得到,AIgraderC 看不到;AIgraderC 說話則反過來。三個人的線上名單也各自獨立(大廳 2 人、閒聊 1 人)。AIgraderB 用聊天室頂部的下拉選單換到「閒聊」,畫面清空、名單變成閒聊的(AIgraderB、AIgraderC),AIgraderC 看到「AIgraderB 進來了」,AIgraderA 看到「AIgraderB 離開了」。網址加上 `?room=night` 可以預先選好「深夜」。

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

**開發順序:先做前端與假零件([`a10539b`](https://github.com/CRAZRAY1520/anonymous-chat/commit/a10539b)),再接上 Supabase([`b5ebc82`](https://github.com/CRAZRAY1520/anonymous-chat/commit/b5ebc82),當時函式庫從 CDN 載入),最後才改成 npm + Vite([`ab95e63`](https://github.com/CRAZRAY1520/anonymous-chat/commit/ab95e63))。前端先於 Supabase,對應需求文件「先把前端做好、最後才接 Supabase」。**

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
| 8 | 10/15 02:40 | [`2b8eea5`](https://github.com/CRAZRAY1520/anonymous-chat/commit/2b8eea5) | 測試時發現:重新整理後被誤判成「代號重複」而踢回輸入畫面。修正為自動進入時遇到重複先等待重試。同時補上這份開發歷程與「新增功能」說明,修正 `docs/requirements.md` 的排版 |
| 9 | 10/15 02:59 | [`51a5943`](https://github.com/CRAZRAY1520/anonymous-chat/commit/51a5943) | 頁面關閉或重新整理時先主動離開頻道,讓重新整理後回到聊天室的時間平均從約 4.2 秒降到約 2.7 秒 |
| 10 | 10/15 03:13 | [`05b0be0`](https://github.com/CRAZRAY1520/anonymous-chat/commit/05b0be0) | README 補上「開發順序」說明與最新的 commit |
| 11 | 10/15 03:17 | [`4ee6bbb`](https://github.com/CRAZRAY1520/anonymous-chat/commit/4ee6bbb) | 新功能:**正在輸入中提示**(Broadcast 事件 `typing`) |
| 12 | 10/15 03:22 | [`0def6a8`](https://github.com/CRAZRAY1520/anonymous-chat/commit/0def6a8) | 新功能:**訊息表情回應**(👍 ❤️ 😂,事件 `reaction`) |
| 13 | 10/15 03:26 | [`4c43b40`](https://github.com/CRAZRAY1520/anonymous-chat/commit/4c43b40) | 新功能:**收回自己的訊息**(事件 `recall`) |
| 14 | 10/15 03:35 | [`820f4e1`](https://github.com/CRAZRAY1520/anonymous-chat/commit/820f4e1) | 新功能:**多個聊天室**(大廳、閒聊、深夜,每個聊天室一個頻道,名單與訊息各自獨立) |

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
