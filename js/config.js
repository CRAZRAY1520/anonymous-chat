// Supabase 的連線設定。階段二才會填,階段一用不到這個檔案。
//
// 這裡只能放「專案網址」和「公開金鑰(anon / publishable key)」。
// 這兩個本來就是給瀏覽器用的,可以公開,這個檔案要 commit。
// 絕對不要放 service_role(secret)key 或資料庫密碼。見 docs/architecture.md 第 8 節。

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
