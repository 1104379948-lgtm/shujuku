import { describe, expect, it, vi } from 'vitest';

const { mockOpenVisualizer } = vi.hoisted(() => ({
  mockOpenVisualizer: vi.fn(),
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
  handleInjectImportedTxtSelected_ACU: vi.fn(),
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
});
