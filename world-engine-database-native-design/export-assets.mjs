import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorldDatabaseTemplateObject,
  buildWorldScriptPackage,
} from './index.js';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

await writeFile(
  join(dist, 'world-database-template.json'),
  JSON.stringify(buildWorldDatabaseTemplateObject(), null, 2),
  'utf8',
);

await writeFile(
  join(dist, 'world-script-package.json'),
  JSON.stringify(buildWorldScriptPackage(), null, 2),
  'utf8',
);

console.log('World assets exported to world-engine-database-native-design/dist/.');
