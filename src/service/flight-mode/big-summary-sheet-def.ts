import type { Sheet_ACU, SheetExportConfig_ACU, SheetUpdateConfig_ACU } from '../../shared/models/table-data';
import {
  FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
  FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
} from '../../shared/models/flight-mode-model';

const FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU = {
  position: 'at_depth_as_system',
  depth: 1000,
  order: 10010,
};

function cloneValue_ACU<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextOrderNo_ACU(template: Record<string, any>): number {
  const orderNumbers = Object.keys(template)
    .filter(key => key.startsWith('sheet_'))
    .map(key => Number(template[key]?.orderNo))
    .filter(Number.isFinite);
  return orderNumbers.length > 0 ? Math.max(...orderNumbers) + 1 : 0;
}

export function buildFlightModeBigSummarySheet_ACU(
  chronicleSheet: Sheet_ACU,
  template: Record<string, any>,
): Sheet_ACU {
  const updateConfig = cloneValue_ACU<SheetUpdateConfig_ACU>(chronicleSheet.updateConfig);
  const exportConfig: SheetExportConfig_ACU = {
    enabled: true,
    splitByRow: false,
    entryName: FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
    entryType: 'constant',
    keywords: '',
    preventRecursion: true,
    injectionTemplate: '<大总结>\n$1\n</大总结>',
    extraIndexEnabled: false,
    extraIndexEntryName: `${FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU}-索引`,
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: '',
    entryPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
    extraIndexPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
    fixedEntryPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
    fixedIndexPlacement: { ...FLIGHT_MODE_BIG_SUMMARY_ENTRY_PLACEMENT_ACU },
  };

  return {
    uid: FLIGHT_MODE_BIG_SUMMARY_SHEET_KEY_ACU,
    name: FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU,
    sourceData: {
      note: '仅归纳当前仍可见的纪要。请自行判断何时需要新增一行大总结；新增后系统会隐藏当时已归纳的纪要。不要填写纪要引用范围。',
      initNode: '无需初始化。',
      deleteNode: '禁止删除已有大总结。',
      updateNode: '已有大总结可以在新事实使其失效时修订。',
      insertNode: '当当前可见纪要已经形成可复用的阶段性脉络时，新增一行大总结；无需写纪要引用范围。',
      ddl: `CREATE TABLE flight_big_summary ( -- ${FLIGHT_MODE_BIG_SUMMARY_SHEET_NAME_ACU}\n  row_id INTEGER PRIMARY KEY, -- 行号\n  summary_text TEXT NOT NULL -- 总结\n);`,
    },
    content: [['row_id', '总结']],
    updateConfig,
    exportConfig,
    orderNo: nextOrderNo_ACU(template),
  };
}
