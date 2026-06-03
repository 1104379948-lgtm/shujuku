/**
 * tests/shared/table-storage-metadata.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
    TABLE_STORAGE_VERSION_ACU,
    isSupportedTableStorageVersion_ACU,
    normalizeTableTagStorageMetadata_ACU
} from '../../src/shared/table-storage-metadata';
import type { IsolationTagData_ACU } from '../../src/data/models/chat-message-data';

describe('table-storage-metadata', () => {
    describe('isSupportedTableStorageVersion_ACU', () => {
        it('should return true for null/undefined', () => {
            expect(isSupportedTableStorageVersion_ACU(null)).toBe(true);
            expect(isSupportedTableStorageVersion_ACU(undefined)).toBe(true);
        });

        it('should return true for tagData without version (legacy)', () => {
            expect(isSupportedTableStorageVersion_ACU({} as IsolationTagData_ACU)).toBe(true);
        });

        it('should return true for version <= TABLE_STORAGE_VERSION_ACU', () => {
            expect(isSupportedTableStorageVersion_ACU({ _acu_storage_version: TABLE_STORAGE_VERSION_ACU } as IsolationTagData_ACU)).toBe(true);
            expect(isSupportedTableStorageVersion_ACU({ _acu_storage_version: TABLE_STORAGE_VERSION_ACU - 1 } as IsolationTagData_ACU)).toBe(true);
        });

        it('should return false for future versions', () => {
            expect(isSupportedTableStorageVersion_ACU({ _acu_storage_version: TABLE_STORAGE_VERSION_ACU + 1 } as IsolationTagData_ACU)).toBe(false);
        });
    });

    describe('normalizeTableTagStorageMetadata_ACU', () => {
        it('should return defaults for null', () => {
            const res = normalizeTableTagStorageMetadata_ACU(null);
            expect(res.mode).toBe('checkpoint');
            expect(res.version).toBe(TABLE_STORAGE_VERSION_ACU);
            expect(res.supported).toBe(true);
        });

        it('should respect fallbackMode for legacy tagData', () => {
            const res = normalizeTableTagStorageMetadata_ACU({} as IsolationTagData_ACU, 'legacy');
            expect(res.mode).toBe('legacy');
            expect(res.version).toBe(TABLE_STORAGE_VERSION_ACU);
            expect(res.supported).toBe(true);
        });

        it('should preserve valid mode and version', () => {
            const tag: any = { _acu_storage_mode: 'delta', _acu_storage_version: TABLE_STORAGE_VERSION_ACU };
            const res = normalizeTableTagStorageMetadata_ACU(tag);
            expect(res.mode).toBe('delta');
            expect(res.version).toBe(TABLE_STORAGE_VERSION_ACU);
            expect(res.supported).toBe(true);
        });

        it('should flag unsupported for future version', () => {
            const tag: any = { _acu_storage_mode: 'delta', _acu_storage_version: TABLE_STORAGE_VERSION_ACU + 1 };
            const res = normalizeTableTagStorageMetadata_ACU(tag);
            expect(res.mode).toBe('delta');
            expect(res.version).toBe(TABLE_STORAGE_VERSION_ACU + 1);
            expect(res.supported).toBe(false);
        });
    });
});
