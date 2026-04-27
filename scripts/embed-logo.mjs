import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const png = fs.readFileSync(path.join(__dirname, '../frontend/assets/colbeef-logo.png'));
const b64 = png.toString('base64');
const out = `window.COLBEEF_LOGO_DATA_URL=${JSON.stringify('data:image/png;base64,' + b64)};\n`;
fs.writeFileSync(path.join(__dirname, '../frontend/colbeef-logo-data.js'), out, 'utf8');
console.log('ok', out.length);
