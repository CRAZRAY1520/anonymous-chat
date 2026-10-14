// Supabase 的連線設定。值不寫在 repo 裡,而是 build 時由環境變數注入(Vite 的 VITE_ 開頭變數):
//   · 部署時:來自 GitHub 的 Settings → Secrets and variables → Actions → Variables
//   · 本機開發:來自專案根目錄的 .env.local(不會被 commit,範例見 .env.example)
//
// 只能放「專案網址」和「公開金鑰(Publishable key,開頭是 sb_publishable_)」。
// 這兩個值本來就是給瀏覽器用的,build 之後會寫進網站的 JavaScript,任何人打開網頁都看得到,
// 所以放在 Variables(不是 Secrets)。
// 絕對不要放 secret key(sb_secret_...)、service_role key 或資料庫密碼。
// 見 docs/architecture.md 第 8 節。

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
