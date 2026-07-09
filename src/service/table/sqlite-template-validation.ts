import { SqliteEngine } from '../../data/sqlite/sqlite-engine';
import { SyncBridge } from '../../data/sqlite/sync-bridge';

export async function validateSqliteTemplateDataStrict_ACU(tableData: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    const engine = new SqliteEngine();
    const syncBridge = new SyncBridge(engine);
    try {
        await engine.init();
        syncBridge.loadFromTableData(tableData as any, { strict: true });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
    } finally {
        engine.dispose();
    }
}
