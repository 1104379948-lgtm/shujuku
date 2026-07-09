import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  buildWorldDatabaseTemplateObject,
  buildWorldScriptPackage,
  worldTableDefinitions,
  WORLD_SCRIPT_PACKAGE_FORMAT,
} from './index.js';
import { buildDefaultTableTemplateObject_ACU } from '../src/shared/table-defaults/index.js';

const template = buildWorldDatabaseTemplateObject();
const baseTemplate = buildDefaultTableTemplateObject_ACU();
const sheetKeys = Object.keys(template).filter(key => key.startsWith('sheet_'));
const SQL = await initSqlJs();
const sqliteDb = new SQL.Database();

assert.equal(template.mate?.type, 'chatSheets');
assert.ok(sheetKeys.length >= 24, 'World 模板必须保留默认表并追加 World 表');
assert.equal(worldTableDefinitions.length, 16, 'World 表数量必须为 16');

for (const [key, baseSheet] of Object.entries(baseTemplate)) {
  if (key === 'mate') continue;
  const sheet = template[key];
  assert.ok(sheet, `默认表被删除: ${key}`);
  assert.equal(sheet.uid, baseSheet.uid, `默认表 UID 被改写: ${key}`);
  assert.equal(sheet.name, baseSheet.name, `默认表名被改写: ${key}`);
  assert.equal(sheet.sourceData.ddl, baseSheet.sourceData.ddl, `默认表 DDL 被改写: ${key}`);
  assert.deepEqual(sheet.exportConfig, baseSheet.exportConfig, `默认表导出配置被改写: ${key}`);
  assert.equal(sheet.orderNo, baseSheet.orderNo, `默认表 orderNo 被改写: ${key}`);
}

for (const definition of worldTableDefinitions) {
  const sheet = template[definition.uid];
  assert.ok(sheet, `缺少 ${definition.uid}`);
  assert.doesNotThrow(() => sqliteDb.run(sheet.sourceData.ddl), `${definition.uid} DDL 必须能被 SQLite 执行`);
  assert.ok(sheet.sourceData.ddl.includes('row_id INTEGER PRIMARY KEY, -- 行号'), `${definition.uid} DDL 第一列不符合要求`);
  assert.ok(/-- .+/.test(sheet.sourceData.ddl), `${definition.uid} DDL 缺少字段注释`);
  if (!['sheet_we_world_digest'].includes(definition.uid)) assert.ok(/UNIQUE|CHECK/.test(sheet.sourceData.ddl), `${definition.uid} 缺少 UNIQUE 或 CHECK 约束`);
  assert.equal(sheet.updateConfig.uiSentinel, -1);
  assert.equal(sheet.updateConfig.contextDepth, -1);
  assert.equal(sheet.updateConfig.updateFrequency, -1);
  assert.equal(sheet.updateConfig.batchSize, -1);
  assert.equal(sheet.updateConfig.skipFloors, -1);
  assert.ok(sheet.sourceData.note.includes('World后台表'));

  if (definition.uid === 'sheet_we_world_digest') {
    assert.equal(definition.name, 'World世界摘要表');
    assert.ok(sheet.sourceData.ddl.includes('CREATE TABLE we_world_digest'), '正文注入表必须是 we_world_digest');
    assert.equal(sheet.exportConfig.enabled, true);
    assert.equal(sheet.exportConfig.entryName, 'World后台摘要');
    assert.equal(sheet.exportConfig.entryType, 'constant');
    assert.equal(sheet.exportConfig.splitByRow, false);
    assert.equal(sheet.exportConfig.preventRecursion, true);
    assert.equal(sheet.exportConfig.extraIndexEnabled, false);
    assert.equal(sheet.exportConfig.injectionTemplate, '<world_state>\n$1\n</world_state>');
    assert.equal(sheet.exportConfig.entryPlacement.position, 'at_depth_as_system');
  } else {
    assert.equal(sheet.exportConfig.enabled, false);
    assert.equal(sheet.exportConfig.preventRecursion, true);
  }
}

const scriptPackage = buildWorldScriptPackage();
assert.equal(scriptPackage.format, WORLD_SCRIPT_PACKAGE_FORMAT);
assert.deepEqual(scriptPackage.scripts.map(script => script.name), [
  'World 初始化器',
  'World 推演器',
  'World 摘要器',
  'World 世界书读取器',
  'World 机制执行器',
  'World 同步器',
  'World 预设生成器',
  'World 恢复器',
]);

for (const script of scriptPackage.scripts) {
  assert.equal(script.enabled, true);
  assert.equal(script.language, 'javascript');
  assert.equal(typeof script.name, 'string');
  assert.equal(typeof script.description, 'string');
  assert.ok(script.source.length > 100, `${script.name} 缺少脚本源码`);
  assert.deepEqual(script.scope, { type: 'global' });
  assert.ok(Array.isArray(script.bindings));
  assert.ok(script.defaultVariableInput && typeof script.defaultVariableInput === 'object');
  assert.ok(script.timeoutSeconds > 0);
  assert.ok(Number.isFinite(script.order));
  for (const binding of script.bindings) {
    assert.equal(typeof binding.hook, 'string');
    assert.equal(typeof binding.enabled, 'boolean');
    assert.equal(typeof binding.config, 'object');
  }
}

assert.equal(scriptPackage.format, 'acu_user_script_v1', '脚本包必须交给现有 importUserScripts 导入；同名冲突由现有导入机制重命名处理');

console.log('World assets verified.');

const root = dirname(fileURLToPath(import.meta.url));
const exportedTemplate = JSON.parse(await readFile(join(root, 'dist/world-database-template.json'), 'utf8'));
const exportedScripts = JSON.parse(await readFile(join(root, 'dist/world-script-package.json'), 'utf8'));
assert.equal(exportedTemplate.mate?.type, 'chatSheets', '导出的模板 JSON 不是 chatSheets');
assert.equal(exportedScripts.format, WORLD_SCRIPT_PACKAGE_FORMAT, '导出的脚本包格式不正确');

console.log('World exported assets verified.');
