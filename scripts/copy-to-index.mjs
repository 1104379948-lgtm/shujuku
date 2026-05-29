import { copyFileSync } from 'fs';

copyFileSync('dist/index.bundle.js', 'index.js');
console.log('[copy-to-index] dist/index.bundle.js -> index.js');
