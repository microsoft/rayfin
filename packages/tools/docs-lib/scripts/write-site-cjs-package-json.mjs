import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist/site-cjs', { recursive: true });
writeFileSync('dist/site-cjs/package.json', '{ "type": "commonjs" }');
