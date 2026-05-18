const fs = require('fs');
let code = fs.readFileSync('src/services/whatsapp.ts', 'utf8');
const search = '❌ Gagal membuat stiker video brat. Error: ${e.message || e}';
const replace = '❌ Gagal membuat stiker video brat. Error:\n${e.stack || e.message || String(e)}';
code = code.replace(search, replace);
fs.writeFileSync('src/services/whatsapp.ts', code);
