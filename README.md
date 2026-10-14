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
