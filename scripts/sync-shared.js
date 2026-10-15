// 把 src/validate.js 複製到 supabase/functions/_shared/rules.js。
// Edge Function 部署時只會帶 supabase/functions 底下的檔案,所以檢查規則要有一份在那裡。
// 規則只有一個來源(src/validate.js);改了它之後執行 npm run sync:shared。
// tests/server-handle.test.js 會檢查兩份內容一致,忘了同步 npm test 就會失敗。
import { readFileSync, writeFileSync } from 'node:fs';

const HEADER = '// 這個檔案是 src/validate.js 的複本,由 npm run sync:shared 產生,請不要直接修改。\n';
const src = readFileSync(new URL('../src/validate.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(new URL('../supabase/functions/_shared/rules.js', import.meta.url), HEADER + src);
console.log('已同步 supabase/functions/_shared/rules.js');
