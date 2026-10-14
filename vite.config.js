import { defineConfig } from 'vite';

// base: './' 讓打包後的檔案都用相對路徑。網站放在 GitHub Pages 的子路徑
// (https://<帳號>.github.io/<repo 名稱>/)下,檔案才找得到,repo 改名也不受影響。
export default defineConfig({
  base: './',
});
