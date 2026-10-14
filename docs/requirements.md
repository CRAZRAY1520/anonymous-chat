# 需求說明

## 這是什麼

一個不用登入的匿名聊天室。所有人在同一個聊天室裡。

## 誰會用

任何知道網站連結的人都可以進來用，可以用電腦，也可以用手機來操作。

## 使用的流程

1. 打開網頁
2. 輸入一個代號
3. 進入聊天室，看到其他人的訊息，也可以送出訊息

## 畫面上要有

- 誰在線上
- 有人進來或離開時要有提示

## 不需要的

- 註冊、登入

## 技術上我知道的

- 網頁放在 GitHub Pages
- 即時傳訊用 Supabase，透過 WebSocket
- 畫面設計用 /design，前端用 /frontend-design 做出來

## 做事的順序

1. 先把前端做好，放上 GitHub Pages 看得到
2. 最後才接上 Supabase

## 我不知道、需要你幫我決定並解釋的

- 前端要用什麼語言和框架
- Supabase 要怎麼設定
- 金鑰怎麼產生、要放在哪裡

## 新增功能

以下功能不在上面的原始需求裡,是之後新增的。評分時可以用三個瀏覽器(AIgraderA、AIgraderB、AIgraderC,代號就用這三個名字)進入同一個聊天室來看效果。

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
