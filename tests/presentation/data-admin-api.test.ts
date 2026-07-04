import { describe, expect, it, vi } from 'vitest';

const { mockOpenVisualizer, mockImportTxtTextAndSplitCore, mockInjectImportedSelectedCore, mockHandleInjectImportedTxtSelected } = vi.hoisted(() => ({
  mockOpenVisualizer: vi.fn(),
  mockImportTxtTextAndSplitCore: vi.fn(),
  mockInjectImportedSelectedCore: vi.fn(),
  mockHandleInjectImportedTxtSelected: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/data-admin-ui', () => ({
  exportCurrentJsonData_ACU: vi.fn(),
  exportTableTemplate_ACU: vi.fn(),
  importTableTemplate_ACU: vi.fn(),
  overrideLatestLayerWithTemplate_ACU: vi.fn(),
  resetAllToDefaults_ACU: vi.fn(),
  resetTableTemplate_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/admin-ui', () => ({
  importCombinedSettings_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/update-trigger', () => ({
  exportCombinedSettings_ACU: vi.fn(),
  handleManualMergeSummary_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/triggers/import-process', () => ({
  clearImportLocalStorage_ACU: vi.fn(),
  clearImportedEntries_ACU: vi.fn(),
  deleteImportedEntries_ACU: vi.fn(),
  handleInjectImportedTxtSelected_ACU: mockHandleInjectImportedTxtSelected,
}));

vi.mock('../../src/presentation/components/import-status-ui', () => ({
  handleTxtImportAndSplit_ACU: vi.fn(),
  handleInjectSplitEntriesFull_ACU: vi.fn(),
  handleInjectSplitEntriesStandard_ACU: vi.fn(),
  handleInjectSplitEntriesSummary_ACU: vi.fn(),
}));

vi.mock('../../src/presentation/pages/visualizer', () => ({
  openNewVisualizer_ACU: mockOpenVisualizer,
}));

vi.mock('../../src/service/import/import-executor', () => ({
  importTxtTextAndSplitCore_ACU: mockImportTxtTextAndSplitCore,
  injectImportedSelectedCore_ACU: mockInjectImportedSelectedCore,
}));

import { createDataAdminApi } from '../../src/presentation/bootstrap/api-groups/data-admin-api';

describe('createDataAdminApi', () => {
  it('暴露 openVisualizer 并调用 visualizer 入口', async () => {
    mockOpenVisualizer.mockReset();
    mockOpenVisualizer.mockResolvedValue(undefined);

    const api = createDataAdminApi({} as any);

    expect(typeof api.openVisualizer).toBe('function');
    await api.openVisualizer();

    expect(mockOpenVisualizer).toHaveBeenCalledTimes(1);
  });

  it('暴露 headless TXT 文本拆分 API', async () => {
    mockImportTxtTextAndSplitCore.mockReset();
    mockImportTxtTextAndSplitCore.mockResolvedValue({ success: true, chunksCount: 2 });

    const api = createDataAdminApi({} as any);
    const result = await api.importTxtTextAndSplit('abcdef', { splitSize: 3 });

    expect(result).toEqual({ success: true, chunksCount: 2 });
    expect(mockImportTxtTextAndSplitCore).toHaveBeenCalledWith('abcdef', { splitSize: 3 });
  });

  it('injectImportedSelected 有目标时走 headless，无参时保留旧入口', async () => {
    mockInjectImportedSelectedCore.mockReset();
    mockHandleInjectImportedTxtSelected.mockReset();
    mockInjectImportedSelectedCore.mockResolvedValue({ success: true, processedChunks: 1 });
    mockHandleInjectImportedTxtSelected.mockResolvedValue(undefined);

    const api = createDataAdminApi({} as any);
    await api.injectImportedSelected({ targetWorldbook: 'world', selectedSheetKeys: ['sheet_x'] });
    await api.injectImportedSelected();

    expect(mockInjectImportedSelectedCore).toHaveBeenCalledWith({ targetWorldbook: 'world', selectedSheetKeys: ['sheet_x'] });
    expect(mockHandleInjectImportedTxtSelected).toHaveBeenCalledWith({});
  });
});
