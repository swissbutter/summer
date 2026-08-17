const fs = require('fs');
const https = require('https');
const path = require('path');

console.log('[Build] Pre-compiling src/app.js -> src/app.compiled.js...');

https.get('https://unpkg.com/@babel/standalone@8.0.4/babel.min.js', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const babelModule = { exports: {} };
        const fn = new Function('module', 'exports', 'global', 'window', data + '; return module.exports || window.Babel || global.Babel;');
        const BabelObj = fn(babelModule, babelModule.exports, global, global);
        const Babel = BabelObj.Babel || BabelObj;

        const appJsPath = path.join(__dirname, 'src', 'app.js');
        const appCompiledPath = path.join(__dirname, 'src', 'app.compiled.js');

        const sourceCode = fs.readFileSync(appJsPath, 'utf-8');
        const compiled = Babel.transform(sourceCode, {
            presets: [['react', { runtime: 'classic' }]]
        }).code;
        fs.writeFileSync(appCompiledPath, compiled, 'utf-8');

        console.log(`[Build] SUCCESS! Compiled ${sourceCode.length} bytes -> ${compiled.length} bytes.`);
    });
}).on('error', (err) => {
    console.error('[Build] Failed to fetch Babel:', err);
});
