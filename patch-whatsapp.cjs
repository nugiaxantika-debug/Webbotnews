const fs = require('fs');
let text = fs.readFileSync('src/services/whatsapp.ts', 'utf8');
const oldLine = '                 // Send as animated sticker\n                 await this.sock.sendMessage(jid, { sticker: buffer }, { quoted: msg });';
const newLine = `                 const { Sticker } = require('wa-sticker-formatter');
                 const sticker = new Sticker(buffer, { pack: 'BratVid', author: 'Bot', type: 'full' });
                 const finalSticker = await sticker.toBuffer();
                 await this.sock.sendMessage(jid, { sticker: finalSticker }, { quoted: msg });`;

if (text.includes(oldLine)) {
    text = text.replace(oldLine, newLine);
    fs.writeFileSync('src/services/whatsapp.ts', text);
    console.log('Success - replaced with CRLF or LF match');
} else {
    // try to split by \r?\n just in case
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex(l => l.includes('// Send as animated sticker'));
    if (idx !== -1) {
        lines[idx] = `                 const { Sticker } = require('wa-sticker-formatter');\n                 const sticker = new Sticker(buffer, { pack: 'BratVid', author: 'Bot', type: 'full' });\n                 const finalSticker = await sticker.toBuffer();`;
        lines[idx+1] = `                 await this.sock.sendMessage(jid, { sticker: finalSticker }, { quoted: msg });`;
        fs.writeFileSync('src/services/whatsapp.ts', lines.join('\n'));
        console.log('Success - replaced by lines');
    } else {
        console.log('Not found');
    }
}
