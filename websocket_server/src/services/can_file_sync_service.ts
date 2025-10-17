import { CanDualStorageManager } from './can_dual_storage_manager';
import { CanStorageConfig, DEFAULT_CAN_STORAGE_CONFIG } from '../config/can_storage_config';

export class CanFileSyncService {
  private dualStorageManager: CanDualStorageManager;
  private syncInterval: NodeJS.Timeout | null = null;
  private config: CanStorageConfig;

  constructor(
    dualStorageManager: CanDualStorageManager,
    config: CanStorageConfig = DEFAULT_CAN_STORAGE_CONFIG
  ) {
    this.dualStorageManager = dualStorageManager;
    this.config = config;
  }

  startSyncService(): void {
    if (!this.config.autoSync) {
      console.log('🔄 File sync service disabled (autoSync = false)');
      return;
    }

    // Process retry queue every configured interval
    this.syncInterval = setInterval(async () => {
      try {
        await this.dualStorageManager.processRetryQueue();
      } catch (error) {
        console.error('❌ Error in sync service:', error);
      }
    }, this.config.syncRetryInterval);

    console.log(`🔄 File sync service started (interval: ${this.config.syncRetryInterval}ms)`);
  }

  stopSyncService(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('🛑 File sync service stopped');
  }

  // Manual sync trigger
  async syncFile(fileId: string, direction: 'to_canister' | 'to_local' = 'to_canister'): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`🔄 Manual sync triggered for file ${fileId} (direction: ${direction})`);
      
      // This would need to be implemented in the dual storage manager
      // For now, just process the retry queue
      await this.dualStorageManager.processRetryQueue();
      
      return { success: true };
    } catch (error) {
      console.error(`❌ Manual sync failed for file ${fileId}:`, error);
      return { 
        success: false, 
        error: `Sync failed: ${error}` 
      };
    }
  }

  // Get sync status
  getSyncStatus(): { isRunning: boolean; interval: number; autoSync: boolean } {
    return {
      isRunning: this.syncInterval !== null,
      interval: this.config.syncRetryInterval,
      autoSync: this.config.autoSync
    };
  }
}

