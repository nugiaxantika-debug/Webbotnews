const fs = require('fs');
let code = fs.readFileSync('src/services/whatsapp.ts', 'utf8');
const search = `execSync(\`ffmpeg -framerate 1.5 -i \"${path.join(tmpdir, 'frame_%d.png')}\" -vf \"scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2\" -c:v libwebp -loop 0 -q:v 80 -preset default -an -y \"${outWebp}\"\`, { stdio: 'ignore' });`;
const replace = `try {
                  execSync(\`ffmpeg -framerate 1.5 -i \"${path.join(tmpdir, 'frame_%d.png')}\" -vf \"scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2\" -c:v libwebp -loop 0 -q:v 80 -preset default -an -y \"${outWebp}\"\`);
              } catch(err) {
                  throw new Error(\"FFmpeg failed:\" + (err.stderr ? err.stderr.toString() : err.message));
              }`;
code = code.replace(search, replace);
fs.writeFileSync('src/services/whatsapp.ts', code);
