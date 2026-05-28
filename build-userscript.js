import { writeFileSync } from 'node:fs';
import esbuild from 'esbuild';

const version = (() => {
    if (process.env.SCRIPT_VERSION) return process.env.SCRIPT_VERSION.replace(/^v/, '');
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}.${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
})();
const downloadURL = process.env.DOWNLOAD_URL || 'https://github.com/Cattle0Horse/link-cleaner/releases/latest/download/link-cleaner.user.js';
const updateURL = process.env.UPDATE_URL || 'https://github.com/Cattle0Horse/link-cleaner/releases/latest/download/link-cleaner.meta.js';
const userscriptHeader = `
    // ==UserScript==
    // @name        Link Cleaner
    // @version     ${version}
    // @author      Cattle0Horse
    // @description 清洗网页上带有各种跟踪参数的链接
    // @source      https://github.com/Cattle0Horse/link-cleaner
    // @downloadURL ${downloadURL}
    // @updateURL   ${updateURL}
    // @match       *://*/*
    // @connect     *
    // @grant       GM_getValue
    // @grant       GM_registerMenuCommand
    // @grant       GM_setClipboard
    // @grant       GM_setValue
    // @grant       GM_xmlhttpRequest
    // ==/UserScript==
`.trim().split('\n').map(e => e.trim()).join('\n');

esbuild.buildSync({
    entryPoints: ['src/entry-userscript.js'],
    outfile: 'dist/link-cleaner.user.js',
    charset: 'utf8',
    bundle: true,
    minify: true,
    banner: {
        js: `${userscriptHeader}\n/* eslint-disable */`,
    },
});

writeFileSync('dist/link-cleaner.meta.js', `${userscriptHeader}\n`);
