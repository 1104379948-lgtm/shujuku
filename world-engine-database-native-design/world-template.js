import { buildDefaultTableTemplateObject_ACU } from '../src/shared/table-defaults/index.js';

export const WORLD_TEMPLATE_PRESET_NAME = 'World数据库模板';

const WORLD_TABLE_NOTE = '【World后台表】本表仅供 World 脚本维护。常规填表AI禁止插入、更新、删除本表。若剧情产生相关变化，请先写入默认前台表或由 World 推演器在正文后统一结算。';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function disabledUpdateConfig() {
  return {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1,
  };
}

function placement(depth, order) {
  return { position: 'at_depth_as_system', depth, order };
}

function disabledExportConfig(entryName) {
  return {
    enabled: false,
    splitByRow: false,
    entryName,
    entryType: 'constant',
    keywords: '',
    preventRecursion: true,
    injectionTemplate: '',
    extraIndexEnabled: false,
    extraIndexEntryName: `${entryName}-索引`,
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: '',
    entryPlacement: placement(2, 10000),
    extraIndexPlacement: placement(2, 10010),
    fixedEntryPlacement: { position: 'before_char', depth: 2, order: 99981 },
    fixedIndexPlacement: { position: 'before_char', depth: 2, order: 99980 },
    injectIntoWorldbook: false,
  };
}

function digestExportConfig() {
  return {
    ...disabledExportConfig('World后台摘要'),
    enabled: true,
    splitByRow: false,
    entryName: 'World后台摘要',
    entryType: 'constant',
    preventRecursion: true,
    injectionTemplate: '<world_state>\n$1\n</world_state>',
    extraIndexEnabled: false,
    entryPlacement: placement(3, 9500),
    injectIntoWorldbook: true,
  };
}

function sheet({ uid, name, ddl, headers, orderNo, exportConfig }) {
  return {
    uid,
    name,
    sourceData: {
      note: WORLD_TABLE_NOTE,
      initNode: WORLD_TABLE_NOTE,
      insertNode: WORLD_TABLE_NOTE,
      updateNode: WORLD_TABLE_NOTE,
      deleteNode: WORLD_TABLE_NOTE,
      ddl,
    },
    content: [headers],
    updateConfig: disabledUpdateConfig(),
    exportConfig: exportConfig || disabledExportConfig(name),
    orderNo,
  };
}

export const worldTableDefinitions = [
  {
    uid: 'sheet_we_meta',
    name: 'World元数据表',
    orderNo: 100,
    headers: ['row_id', 'world_id', 'mode', 'active_preset', 'round', 'enabled', 'evolve_every', 'api_preset_override', 'last_message_id', 'last_checkpoint_id', 'last_error', 'updated_at'],
    ddl: `CREATE TABLE we_meta ( -- World元数据表
  row_id INTEGER PRIMARY KEY, -- 行号
  world_id TEXT NOT NULL UNIQUE, -- 世界ID
  mode TEXT NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic','free','mixed')), -- 模式
  active_preset TEXT NOT NULL DEFAULT 'default', -- 当前预设
  round INTEGER NOT NULL DEFAULT 0 CHECK(round >= 0), -- 推演轮次
  enabled TEXT NOT NULL DEFAULT '是' CHECK(enabled IN ('是','否')), -- 是否启用
  evolve_every INTEGER NOT NULL DEFAULT 1 CHECK(evolve_every >= 1), -- 每N轮推演
  api_preset_override TEXT, -- 推演API覆盖预设；为空时使用用户当前主API/剧情推进API配置
  last_message_id TEXT, -- 上次处理消息ID
  last_checkpoint_id TEXT, -- 最近存档点ID
  last_error TEXT, -- 最近错误
  updated_at TEXT -- 更新时间
);`,
  },
  {
    uid: 'sheet_we_modules',
    name: 'World模块描述符表',
    orderNo: 101,
    headers: ['row_id', 'module_id', 'module_name', 'kind', 'enabled', 'container', 'state_table', 'item_key', 'order_no', 'rules', 'output_contract', 'mechanics_json', 'display_json', 'lifecycle_json', 'merge_strategy', 'updated_at'],
    ddl: `CREATE TABLE we_modules ( -- World模块描述符表
  row_id INTEGER PRIMARY KEY, -- 行号
  module_id TEXT NOT NULL UNIQUE, -- 模块ID
  module_name TEXT NOT NULL, -- 模块名称
  kind TEXT NOT NULL CHECK(kind IN ('builtin','custom')), -- 模块类型
  enabled TEXT NOT NULL DEFAULT '是' CHECK(enabled IN ('是','否')), -- 是否启用
  container TEXT NOT NULL CHECK(container IN ('array','object','scalar','none')), -- 状态容器类型
  state_table TEXT, -- 状态表名
  item_key TEXT, -- 数组合并主键列
  order_no INTEGER NOT NULL DEFAULT 100, -- 排序
  rules TEXT NOT NULL DEFAULT '', -- 推演规则
  output_contract TEXT NOT NULL DEFAULT '', -- 输出契约JSON
  mechanics_json TEXT NOT NULL DEFAULT '{}', -- 机制配置JSON
  display_json TEXT NOT NULL DEFAULT '{}', -- 展示配置JSON
  lifecycle_json TEXT NOT NULL DEFAULT '{}', -- 生命周期配置JSON
  merge_strategy TEXT NOT NULL DEFAULT 'upsert' CHECK(merge_strategy IN ('upsert','replace','append','patch','ignore')), -- 合并策略
  updated_at TEXT -- 更新时间
);`,
  },
  {
    uid: 'sheet_we_prompt_templates',
    name: 'World推演提示词模板表',
    orderNo: 102,
    headers: ['row_id', 'template_name', 'enabled', 'system_prompt', 'user_prompt_template', 'output_contract_json', 'final_directive', 'worldbook_strategy', 'context_turns', 'updated_at'],
    ddl: `CREATE TABLE we_prompt_templates ( -- World推演提示词模板表
  row_id INTEGER PRIMARY KEY, -- 行号
  template_name TEXT NOT NULL UNIQUE, -- 模板名称
  enabled TEXT NOT NULL DEFAULT '是' CHECK(enabled IN ('是','否')), -- 是否启用
  system_prompt TEXT NOT NULL, -- 系统提示词
  user_prompt_template TEXT NOT NULL, -- 用户提示词模板
  output_contract_json TEXT NOT NULL, -- 输出契约JSON
  final_directive TEXT NOT NULL DEFAULT '', -- 最终指令
  worldbook_strategy TEXT NOT NULL DEFAULT 'current' CHECK(worldbook_strategy IN ('none','current','selected')), -- 世界书策略
  context_turns INTEGER NOT NULL DEFAULT 3 CHECK(context_turns >= 0), -- 读取最近轮数
  updated_at TEXT -- 更新时间
);`,
  },
  {
    uid: 'sheet_we_world_digest',
    name: 'World世界摘要表',
    orderNo: 103,
    headers: ['row_id', 'round', 'digest', 'visible_digest', 'hidden_digest', 'created_at'],
    exportConfig: digestExportConfig(),
    ddl: `CREATE TABLE we_world_digest ( -- World世界摘要表
  row_id INTEGER PRIMARY KEY, -- 行号
  round INTEGER NOT NULL UNIQUE, -- 推演轮次
  digest TEXT NOT NULL, -- 世界摘要
  visible_digest TEXT, -- 角色可感知摘要
  hidden_digest TEXT, -- 玩家可见但角色未知摘要
  created_at TEXT -- 创建时间
);`,
  },
  {
    uid: 'sheet_we_events',
    name: 'World事件链表',
    orderNo: 104,
    headers: ['row_id', 'event_key', 'title', 'event_type', 'stage', 'progress', 'scope', 'actors', 'cause', 'current_state', 'next_pressure', 'visibility', 'terminal', 'expires_round', 'updated_round'],
    ddl: `CREATE TABLE we_events ( -- World事件链表
  row_id INTEGER PRIMARY KEY, -- 行号
  event_key TEXT NOT NULL UNIQUE, -- 事件键
  title TEXT NOT NULL, -- 事件标题
  event_type TEXT NOT NULL CHECK(event_type IN ('conflict','progress','custom')), -- 事件类型
  stage TEXT NOT NULL, -- 阶段
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100), -- 进度
  scope TEXT, -- 影响范围
  actors TEXT, -- 参与方JSON
  cause TEXT, -- 起因
  current_state TEXT, -- 当前状态
  next_pressure TEXT, -- 后续压力
  visibility TEXT NOT NULL DEFAULT 'unknown' CHECK(visibility IN ('public','rumor','private','unknown')), -- 可见性
  terminal TEXT NOT NULL DEFAULT '否' CHECK(terminal IN ('是','否')), -- 是否终局
  expires_round INTEGER, -- 过期轮次
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_factions',
    name: 'World势力表',
    orderNo: 105,
    headers: ['row_id', 'faction_key', 'name', 'type', 'scope', 'status', 'relation_to_user', 'goal', 'resources', 'core_people', 'internal_conflict', 'known_info', 'last_action', 'updated_round'],
    ddl: `CREATE TABLE we_factions ( -- World势力表
  row_id INTEGER PRIMARY KEY, -- 行号
  faction_key TEXT NOT NULL UNIQUE, -- 势力键
  name TEXT NOT NULL, -- 势力名称
  type TEXT, -- 势力类型
  scope TEXT, -- 活动范围
  status TEXT NOT NULL DEFAULT '稳固', -- 势力状态
  relation_to_user TEXT NOT NULL DEFAULT '中立', -- 对主角关系
  goal TEXT, -- 当前目标
  resources TEXT, -- 资源
  core_people TEXT, -- 核心人物JSON
  internal_conflict TEXT, -- 内部矛盾
  known_info TEXT, -- 已知信息
  last_action TEXT, -- 最近行动
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_winds',
    name: 'World风声表',
    orderNo: 106,
    headers: ['row_id', 'wind_key', 'topic', 'content', 'source', 'channel', 'scope', 'credibility', 'intensity', 'decay_rounds', 'visible_to_user', 'updated_round'],
    ddl: `CREATE TABLE we_winds ( -- World风声表
  row_id INTEGER PRIMARY KEY, -- 行号
  wind_key TEXT NOT NULL UNIQUE, -- 风声键
  topic TEXT NOT NULL, -- 主题
  content TEXT NOT NULL, -- 内容
  source TEXT, -- 来源
  channel TEXT, -- 传播渠道
  scope TEXT, -- 覆盖范围
  credibility TEXT NOT NULL DEFAULT '未证实' CHECK(credibility IN ('真实','半真半假','谣言','未证实')), -- 可信度
  intensity INTEGER NOT NULL DEFAULT 1 CHECK(intensity >= 0 AND intensity <= 10), -- 强度
  decay_rounds INTEGER NOT NULL DEFAULT 3 CHECK(decay_rounds >= 0), -- 剩余衰减轮次
  visible_to_user TEXT NOT NULL DEFAULT '否' CHECK(visible_to_user IN ('是','否')), -- 主角是否可知
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_reputation',
    name: 'World声誉表',
    orderNo: 107,
    headers: ['row_id', 'axis_key', 'axis_name', 'level', 'verdict', 'evidence', 'last_change', 'updated_round'],
    ddl: `CREATE TABLE we_reputation ( -- World声誉表
  row_id INTEGER PRIMARY KEY, -- 行号
  axis_key TEXT NOT NULL UNIQUE, -- 声誉维度键
  axis_name TEXT NOT NULL, -- 声誉维度名称
  level TEXT NOT NULL, -- 声誉等级
  verdict TEXT NOT NULL, -- 裁决文本
  evidence TEXT, -- 变化依据
  last_change TEXT, -- 最近变化
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_economy',
    name: 'World经济表',
    orderNo: 108,
    headers: ['row_id', 'economy_key', 'scope', 'climate', 'signal', 'cause', 'impact', 'expires_round', 'updated_round'],
    ddl: `CREATE TABLE we_economy ( -- World经济表
  row_id INTEGER PRIMARY KEY, -- 行号
  economy_key TEXT NOT NULL UNIQUE, -- 经济键
  scope TEXT NOT NULL, -- 范围
  climate TEXT NOT NULL DEFAULT '平稳', -- 气候
  signal TEXT, -- 信号
  cause TEXT, -- 原因
  impact TEXT, -- 影响
  expires_round INTEGER, -- 过期轮次
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_enemies',
    name: 'World仇敌录表',
    orderNo: 109,
    headers: ['row_id', 'enemy_key', 'name', 'enemy_type', 'grudge', 'severity', 'stage', 'resources', 'knows_user_info', 'current_plan', 'terminal', 'updated_round'],
    ddl: `CREATE TABLE we_enemies ( -- World仇敌录表
  row_id INTEGER PRIMARY KEY, -- 行号
  enemy_key TEXT NOT NULL UNIQUE, -- 仇敌键
  name TEXT NOT NULL, -- 仇敌名称
  enemy_type TEXT, -- 仇敌类型
  grudge TEXT NOT NULL, -- 仇恨原因
  severity INTEGER NOT NULL DEFAULT 1 CHECK(severity >= 1 AND severity <= 10), -- 严重度
  stage TEXT NOT NULL DEFAULT '潜伏', -- 报复阶段
  resources TEXT, -- 可用资源
  knows_user_info TEXT, -- 掌握的主角信息
  current_plan TEXT, -- 当前计划
  terminal TEXT NOT NULL DEFAULT '否' CHECK(terminal IN ('是','否')), -- 是否终结
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_influence_chain',
    name: 'World影响链表',
    orderNo: 110,
    headers: ['row_id', 'chain_key', 'source_module', 'source_key', 'direct_effect', 'propagated_to', 'evidence', 'status', 'created_round', 'expires_round'],
    ddl: `CREATE TABLE we_influence_chain ( -- World影响链表
  row_id INTEGER PRIMARY KEY, -- 行号
  chain_key TEXT NOT NULL UNIQUE, -- 影响链键
  source_module TEXT NOT NULL, -- 源模块
  source_key TEXT, -- 源记录键
  direct_effect TEXT NOT NULL, -- 直接影响
  propagated_to TEXT, -- 传导目标JSON
  evidence TEXT, -- 因果证据
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','settled','expired')), -- 状态
  created_round INTEGER NOT NULL, -- 创建轮次
  expires_round INTEGER -- 过期轮次
);`,
  },
  {
    uid: 'sheet_we_blackbox',
    name: 'World信息黑盒表',
    orderNo: 111,
    headers: ['row_id', 'secret_key', 'category', 'content', 'owner', 'witnesses', 'traces', 'exposure_risk', 'public_status', 'updated_round'],
    ddl: `CREATE TABLE we_blackbox ( -- World信息黑盒表
  row_id INTEGER PRIMARY KEY, -- 行号
  secret_key TEXT NOT NULL UNIQUE, -- 秘密键
  category TEXT NOT NULL CHECK(category IN ('action','asset','knowledge','relationship','other')), -- 秘密类别
  content TEXT NOT NULL, -- 秘密内容
  owner TEXT, -- 归属者
  witnesses TEXT, -- 目击者JSON
  traces TEXT, -- 留痕JSON
  exposure_risk INTEGER NOT NULL DEFAULT 0 CHECK(exposure_risk >= 0 AND exposure_risk <= 100), -- 暴露风险
  public_status TEXT NOT NULL DEFAULT 'hidden' CHECK(public_status IN ('hidden','leaking','exposed')), -- 公开状态
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_regional_incident',
    name: 'World区域突发事件表',
    orderNo: 112,
    headers: ['row_id', 'incident_key', 'active', 'title', 'incident_type', 'scope', 'impact', 'remaining_rounds', 'cooldown', 'updated_round'],
    ddl: `CREATE TABLE we_regional_incident ( -- World区域突发事件表
  row_id INTEGER PRIMARY KEY, -- 行号
  incident_key TEXT NOT NULL UNIQUE, -- 事件键
  active TEXT NOT NULL DEFAULT '否' CHECK(active IN ('是','否')), -- 是否激活
  title TEXT, -- 标题
  incident_type TEXT, -- 类型
  scope TEXT, -- 范围
  impact TEXT, -- 影响
  remaining_rounds INTEGER NOT NULL DEFAULT 0 CHECK(remaining_rounds >= 0), -- 剩余轮次
  cooldown INTEGER NOT NULL DEFAULT 0 CHECK(cooldown >= 0), -- 冷却轮次
  updated_round INTEGER NOT NULL DEFAULT 0 -- 更新轮次
);`,
  },
  {
    uid: 'sheet_we_custom_state',
    name: 'World自定义模块状态表',
    orderNo: 113,
    headers: ['row_id', 'module_id', 'item_key', 'item_json', 'stage', 'verdict', 'score', 'visibility', 'expires_round', 'updated_round'],
    ddl: `CREATE TABLE we_custom_state ( -- World自定义模块状态表
  row_id INTEGER PRIMARY KEY, -- 行号
  module_id TEXT NOT NULL, -- 模块ID
  item_key TEXT NOT NULL, -- 条目键
  item_json TEXT NOT NULL, -- 条目JSON
  stage TEXT, -- 阶段
  verdict TEXT, -- 裁决
  score INTEGER, -- 分值
  visibility TEXT DEFAULT 'unknown', -- 可见性
  expires_round INTEGER, -- 过期轮次
  updated_round INTEGER NOT NULL DEFAULT 0, -- 更新轮次
  UNIQUE(module_id, item_key)
);`,
  },
  {
    uid: 'sheet_we_ledger',
    name: 'World推演台账表',
    orderNo: 114,
    headers: ['row_id', 'request_id', 'round', 'message_id', 'status', 'prompt_digest', 'raw_response', 'parsed_json', 'error', 'started_at', 'finished_at'],
    ddl: `CREATE TABLE we_ledger ( -- World推演台账表
  row_id INTEGER PRIMARY KEY, -- 行号
  request_id TEXT NOT NULL UNIQUE, -- 请求ID
  round INTEGER NOT NULL, -- 推演轮次
  message_id TEXT, -- 消息ID
  status TEXT NOT NULL CHECK(status IN ('running','success','failed','skipped')), -- 状态
  prompt_digest TEXT, -- Prompt摘要
  raw_response TEXT, -- 原始响应
  parsed_json TEXT, -- 解析JSON
  error TEXT, -- 错误
  started_at TEXT, -- 开始时间
  finished_at TEXT -- 结束时间
);`,
  },
  {
    uid: 'sheet_we_checkpoints',
    name: 'World存档点表',
    orderNo: 115,
    headers: ['row_id', 'checkpoint_id', 'round', 'message_id', 'snapshot_json', 'reason', 'created_at'],
    ddl: `CREATE TABLE we_checkpoints ( -- World存档点表
  row_id INTEGER PRIMARY KEY, -- 行号
  checkpoint_id TEXT NOT NULL UNIQUE, -- 存档点ID
  round INTEGER NOT NULL, -- 推演轮次
  message_id TEXT, -- 消息ID
  snapshot_json TEXT NOT NULL, -- 状态快照JSON
  reason TEXT, -- 原因
  created_at TEXT -- 创建时间
);`,
  },
];

export function buildWorldDatabaseTemplateObject() {
  const base = clone(buildDefaultTableTemplateObject_ACU());
  for (const definition of worldTableDefinitions) {
    base[definition.uid] = sheet(definition);
  }
  return base;
}

export function buildWorldDatabaseTemplateString() {
  return JSON.stringify(buildWorldDatabaseTemplateObject(), null, 2);
}

export function buildWorldTemplateImportPayload() {
  return buildWorldDatabaseTemplateObject();
}
