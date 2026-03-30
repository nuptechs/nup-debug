// ============================================================
// Storage — Factory + re-exports
// ============================================================

export { FileStorageAdapter } from './file-storage.adapter.js';
export { MemoryStorageAdapter } from './memory-storage.adapter.js';
export { StoragePort, type EventFilter } from '../ports/storage.port.js';

import type { StorageConfig } from '../types/config.js';
import type { StoragePort } from '../ports/storage.port.js';
import { FileStorageAdapter } from './file-storage.adapter.js';
import { MemoryStorageAdapter } from './memory-storage.adapter.js';

export function createStorage(config: StorageConfig): StoragePort {
  if (config.type === 'file') {
    return new FileStorageAdapter(config.basePath ?? '.probe-data');
  }
  return new MemoryStorageAdapter();
}
