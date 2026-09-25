// Builds the single self-contained GeofenceEditor.html: `node build.js`
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');

let html = read('src/index.html');
html = html.replace(/<!-- inline-css: (\S+) -->/g, (_, p) => `<style>\n${read(p)}</style>`);
html = html.replace(/<!-- inline-js: (\S+) -->/g, (_, p) => `<script>\n${read(p).replace(/<\/script/gi, '<\\/script')}</script>`);

const out = path.join(root, 'GeofenceEditor.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
