# 匿名聊天室

不用註冊、不用登入的匿名聊天室。打開網頁、輸入一個代號,就進到同一個聊天室。訊息不保存,聊完就消失。

**網站:https://crazray1520.github.io/anonymous-chat/**

## 如何確認這個網站由這個 repo 產生

網站沒有建置步驟,**網站上的檔案就是這個 repo `main` 分支的檔案,原樣提供**。可以這樣確認:

1. 打開網站,輸入代號畫面的最下方有「原始碼」連結,指向 https://github.com/CRAZRAY1520/anonymous-chat 。這個連結寫在網頁的 HTML 裡。
2. 本 repo 的 About 欄位填的網站網址就是 https://crazray1520.github.io/anonymous-chat/ ,網站由 **GitHub Actions** 部署:repo 的 **Actions** 頁籤,每次 push 都有一筆「Deploy to GitHub Pages」流程(定義在 `.github/workflows/deploy.yml`);repo 首頁右側的 **Deployments → github-pages** 也有對應的部署紀錄與 commit。
3. 開啟 https://crazray1520.github.io/anonymous-chat/js/transport-supabase.js ,內容和 https://github.com/CRAZRAY1520/anonymous-chat/blob/main/js/transport-supabase.js 完全相同。
4. 網站載入 `js/main.js`,它最上面的 `import { createTransport }` 載入 `js/transport-supabase.js`,裡面用 `createClient(...)` 連 Supabase,設定在 `js/config.js`(專案網址 `ldfxdapblpwkhvcblfkf.supabase.co`)。在瀏覽器開發人員工具的 Network 分頁,可以看到網站對這個網址建立 WebSocket 連線。

這個 repo 曾經叫 `anonymous-chat1`,後來改名。舊 repo 網址會自動轉址到現在的 repo,但舊的網站網址 `.../anonymous-chat1/` 已經失效。

## 怎麼運作

- 網頁(純 HTML、CSS、JavaScript,沒有框架)放在 GitHub Pages。
- 即時傳訊用 [Supabase Realtime](https://supabase.com/docs/guides/realtime):訊息用 Broadcast 傳送,線上名單與進出提示用 Presence。沒有資料庫,也沒有自己的伺服器。

詳細的設計、資料流與限制見 [`docs/architecture.md`](docs/architecture.md),畫面細節見 [`docs/design.md`](docs/design.md),需求見 [`docs/requirements.md`](docs/requirements.md)。

## 程式在哪裡

| 檔案 | 做什麼 |
|---|---|
| `js/transport-supabase.js` | **連 Supabase 的程式**。負責進入與離開頻道、收發訊息、線上名單、斷線重連 |
| `js/main.js` | 總指揮。**最上面的 `import { createTransport } ...` 那一行**載入 `transport-supabase.js`,它是唯一決定「用哪一個收發零件」的地方 |
| `js/config.js` | **Supabase 的設定**:專案網址與公開金鑰(Publishable key) |
| `js/transport-mock.js` | 階段一用的假收發零件(只在同一個瀏覽器的分頁之間互傳),留作測試用 |
| `js/ui.js`、`js/validate.js`、`js/color.js` | 畫面更新、代號與訊息的檢查規則、代號顏色 |
| `tests/` | 單元測試 |
| `.github/workflows/deploy.yml` | **部署流程**:用 GitHub Actions 把 repo 的檔案原樣發佈到 GitHub Pages,沒有建置步驟 |

## 設定與金鑰

- Supabase 的專案網址與公開金鑰都在 `js/config.js`。
- 這兩個值本來就是給瀏覽器用的,可以公開,所以這個檔案**要** commit。
- **絕對不要**把 secret key(`sb_secret_...`)、`service_role` key、資料庫密碼放進這個 repo。

## 不需要安裝任何東西

Supabase 的函式庫(`@supabase/supabase-js`,固定使用 2.117.2 版)是在瀏覽器裡從 **jsDelivr CDN** 載入的,所以不需要 `npm install`,也沒有要打包(build)的步驟。字體(Noto Sans TC)則是從 Google Fonts 載入。

repo 裡有一個 `package.json`,它**只用來執行測試**(`npm test`),裡面沒有任何相依套件。

## 在自己的電腦上看

用任何靜態檔案伺服器在專案資料夾打開都可以,例如:

```
python -m http.server 8080
```

再開 http://127.0.0.1:8080/ 。必須用 `http://` 開啟,直接點兩下 `index.html`(`file://`)瀏覽器會擋掉 JavaScript 模組。

## 測試

```
npm test
```

需要 Node.js(我在 24 版上跑過,太舊的版本可能不支援測試指令用的檔案樣式)。測試涵蓋檢查規則、顏色與假收發零件,不會連到 Supabase。

## 部署

用 GitHub Actions 部署,流程在 `.github/workflows/deploy.yml`。推送到 `main` 分支後會自動執行(通常一到兩分鐘),也可以到 repo 的 **Actions** 頁籤手動執行。流程不需要任何 Secrets,也沒有建置步驟:它把 repo 的檔案原樣上傳並發佈。

第一次使用要在 GitHub 網頁上設定一次:repo 的 **Settings → Pages → Build and deployment → Source**,選 **GitHub Actions**。
