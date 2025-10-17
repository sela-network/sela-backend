# Canister File Storage System

## Overview

The Sela Network WebSocket Server now includes a **dual file storage system** that combines local filesystem storage with ICP canister storage. This provides both performance and reliability benefits.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Dual File Storage System                     │
├─────────────────────────────────────────────────────────────┤
│  FileService (Enhanced)                                    │
│  ├── Local Storage: data/redis/{user_id}/{job_id}/         │
│  ├── Canister Storage: ICP Canister (can_file_storage)     │
│  └── Dual Storage Manager: Intelligent routing             │
│                                                             │
│  Storage Strategies:                                        │
│  ├── local: Small files (< 1MB)                            │
│  ├── canister: Large files (> 10MB)                        │
│  └── dual: Critical files (JSON, HTML)                     │
│                                                             │
│  Retrieval Strategies:                                      │
│  ├── local_first: Try local → fallback to canister         │
│  ├── canister_first: Try canister → fallback to local      │
│  ├── fastest_available: Try both, use first response       │
│  └── preferred_with_fallback: Use preferred with fallback  │
└─────────────────────────────────────────────────────────────┘
```

## Features

### 🎯 **Smart Storage Strategy**
- **Small files** (< 1MB): Local storage only
- **Large files** (> 10MB): Canister storage only  
- **Critical files** (JSON, HTML): Dual storage
- **Medium files**: Dual storage by default

### 🔄 **Flexible Retrieval**
- **Local First**: Fast local access with canister fallback
- **Canister First**: Canister access with local fallback
- **Fastest Available**: Parallel retrieval, use first response
- **Preferred with Fallback**: Use preferred storage with fallback

### 🔄 **Automatic Sync**
- Background sync service
- Retry failed syncs
- Sync on access
- Configurable sync intervals

### 📁 **File Naming Convention**
- **Local files**: `scrape_result_job123.json`
- **Canister files**: `can_scrape_result_job123.json` (with "can_" prefix)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Canister

```bash
# Run the setup script
./scripts/setup-canister.sh

# Or manually:
dfx start --background
dfx deploy can_file_storage
```

### 3. Configure Environment

Add to your `.env` file:

```env
# Canister File Storage
CANISTER_STORAGE_ENABLED=true
FILE_STORAGE_CANISTER_ID=rrkah-fqaaa-aaaah-qcaiq-cai
CANISTER_STORAGE_STRATEGY=dual
CANISTER_SYNC_ENABLED=true
CANISTER_SYNC_INTERVAL=300000
```

### 4. Start Server

```bash
# Start with canister support
npm run dev:with-canister

# Or start normally (will use local storage only if canister disabled)
npm run dev:hybrid
```

## Usage

### File Storage

Files are automatically stored using the dual storage system:

```typescript
// Files are stored based on size and type
const fileResult = await fileService.createFileFromJobResult({
  jobId: 'job123',
  content: '<html>...</html>',
  contentType: 'text/html',
  fileName: 'scrape_result_job123.html',
  userPrincipalId: 'user_principal_id'
});

// Result will be stored in both local and canister storage
// Local: data/redis/user_id/job_id/scrape_result_job123.html
// Canister: can_scrape_result_job123.html
```

### File Retrieval

```typescript
// Retrieve with different strategies
const content = await fileService.getFileContent(fileId, userPrincipalId);

// The system automatically:
// 1. Determines the best retrieval strategy
// 2. Tries preferred storage first
// 3. Falls back to alternative storage
// 4. Syncs files if needed
```

## Configuration

### Storage Configuration

```typescript
// src/config/can_storage_config.ts
export const DEFAULT_CAN_STORAGE_CONFIG: CanStorageConfig = {
  useDualStorage: true,
  canisterId: process.env.FILE_STORAGE_CANISTER_ID,
  
  // File size thresholds
  smallFileThreshold: 1024 * 1024,    // 1MB
  largeFileThreshold: 10 * 1024 * 1024, // 10MB
  
  // Critical file types (get dual storage)
  criticalFileTypes: ['application/json', 'text/html'],
  criticalFileExtensions: ['.json', '.html', '.xml'],
  
  // Retrieval strategy
  defaultStrategy: 'local_first',
  preferredStorage: 'local',
  enableFallback: true,
  
  // Sync settings
  autoSync: true,
  syncOnAccess: true,
  syncRetryAttempts: 3,
  syncRetryInterval: 5 * 60 * 1000, // 5 minutes
};
```

### Retrieval Strategies

```typescript
// Performance optimized
const perfConfig = RETRIEVAL_STRATEGIES.PERFORMANCE;

// Reliability focused
const relConfig = RETRIEVAL_STRATEGIES.RELIABILITY;

// Cost optimized
const costConfig = RETRIEVAL_STRATEGIES.COST_OPTIMIZED;

// Canister first
const canConfig = RETRIEVAL_STRATEGIES.CANISTER_FIRST;
```

## API Endpoints

### File Management

- `GET /api/files` - List files
- `GET /api/files/:id` - Get file metadata
- `GET /api/files/:id/download` - Download file
- `DELETE /api/files/:id` - Delete file

### Storage Management

- `GET /api/storage/stats` - Get storage statistics
- `POST /api/storage/sync` - Manual sync trigger
- `GET /api/storage/health` - Storage health check

## Monitoring

### Storage Statistics

```typescript
const stats = await dualStorageManager.getStorageStats();
console.log({
  local: {
    totalFiles: stats.local.totalFiles,
    totalSize: stats.local.totalSize
  },
  canister: {
    totalFiles: stats.canister.totalFiles,
    totalSize: stats.canister.totalSize
  },
  sync: {
    pending: stats.sync.pending,
    failed: stats.sync.failed,
    synced: stats.sync.synced
  }
});
```

### Health Checks

```typescript
// Check canister health
const canisterHealth = await canFileService.healthCheck();

// Check sync service status
const syncStatus = syncService.getSyncStatus();
```

## Troubleshooting

### Common Issues

1. **Canister not responding**
   ```bash
   # Check canister status
   dfx canister status can_file_storage
   
   # Restart canister
   dfx stop
   dfx start --background
   dfx deploy can_file_storage
   ```

2. **Sync failures**
   ```bash
   # Check sync queue
   curl http://localhost:8082/api/storage/stats
   
   # Manual sync
   curl -X POST http://localhost:8082/api/storage/sync
   ```

3. **File not found**
   - Check both local and canister storage
   - Verify file metadata
   - Check sync status

### Debug Mode

```bash
# Enable debug logging
DEBUG=canister:* npm run dev:hybrid

# Check canister logs
dfx canister call can_file_storage get_storage_stats
```

## Performance

### Benchmarks

- **Local storage**: ~1ms access time
- **Canister storage**: ~100-500ms access time
- **Dual storage**: ~1ms (local) + background sync
- **Fastest available**: ~1ms (whichever responds first)

### Optimization Tips

1. **Use local_first** for high-performance scenarios
2. **Use canister_first** for reliability scenarios
3. **Use fastest_available** for balanced performance
4. **Adjust file size thresholds** based on your needs
5. **Enable sync on access** for better user experience

## Security

### Access Control

- Files are isolated by user principal ID
- Canister access requires proper authentication
- Local files are protected by filesystem permissions

### Data Integrity

- SHA-256 hashes for file verification
- Automatic sync ensures data consistency
- Retry mechanisms for failed operations

## Migration

### From Local-Only to Dual Storage

1. Enable canister storage in environment
2. Deploy canister
3. Restart server
4. Existing files remain local-only
5. New files use dual storage

### From Dual Storage to Local-Only

1. Disable canister storage in environment
2. Restart server
3. Files remain in both locations
4. New files use local-only storage

## Development

### Adding New Storage Strategies

```typescript
// Add new strategy in can_storage_config.ts
export const CUSTOM_STRATEGY = {
  defaultStrategy: 'custom' as RetrievalStrategy,
  // ... other config
};

// Implement in dual_storage_manager.ts
private async retrieveCustom(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
  // Custom retrieval logic
}
```

### Testing

```bash
# Test canister functionality
npm run canister:call health_check

# Test file storage
npm run test

# Test dual storage
npm run test:dual-storage
```

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review logs for error messages
3. Verify canister status
4. Check environment configuration
5. Create an issue on GitHub

---

**Note**: This system is designed to be backward compatible. If canister storage is disabled, the system falls back to local-only storage seamlessly.



**URL**: Backend canister via Candid interface:
can_file_storage: https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=qe3z4-yiaaa-aaaam-aeoyq-cai
icrc:https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=y5ego-zyaaa-aaaao-qkfhq-cai

LOCAL:
http://127.0.0.1:4943/?canisterId=u6s2n-gx777-77774-qaaba-cai&id=uxrrr-q7777-77774-qaaaq-cai

