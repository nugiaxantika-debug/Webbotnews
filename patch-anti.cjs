const fs = require('fs');
let code = fs.readFileSync('src/services/whatsapp.ts', 'utf8');

// 1. Remove the private Sets from class definition
code = code.replace(/private antiVideoGroups = new Set<string>\(\);\n\s+private antiFotoGroups = new Set<string>\(\);\n\s+private antiFoto1xGroups = new Set<string>\(\);\n\s+private antiStikerGroups = new Set<string>\(\);\n\s+private antiSpamGroups = new Set<string>\(\);\n\s+private antiTagSwGroups = new Set<string>\(\);\n\s+private antiVirtexGroups = new Set<string>\(\);\n\s+private antiToxicGroups = new Set<string>\(\);\n/, '');

// 2. Change groupSettings map definition to include anti settings
code = code.replace(
  /private groupSettings = new Map<string, \{ welcomeEnabled\?\: boolean, welcomeMessage\?\: string, goodbyeEnabled\?\: boolean, goodbyeMessage\?\: string \}>\(\);/,
  "private groupSettings = new Map<string, { welcomeEnabled?: boolean, welcomeMessage?: string, goodbyeEnabled?: boolean, goodbyeMessage?: string, antivideo?: boolean, antifoto?: boolean, antifoto1x?: boolean, antistiker?: boolean, antispam?: boolean, antitagsw?: boolean, antivirtex?: boolean, antitoxic?: boolean, antilinkall?: boolean }>();"
);

// 3. Replace the actual checks
code = code.replace(/this\.antiVideoGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antivideo');
code = code.replace(/this\.antiFotoGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antifoto');
code = code.replace(/this\.antiFoto1xGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antifoto1x');
code = code.replace(/this\.antiStikerGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antistiker');
code = code.replace(/this\.antiTagSwGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antitagsw');
code = code.replace(/this\.antiVirtexGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antivirtex');
code = code.replace(/this\.antiToxicGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antitoxic');
code = code.replace(/this\.antiSpamGroups\.has\(jid\)/g, 'this.groupSettings.get(jid)?.antispam');

// 4. Also add antilinkall check to the anti-block:
// Let's find "if (this.groupSettings.get(jid)?.antitoxic && textInfo) {" and add antilinkall there
const checkBlock = `      if (this.groupSettings.get(jid)?.antilinkall && textInfo && textInfo.match(/https?:\\/\\/[^\\s]+/i)) {
         shouldDelete = true;
         reason = "antilinkall";
      }`;
code = code.replace('const toxicWords =', checkBlock + '\\n\\n      const toxicWords =');

// 5. Update the "anti..." commands logic
const oldAntiBlock = `      if (body.includes("on")) {
        if (featureName === 'antivideo') this.antiVideoGroups.add(jid);
        if (featureName === 'antifoto') this.antiFotoGroups.add(jid);
        if (featureName === 'antifoto1x') this.antiFoto1xGroups.add(jid);
        if (featureName === 'antistiker') this.antiStikerGroups.add(jid);
        if (featureName === 'antispam') this.antiSpamGroups.add(jid);
        if (featureName === 'antitagsw') this.antiTagSwGroups.add(jid);
        if (featureName === 'antivirtex') this.antiVirtexGroups.add(jid);
        if (featureName === 'antitoxic') this.antiToxicGroups.add(jid);
        await this.sock.sendMessage(jid, { text: \`✅ Fitur \${featureName} berhasil diaktifkan!\` }, { quoted: msg });
      } else if (body.includes("off")) {
        if (featureName === 'antivideo') this.antiVideoGroups.delete(jid);
        if (featureName === 'antifoto') this.antiFotoGroups.delete(jid);
        if (featureName === 'antifoto1x') this.antiFoto1xGroups.delete(jid);
        if (featureName === 'antistiker') this.antiStikerGroups.delete(jid);
        if (featureName === 'antispam') this.antiSpamGroups.delete(jid);
        if (featureName === 'antitagsw') this.antiTagSwGroups.delete(jid);
        if (featureName === 'antivirtex') this.antiVirtexGroups.delete(jid);
        if (featureName === 'antitoxic') this.antiToxicGroups.delete(jid);
        await this.sock.sendMessage(jid, { text: \`❌ Fitur \${featureName} berhasil dimatikan!\` }, { quoted: msg });
      }`;

const newAntiBlock = `      const settings = this.groupSettings.get(jid) || {};
      if (body.includes("on")) {
        settings[featureName as keyof typeof settings] = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: \`✅ Fitur \${featureName} berhasil diaktifkan!\` }, { quoted: msg });
      } else if (body.includes("off")) {
        settings[featureName as keyof typeof settings] = false;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: \`❌ Fitur \${featureName} berhasil dimatikan!\` }, { quoted: msg });
      }`;

code = code.replace(oldAntiBlock, newAntiBlock);

// 6. Update .antilinkall logic
const oldAntiLink = `    } else if (body.startsWith(".antilinkall") || body.startsWith("antilinkall")) {
      if (body.includes("on")) {
        await this.sock.sendMessage(jid, { text: \`✅ Anti Link All berhasil diaktifkan!\` }, { quoted: msg });
      } else if (body.includes("off")) {
        await this.sock.sendMessage(jid, { text: \`❌ Anti Link All berhasil dimatikan!\` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: \`Ketik on atau off! Contoh: .antilinkall on\` }, { quoted: msg });
      }
    }`;

const newAntiLink = `    } else if (body.startsWith(".antilinkall") || body.startsWith("antilinkall")) {
      const settings = this.groupSettings.get(jid) || {};
      if (body.includes("on")) {
        settings.antilinkall = true;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: \`✅ Anti Link All berhasil diaktifkan!\` }, { quoted: msg });
      } else if (body.includes("off")) {
        settings.antilinkall = false;
        this.groupSettings.set(jid, settings);
        this.saveGroupSettings();
        await this.sock.sendMessage(jid, { text: \`❌ Anti Link All berhasil dimatikan!\` }, { quoted: msg });
      } else {
        await this.sock.sendMessage(jid, { text: \`Ketik on atau off! Contoh: .antilinkall on\` }, { quoted: msg });
      }
    }`;

code = code.replace(oldAntiLink, newAntiLink);

// 7. Update .hd to send as Document so it doesn't get compressed
const oldHdBlock = `              const hdBuffer = await sharp(buffer as Buffer).resize(2000, null, { withoutEnlargement: false }).jpeg({ quality: 100 }).toBuffer();
              await this.sock.sendMessage(jid, { image: hdBuffer, caption: \`✅ Berhasil mengubah resolusi!\` }, { quoted: msg });`;

const newHdBlock = `              const hdBuffer = await sharp(buffer as Buffer).resize(2000, null, { withoutEnlargement: false }).jpeg({ quality: 100 }).toBuffer();
              await this.sock.sendMessage(jid, { document: hdBuffer, mimetype: 'image/jpeg', fileName: 'HD_Image.jpg', caption: \`✅ Berhasil mengubah resolusi!\` }, { quoted: msg });`;

code = code.replace(oldHdBlock, newHdBlock);

fs.writeFileSync('src/services/whatsapp.ts', code);
console.log('patched successfully!');
