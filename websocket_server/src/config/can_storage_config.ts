export type RetrievalStrategy = 
  | 'local_first'      // Try local → fallback to canister
  | 'canister_first'   // Try canister → fallback to local  
  | 'local_only'       // Only try local storage
  | 'canister_only'    // Only try canister storage
  | 'dual'             // Store in both local and canister
  | 'fastest_available' // Try both simultaneously, use whichever responds first
  | 'preferred_with_fallback'; // Use preferred storage with fallback

export interface CanStorageConfig {
  // Dual storage settings
  useDualStorage: boolean;
  canisterId: string;
  
  // Sync settings
  syncRetryAttempts: number;
  syncRetryInterval: number; // milliseconds
  autoSync: boolean;
  syncOnAccess: boolean; // Sync when file is accessed from canister
  
  // Retrieval settings
  defaultStrategy: RetrievalStrategy;
  preferredStorage: 'local' | 'canister';
  enableFallback: boolean;
  parallelRetrieval: boolean; // For fastest_available strategy
  timeoutMs: number;
  retryAttempts: number;
  
  // File size thresholds
  smallFileThreshold: number; // bytes - files smaller than this go to local only
  largeFileThreshold: number; // bytes - files larger than this go to canister only
  
  // Critical file types (get dual storage)
  criticalFileTypes: string[];
  criticalFileExtensions: string[];
}

export const DEFAULT_CAN_STORAGE_CONFIG: CanStorageConfig = {
  // Dual storage settings
  useDualStorage: process.env.CANISTER_STORAGE_ENABLED === 'true',
  canisterId: process.env.FILE_STORAGE_CANISTER_ID || '',
  
  // Sync settings
  syncRetryAttempts: 3,
  syncRetryInterval: 5 * 60 * 1000, // 5 minutes
  autoSync: true,
  syncOnAccess: true,
  
  // Retrieval settings
  defaultStrategy: 'dual',
  preferredStorage: 'local',
  enableFallback: true,
  parallelRetrieval: true,
  timeoutMs: 10000, // 10 seconds
  retryAttempts: 3,
  
  // File size thresholds
  smallFileThreshold: 1024, // 1KB - allow small files in canister
  largeFileThreshold: 10 * 1024 * 1024, // 10MB
  
  // Critical file types (get dual storage)
  criticalFileTypes: ['application/json', 'text/html'],
  criticalFileExtensions: ['.json', '.html', '.xml']
};

export const RETRIEVAL_STRATEGIES = {
  // For high-performance scenarios
  PERFORMANCE: {
    defaultStrategy: 'fastest_available' as RetrievalStrategy,
    preferredStorage: 'local' as const,
    enableFallback: true,
    parallelRetrieval: true,
    timeoutMs: 5000,
    retryAttempts: 2
  },
  
  // For reliability scenarios
  RELIABILITY: {
    defaultStrategy: 'preferred_with_fallback' as RetrievalStrategy,
    preferredStorage: 'canister' as const,
    enableFallback: true,
    parallelRetrieval: false,
    timeoutMs: 15000,
    retryAttempts: 5
  },
  
  // For cost optimization
  COST_OPTIMIZED: {
    defaultStrategy: 'local_first' as RetrievalStrategy,
    preferredStorage: 'local' as const,
    enableFallback: true,
    parallelRetrieval: false,
    timeoutMs: 10000,
    retryAttempts: 3
  },
  
  // For canister-first scenarios
  CANISTER_FIRST: {
    defaultStrategy: 'canister_first' as RetrievalStrategy,
    preferredStorage: 'canister' as const,
    enableFallback: true,
    parallelRetrieval: false,
    timeoutMs: 12000,
    retryAttempts: 3
  }
};

export type SyncStatus = 'syncing' | 'synced' | 'sync_failed' | 'sync_failed_permanently';

export interface SyncOperation {
  fileId: string;
  content: Buffer;
  retryCount: number;
  lastRetry: number;
}

export interface StorageStats {
  local: {
    totalFiles: number;
    totalSize: number;
    lastSync: number;
  };
  canister: {
    totalFiles: number;
    totalSize: number;
    lastSync: number;
  };
  sync: {
    pending: number;
    failed: number;
    synced: number;
  };
}

