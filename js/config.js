// Supabase 的連線設定(階段二)。
//
// 這裡只能放「專案網址」和「公開金鑰(Publishable key,開頭是 sb_publishable_)」。
// 這兩個本來就是給瀏覽器用的,任何人打開網頁都看得到,可以公開,所以這個檔案要 commit。
// 絕對不要放 secret key(sb_secret_...)、service_role key 或資料庫密碼。
// 見 docs/architecture.md 第 8 節。

export const SUPABASE_URL = 'https://ldfxdapblpwkhvcblfkf.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TSsjzUGcRZzr3uLIgbuObA_1UQkYLlk';
