// Copies the sql.js runtime into public/ so the PWA works offline with no CDN.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/vendor', { recursive: true });
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) {
  copyFileSync(`node_modules/sql.js/dist/${f}`, `public/vendor/${f}`);
}
console.log('Copied sql.js into public/vendor');
