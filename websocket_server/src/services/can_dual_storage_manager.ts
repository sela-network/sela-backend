import { FileService } from './file_service';
import { CanFileService } from './can_file_service';
import { Database } from '../db/database';
import { 
  FileMetadata, 
  FileUploadRequest, 
  EntityResult, 
  REDIS_KEYS 
} from '../db/types';
import { 
  CanStorageConfig, 
  RetrievalStrategy, 
  SyncStatus, 
  SyncOperation,
  StorageStats,
  DEFAULT_CAN_STORAGE_CONFIG 
} from '../config/can_storage_config';

export class CanDualStorageManager {
  private localFileService: FileService;
  private canisterFileService: CanFileService;
  private db: Database;
  private config: CanStorageConfig;
  private syncQueue: Map<string, SyncOperation> = new Map();

  constructor(
    localFileService: FileService,
    canisterFileService: CanFileService,
    db: Database,
    config: CanStorageConfig = DEFAULT_CAN_STORAGE_CONFIG
  ) {
    this.localFileService = localFileService;
    this.canisterFileService = canisterFileService;
    this.db = db;
    this.config = config;
  }

  async storeFile(request: FileUploadRequest, content: Buffer): Promise<EntityResult<FileMetadata>> {
    try {
      console.log(`🔄 Storing file in dual storage system: ${request.name}`);
      
      // Determine storage strategy based on file size and type
      const strategy = this.determineStorageStrategy(request, content);
      console.log(`📊 Storage strategy for ${request.name}: ${strategy}`);
      
      let result: EntityResult<FileMetadata>;
      
      switch (strategy) {
        case 'local':
          result = await this.storeLocally(request, content);
          break;
        case 'canister':
          result = await this.storeInCanister(request, content);
          break;
        case 'dual':
          result = await this.storeDually(request, content);
          break;
        default:
          result = await this.storeLocally(request, content);
      }

      // Update storage strategy in metadata
      if (result.success) {
        await this.updateStorageStrategy(result.data.id, strategy);
      }

      return result;
      
    } catch (error) {
      console.error(`❌ Error storing file in dual storage:`, error);
      return { 
        success: false, 
        error: { type: 'StorageError', message: `Failed to store file: ${error}` }
      };
    }
  }

  async retrieveFile(
    fileId: string, 
    userPrincipalId: string,
    strategy?: RetrievalStrategy
  ): Promise<EntityResult<Buffer>> {
    const retrievalStrategy = strategy || this.config.defaultStrategy;
    
    console.log(`🔄 Retrieving file ${fileId} using strategy: ${retrievalStrategy}`);
    
    switch (retrievalStrategy) {
      case 'local_first':
        return await this.retrieveLocalFirst(fileId, userPrincipalId);
      
      case 'canister_first':
        return await this.retrieveCanisterFirst(fileId, userPrincipalId);
      
      case 'local_only':
        return await this.retrieveLocalOnly(fileId, userPrincipalId);
      
      case 'canister_only':
        return await this.retrieveCanisterOnly(fileId, userPrincipalId);
      
      case 'fastest_available':
        return await this.retrieveFastestAvailable(fileId, userPrincipalId);
      
      case 'preferred_with_fallback':
        return await this.retrievePreferredWithFallback(fileId, userPrincipalId);
      
      default:
        return await this.retrieveLocalFirst(fileId, userPrincipalId);
    }
  }

  async deleteFile(fileId: string, userPrincipalId: string): Promise<EntityResult<void>> {
    try {
      console.log(`🔄 Deleting file ${fileId} from local storage (canister deletion disabled)`);
      
      // Get file metadata to determine storage locations
      const metadataResult = await this.localFileService.getFile(fileId);
      if (!metadataResult.success) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'File not found' }
        };
      }

      const metadata = metadataResult.data;

      // Only delete from local storage (canister deletion is disabled)
      if (metadata.storage_strategy === 'local' || metadata.storage_strategy === 'dual') {
        const localResult = await this.localFileService.deleteFile(fileId, userPrincipalId);
        if (localResult.success) {
          console.log(`✅ File ${fileId} deleted from local storage`);
          return { success: true, data: undefined };
        } else {
          console.warn(`⚠️ Failed to delete file from local storage: ${fileId}`);
          return { 
            success: false, 
            error: { type: 'StorageError', message: 'Failed to delete file from local storage' }
          };
        }
      } else {
        console.log(`⚠️ File ${fileId} is canister-only, cannot delete (deletion disabled)`);
        return { 
          success: false, 
          error: { type: 'StorageError', message: 'Cannot delete canister-only files (deletion disabled)' }
        };
      }
      
    } catch (error) {
      console.error(`❌ Error deleting file ${fileId}:`, error);
      return { 
        success: false, 
        error: { type: 'StorageError', message: `Failed to delete file: ${error}` }
      };
    }
  }

  // Storage strategy determination
  private determineStorageStrategy(request: FileUploadRequest, content: Buffer): 'local' | 'canister' | 'dual' {
    const fileSize = content.length;
    const isCritical = this.isCriticalFile(request);
    
    // Small files go to local storage only
    if (fileSize < this.config.smallFileThreshold) {
      return 'local';
    }
    
    // Critical files get dual storage
    if (isCritical) {
      return 'dual';
    }
    
    // Large files go to canister only
    if (fileSize > this.config.largeFileThreshold) {
      return 'canister';
    }
    
    // Default to dual storage for medium files
    return 'dual';
  }

  private isCriticalFile(request: FileUploadRequest): boolean {
    return this.config.criticalFileTypes.includes(request.content_type) ||
           this.config.criticalFileExtensions.some(ext => request.name.endsWith(ext));
  }

  // Storage implementations
  private async storeLocally(request: FileUploadRequest, content: Buffer): Promise<EntityResult<FileMetadata>> {
    const result = await this.localFileService.createFile(request);
    if (result.success) {
      await this.localFileService.writeFileData(result.data.file_path, content);
    }
    return result;
  }

  private async storeInCanister(request: FileUploadRequest, content: Buffer): Promise<EntityResult<FileMetadata>> {
    // Create temporary metadata for canister storage
    const tempMetadata: FileMetadata = {
      id: await this.generateFileId(),
      name: request.name,
      content_type: request.content_type,
      size: request.size,
      created_at: Date.now(),
      updated_at: Date.now(),
      user_principal_id: request.user_principal_id,
      job_id: request.job_id,
      file_path: '', // Not used for canister-only storage
      storage_strategy: 'canister',
      sync_status: 'synced'
    };

    // Use original filename as canister key (no prefix)
    const canisterKey = request.name;
    tempMetadata.canister_file_key = canisterKey;

    const canisterResult = await this.canisterFileService.storeFile(content, tempMetadata, canisterKey);
    if (canisterResult.success) {
      await this.updateFileMetadata(tempMetadata);
    }
    
    return canisterResult.success ? 
      { success: true, data: tempMetadata } : 
      { success: false, error: canisterResult.error };
  }

  private async storeDually(request: FileUploadRequest, content: Buffer): Promise<EntityResult<FileMetadata>> {
    // Step 1: Store locally first (fast)
    const localResult = await this.localFileService.createFile(request);
    if (!localResult.success) {
      return localResult;
    }

    const fileMetadata = localResult.data;
    
    // Step 2: Write file content locally
    await this.localFileService.writeFileData(fileMetadata.file_path, content);
    
    // Step 3: Store in canister (async, don't wait)
    this.storeInCanisterAsync(fileMetadata, content);
    
    // Step 4: Update metadata with dual storage info
    const canisterKey = fileMetadata.name; // Use original filename as canister key
    const updatedMetadata = {
      ...fileMetadata,
      storage_strategy: 'dual' as const,
      local_file_path: fileMetadata.file_path,
      canister_file_key: canisterKey, // Use original filename as canister key
      sync_status: 'syncing' as SyncStatus
    };

    await this.updateFileMetadata(updatedMetadata);
    
    console.log(`✅ File stored in dual storage:`);
    console.log(`   Local: ${fileMetadata.file_path}`);
    console.log(`   Canister: ${fileMetadata.name}`);
    
    return { success: true, data: updatedMetadata };
  }

  // Retrieval implementations
  private async retrieveLocalFirst(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    try {
      // ⚠️ CRITICAL: Use getFileContentLocalOnly to prevent infinite recursion
      const localResult = await this.localFileService.getFileContentLocalOnly(fileId, userPrincipalId);
      if (localResult.success) {
        console.log(`✅ File ${fileId} retrieved from local storage`);
        return localResult;
      }

      console.log(`⚠️ Local file not found, trying canister storage for ${fileId}`);
      const canisterResult = await this.retrieveFromCanister(fileId, userPrincipalId);
      
      if (canisterResult.success && this.config.syncOnAccess) {
        // Restore to local for future fast access
        this.restoreToLocalAsync(fileId, canisterResult.data, userPrincipalId);
      }
      
      return canisterResult;
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'StorageError', message: `Retrieval failed: ${error}` }
      };
    }
  }

  private async retrieveCanisterFirst(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    try {
      const canisterResult = await this.retrieveFromCanister(fileId, userPrincipalId);
      if (canisterResult.success) {
        console.log(`✅ File ${fileId} retrieved from canister storage`);
        
        // Cache to local for future fast access
        this.restoreToLocalAsync(fileId, canisterResult.data, userPrincipalId);
        return canisterResult;
      }

      console.log(`⚠️ Canister file not found, trying local storage for ${fileId}`);
      // ⚠️ CRITICAL: Use getFileContentLocalOnly to prevent infinite recursion
      const localResult = await this.localFileService.getFileContentLocalOnly(fileId, userPrincipalId);
      
      if (localResult.success && this.config.syncOnAccess) {
        // Sync to canister for backup
        this.syncToCanisterAsync(fileId, localResult.data, userPrincipalId);
      }
      
      return localResult;
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'StorageError', message: `Retrieval failed: ${error}` }
      };
    }
  }

  private async retrieveLocalOnly(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    // ⚠️ CRITICAL: Use getFileContentLocalOnly to prevent infinite recursion
    return await this.localFileService.getFileContentLocalOnly(fileId, userPrincipalId);
  }

  private async retrieveCanisterOnly(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    return await this.retrieveFromCanister(fileId, userPrincipalId);
  }

  private async retrieveFastestAvailable(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    try {
      // ⚠️ CRITICAL: Use getFileContentLocalOnly to prevent infinite recursion
      const [localPromise, canisterPromise] = await Promise.allSettled([
        this.localFileService.getFileContentLocalOnly(fileId, userPrincipalId),
        this.retrieveFromCanister(fileId, userPrincipalId)
      ]);

      // Check local result first (usually faster)
      if (localPromise.status === 'fulfilled' && localPromise.value.success) {
        console.log(`✅ File ${fileId} retrieved from local storage (fastest)`);
        return localPromise.value;
      }

      // Check canister result
      if (canisterPromise.status === 'fulfilled' && canisterPromise.value.success) {
        console.log(`✅ File ${fileId} retrieved from canister storage (fastest)`);
        // Cache to local for future access
        this.restoreToLocalAsync(fileId, canisterPromise.value.data, userPrincipalId);
        return canisterPromise.value;
      }

      // Both failed
      return { 
        success: false, 
        error: { type: 'StorageError', message: 'Both storage locations failed' }
      };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'StorageError', message: `Retrieval failed: ${error}` }
      };
    }
  }

  private async retrievePreferredWithFallback(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    if (this.config.preferredStorage === 'local') {
      return await this.retrieveLocalFirst(fileId, userPrincipalId);
    } else {
      return await this.retrieveCanisterFirst(fileId, userPrincipalId);
    }
  }

  // Helper methods
  private async retrieveFromCanister(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    try {
      const metadataResult = await this.localFileService.getFile(fileId);
      if (!metadataResult.success) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'File metadata not found' }
        };
      }

      // Use canister_file_key if available, otherwise use original filename
      const canisterKey = metadataResult.data.canister_file_key || metadataResult.data.name;
      console.log(`🔄 Retrieving from canister with key: ${canisterKey}`);
      return await this.canisterFileService.retrieveFile(canisterKey);
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'CanisterError', message: `Canister retrieval failed: ${error}` }
      };
    }
  }

  private async storeInCanisterAsync(metadata: FileMetadata, content: Buffer): Promise<void> {
    try {
      console.log(`🔄 Syncing file ${metadata.id} to canister...`);
      
      const canisterKey = metadata.name; // Use original filename as canister key
      const canisterResult = await this.canisterFileService.storeFile(content, metadata, canisterKey);
      
      if (canisterResult.success) {
        await this.updateSyncStatus(metadata.id, 'synced');
        console.log(`✅ File ${metadata.id} synced to canister successfully with key: ${canisterKey}`);
      } else {
        await this.updateSyncStatus(metadata.id, 'sync_failed');
        console.error(`❌ Failed to sync file ${metadata.id} to canister:`, canisterResult.error);
        this.addToRetryQueue(metadata.id, content);
      }
    } catch (error) {
      console.error(`❌ Exception during canister sync:`, error);
      await this.updateSyncStatus(metadata.id, 'sync_failed');
    }
  }

  private async restoreToLocalAsync(fileId: string, content: Buffer, userPrincipalId: string): Promise<void> {
    try {
      const metadataResult = await this.localFileService.getFile(fileId);
      if (metadataResult.success) {
        await this.localFileService.writeFileData(metadataResult.data.file_path, content);
        console.log(`✅ File ${fileId} restored to local storage`);
      }
    } catch (error) {
      console.error(`❌ Failed to restore file ${fileId} to local storage:`, error);
    }
  }

  private async syncToCanisterAsync(fileId: string, content: Buffer, userPrincipalId: string): Promise<void> {
    try {
      const metadataResult = await this.localFileService.getFile(fileId);
      if (metadataResult.success) {
        const canisterKey = metadataResult.data.name; // Use original filename as canister key
        await this.canisterFileService.storeFile(content, metadataResult.data, canisterKey);
        console.log(`✅ File ${fileId} synced to canister storage with key: ${canisterKey}`);
      }
    } catch (error) {
      console.error(`❌ Failed to sync file ${fileId} to canister:`, error);
    }
  }

  // Metadata management
  private async updateStorageStrategy(fileId: string, strategy: 'local' | 'canister' | 'dual'): Promise<void> {
    const key = `${REDIS_KEYS.FILE}${fileId}`;
    const metadata = await this.db.getFileMetadata(key);
    if (metadata) {
      const fileData = JSON.parse(metadata);
      fileData.storage_strategy = strategy;
      fileData.updated_at = Date.now();
      await this.db.setFileMetadata(key, JSON.stringify(fileData));
    }
  }

  private async updateSyncStatus(fileId: string, status: SyncStatus): Promise<void> {
    const key = `${REDIS_KEYS.FILE}${fileId}`;
    const metadata = await this.db.getFileMetadata(key);
    if (metadata) {
      const fileData = JSON.parse(metadata);
      fileData.sync_status = status;
      fileData.updated_at = Date.now();
      await this.db.setFileMetadata(key, JSON.stringify(fileData));
    }
  }

  private async updateFileMetadata(metadata: FileMetadata): Promise<void> {
    const key = `${REDIS_KEYS.FILE}${metadata.id}`;
    await this.db.setFileMetadata(key, JSON.stringify(metadata));
  }

  private addToRetryQueue(fileId: string, content: Buffer): void {
    this.syncQueue.set(fileId, {
      fileId,
      content,
      retryCount: 0,
      lastRetry: Date.now()
    });
  }

  private async generateFileId(): Promise<string> {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `file_${timestamp}_${random}`;
  }

  // Background sync retry process
  async processRetryQueue(): Promise<void> {
    for (const [fileId, operation] of this.syncQueue) {
      if (operation.retryCount < this.config.syncRetryAttempts) {
        try {
          const metadataResult = await this.localFileService.getFile(fileId);
          if (metadataResult.success) {
            const canisterResult = await this.canisterFileService.storeFile(operation.content, metadataResult.data);
            if (canisterResult.success) {
              this.syncQueue.delete(fileId);
              await this.updateSyncStatus(fileId, 'synced');
              console.log(`✅ Retry successful for file ${fileId}`);
            } else {
              operation.retryCount++;
              operation.lastRetry = Date.now();
            }
          }
        } catch (error) {
          operation.retryCount++;
          operation.lastRetry = Date.now();
        }
      } else {
        this.syncQueue.delete(fileId);
        await this.updateSyncStatus(fileId, 'sync_failed_permanently');
        console.error(`❌ Max retries reached for file ${fileId}, giving up`);
      }
    }
  }

  // Get storage statistics
  async getStorageStats(): Promise<EntityResult<StorageStats>> {
    try {
      const canisterStats = await this.canisterFileService.getStorageStats();
      
      return {
        success: true,
        data: {
          local: {
            totalFiles: 0, // Would need to implement local file counting
            totalSize: 0,  // Would need to implement local size calculation
            lastSync: Date.now()
          },
          canister: {
            totalFiles: canisterStats.success ? canisterStats.data.total_files : 0,
            totalSize: canisterStats.success ? canisterStats.data.total_size : 0,
            lastSync: Date.now()
          },
          sync: {
            pending: this.syncQueue.size,
            failed: 0, // Would need to track failed syncs
            synced: 0  // Would need to track successful syncs
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: { type: 'StorageError', message: `Failed to get storage stats: ${error}` }
      };
    }
  }
}
