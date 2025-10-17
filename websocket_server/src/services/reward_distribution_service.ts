import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';
import { Database } from '../db/database';
import { BlockchainService, BlockchainTransactionRequest } from './blockchain_service';
import { UptimeTracker } from './uptime_tracker';
import { ReferralDistributionService } from './referral_distribution_service';
import { 
  DailyUptimeRecord, 
  RewardTransaction, 
  RewardDistributionStatus,
  PerformanceTier,
  UptimeConfig,
  EntityResult,
  REDIS_KEYS
} from '../db/types';


export interface RewardCalculationResult {
  userPrincipalId: string;
  uptimeMinutes: number;
  tierLevel: number;
  baseReward: number;
  bonusReward: number;
  totalReward: number;
  dailyRecord: DailyUptimeRecord;
}

export class RewardDistributionService {
  private db: Database;
  private blockchainService: BlockchainService;
  private uptimeTracker: UptimeTracker;
  private referralService?: any;
  private referralDistributionService?: ReferralDistributionService;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private logStream: fs.WriteStream | null = null;
  private currentLogFile: string = '';
  private lastWeeklyReferralCheck: string = '';

  constructor(db: Database, blockchainService: BlockchainService, uptimeTracker: UptimeTracker) {
    this.db = db;
    this.blockchainService = blockchainService;
    this.uptimeTracker = uptimeTracker;

    this.initializeLogDirectory();
  }

  /**
   * Set referral service for referral reward distribution
   */
  setReferralService(referralService: any): void {
    this.referralService = referralService;
    this.log('INFO', 'RewardDistributionService', '✅ ReferralService integrated');
  }

  /**
   * Set referral distribution service for scheduled referral rewards
   */
  setReferralDistributionService(referralDistributionService: ReferralDistributionService): void {
    this.referralDistributionService = referralDistributionService;
    this.log('INFO', 'RewardDistributionService', '✅ ReferralDistributionService integrated');
  }

  private initializeLogDirectory(): void {
    try {
      const config = this.uptimeTracker.getConfig();
      
      if (!fs.existsSync(config.reward_log_directory)) {
        fs.mkdirSync(config.reward_log_directory, { recursive: true });
        console.log(`📁 Created reward distribution log directory: ${config.reward_log_directory}`);
      }

      this.createNewLogFile();
      
      this.log('INFO', 'RewardDistributionService', 'Service initialized', {
        config: {
          enabled: config.reward_distribution_enabled,
          interval: config.reward_distribution_interval,
          logDirectory: config.reward_log_directory
        }
      });
    } catch (error) {
      console.error('❌ Failed to initialize log directory:', error);
    }
  }


  private createNewLogFile(): void {
    try {
      const config = this.uptimeTracker.getConfig();
      
      if (this.logStream) {
        this.logStream.end();
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      this.currentLogFile = path.join(config.reward_log_directory, `reward-distribution-${timestamp}.log`);
      
      this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
      
      this.log('INFO', 'RewardDistributionService', 'New log file created', {
        logFile: this.currentLogFile
      });
    } catch (error) {
      console.error('❌ Failed to create new log file:', error);
    }
  }


  private checkLogRotation(): void {
    try {
      const config = this.uptimeTracker.getConfig();
      const maxLogSize = config.reward_max_log_size_mb * 1024 * 1024; // Convert MB to bytes
      
      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size >= maxLogSize) {
          this.log('INFO', 'RewardDistributionService', 'Log file size limit reached, rotating', {
            currentSize: stats.size,
            maxSize: maxLogSize
          });
          this.createNewLogFile();
          this.cleanupOldLogFiles();
        }
      }
    } catch (error) {
      console.error('❌ Failed to check log rotation:', error);
    }
  }


  private cleanupOldLogFiles(): void {
    try {
      const config = this.uptimeTracker.getConfig();
      
      const files = fs.readdirSync(config.reward_log_directory)
        .filter(file => file.startsWith('reward-distribution-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(config.reward_log_directory, file),
          stats: fs.statSync(path.join(config.reward_log_directory, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      if (files.length > config.reward_max_log_files) {
        const filesToRemove = files.slice(config.reward_max_log_files);
        filesToRemove.forEach(file => {
          fs.unlinkSync(file.path);
          this.log('INFO', 'RewardDistributionService', 'Old log file removed', {
            removedFile: file.name
          });
        });
      }
    } catch (error) {
      console.error('❌ Failed to cleanup old log files:', error);
    }
  }


  private log(level: string, component: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      component,
      message,
      data
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    if (this.logStream) {
      this.logStream.write(logLine);
    }

    const consoleMessage = `[${timestamp}] [${level}] [${component}] ${message}`;
    if (data) {
      console.log(consoleMessage, data);
    } else {
      console.log(consoleMessage);
    }

    this.checkLogRotation();
  }


  async start(): Promise<void> {
    const config = this.uptimeTracker.getConfig();
    
    if (!config.reward_distribution_enabled) {
      this.log('INFO', 'RewardDistributionService', 'Service disabled in configuration');
      return;
    }

    if (this.isRunning) {
      this.log('WARN', 'RewardDistributionService', 'Service is already running');
      return;
    }

    try {
      this.log('INFO', 'RewardDistributionService', 'Starting reward distribution service', {
        interval: config.reward_distribution_interval,
        config: {
          minDailyReward: config.daily_min_reward,
          maxDailyReward: config.daily_max_reward,
          maxDailyRewardWithBonus: config.daily_max_reward_with_bonus,
          maxWeeklyReward: config.weekly_max_reward
        }
      });

      this.cronJob = cron.schedule(config.reward_distribution_interval, async () => {
        await this.runRewardDistribution();
      });

      // Start the cron job
      this.cronJob.start();
      this.isRunning = true;

      // Start referral distribution service if available
      if (this.referralDistributionService) {
        await this.referralDistributionService.start();
        this.log('INFO', 'RewardDistributionService', 'ReferralDistributionService started');
      }

      this.log('INFO', 'RewardDistributionService', 'Reward distribution service started successfully');
    } catch (error) {
      this.log('ERROR', 'RewardDistributionService', 'Failed to start service', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }


  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.log('WARN', 'RewardDistributionService', 'Service is not running');
      return;
    }

    try {
      if (this.cronJob) {
        this.cronJob.stop();
        this.cronJob = null;
      }

      // Stop referral distribution service if available
      if (this.referralDistributionService) {
        await this.referralDistributionService.stop();
        this.log('INFO', 'RewardDistributionService', 'ReferralDistributionService stopped');
      }

      this.isRunning = false;
      this.log('INFO', 'RewardDistributionService', 'Reward distribution service stopped');

      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }
    } catch (error) {
      this.log('ERROR', 'RewardDistributionService', 'Failed to stop service', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Manually trigger reward distribution (for testing)
   */
  async triggerManualDistribution(): Promise<EntityResult<RewardDistributionStatus>> {
    this.log('INFO', 'RewardDistributionService', 'Manual distribution triggered');
    return await this.runRewardDistribution();
  }

  /**
   * Main reward distribution process
   */
  private async runRewardDistribution(): Promise<EntityResult<RewardDistributionStatus>> {
    const distributionId = this.generateDistributionId();
    const startTime = Date.now();

    this.log('INFO', 'RewardDistribution', `Starting distribution ${distributionId}`, {
      distributionId,
      startTime: new Date(startTime).toISOString()
    });

    try {
      // First check if there are any unprocessed records before creating distribution
      const unprocessedRecords = await this.getUnprocessedDailyRecords();
      
      this.log('INFO', 'RewardDistribution', `Found ${unprocessedRecords.length} unprocessed daily records`, {
        distributionId,
        recordCount: unprocessedRecords.length
      });

      // Skip distribution entirely if no records to process
      if (unprocessedRecords.length === 0) {
        this.log('INFO', 'RewardDistribution', `Skipping distribution ${distributionId} - no unprocessed records found`);
        return { 
          success: true, 
          data: {
            distribution_id: distributionId,
            distribution_date: new Date().toISOString().split('T')[0],
            distribution_type: 'DAILY',
            status: 'SKIPPED',
            total_users: 0,
            total_rewards_distributed: 0,
            started_at: startTime,
            completed_at: Date.now(),
            retry_count: 0,
            max_retries: 3,
            skip_reason: 'No unprocessed records found'
          } as RewardDistributionStatus
        };
      }

      // Only create distribution status if we have records to process
      const distributionStatus: RewardDistributionStatus = {
        distribution_id: distributionId,
        distribution_date: new Date().toISOString().split('T')[0],
        distribution_type: 'DAILY',
        status: 'IN_PROGRESS',
        total_users: 0,
        total_rewards_distributed: 0,
        started_at: startTime,
        retry_count: 0,
        max_retries: 3
      };

      await this.storeDistributionStatus(distributionStatus);

      let successCount = 0;
      let failureCount = 0;
      let totalRewardsDistributed = 0;

      for (const dailyRecord of unprocessedRecords) {
        try {
          const result = await this.processUserReward(dailyRecord, distributionId);
          if (result.success) {
            successCount++;
            totalRewardsDistributed += result.data.totalReward;
            this.log('INFO', 'RewardDistribution', `User reward processed successfully`, {
              distributionId,
              userPrincipalId: dailyRecord.user_principal_id,
              uptimeMinutes: result.data.uptimeMinutes,
              totalReward: result.data.totalReward,
              tierLevel: result.data.tierLevel
            });
          } else {
            failureCount++;
            this.log('ERROR', 'RewardDistribution', `Failed to process user reward`, {
              distributionId,
              userPrincipalId: dailyRecord.user_principal_id,
              error: result.error
            });
          }
        } catch (error) {
          failureCount++;
          this.log('ERROR', 'RewardDistribution', `Exception processing user reward`, {
            distributionId,
            userPrincipalId: dailyRecord.user_principal_id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      distributionStatus.status = failureCount > 0 ? 'FAILED' : 'COMPLETED';
      distributionStatus.total_users = unprocessedRecords.length;
      distributionStatus.total_rewards_distributed = totalRewardsDistributed;
      distributionStatus.completed_at = Date.now();
      
      if (failureCount > 0) {
        distributionStatus.error_details = `${failureCount} users failed to process`;
      }

      await this.storeDistributionStatus(distributionStatus);

      this.log('INFO', 'RewardDistribution', `Distribution ${distributionId} completed`, {
        distributionId,
        totalUsers: unprocessedRecords.length,
        successCount,
        failureCount,
        totalRewardsDistributed,
        duration: Date.now() - startTime
      });

      return { success: true, data: distributionStatus };

    } catch (error) {
      this.log('ERROR', 'RewardDistribution', `Distribution ${distributionId} failed`, {
        distributionId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      });

      return {
        success: false,
        error: { type: 'DatabaseError', message: `Distribution failed: ${error instanceof Error ? error.message : String(error)}` }
      };
    }
  }


  private async getUnprocessedDailyRecords(): Promise<DailyUptimeRecord[]> {
    try {
      // Get all daily records that haven't been processed
      const pattern = `${REDIS_KEYS.UPTIME.DAILY}*`;
      const keys = await this.db.getRedisClient().keys(pattern);
      
        const unprocessedRecords: DailyUptimeRecord[] = [];
        
        for (const key of keys) {
          const data = await this.db.getFileMetadata(key);
          if (data) {
            const record: DailyUptimeRecord = JSON.parse(data);
            // Include records that have unprocessed minutes (total > processed)
            const unprocessedMinutes = record.total_minutes - (record.processed_minutes || 0);
            if (!record.is_processed && unprocessedMinutes > 0) {
              unprocessedRecords.push(record);
            }
          }
        }

      return unprocessedRecords;
    } catch (error) {
      this.log('ERROR', 'RewardDistribution', 'Failed to get unprocessed daily records', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }


  private async processUserReward(dailyRecord: DailyUptimeRecord, distributionId: string): Promise<EntityResult<RewardCalculationResult>> {
    try {
      const rewardCalculation = this.calculateRewards(dailyRecord);
      
      const transaction: RewardTransaction = {
        transaction_id: this.generateTransactionId(),
        distribution_id: distributionId,
        user_principal_id: dailyRecord.user_principal_id,
        amount: rewardCalculation.totalReward,
        base_amount: rewardCalculation.baseReward,
        bonus_amount: rewardCalculation.bonusReward,
        uptime_minutes: dailyRecord.total_minutes,
        tier_level: dailyRecord.tier_level,
        tier_bonus_rate: this.getTierBonusRate(dailyRecord.tier_level),
        date: dailyRecord.date,
        timestamp: Date.now(),
        status: 'PENDING',
        retry_count: 0
      };

      await this.storeRewardTransaction(transaction);

      const blockchainRequest: BlockchainTransactionRequest = {
        userPrincipalId: dailyRecord.user_principal_id,
        amount: rewardCalculation.totalReward,
        rewardType: 'UPTIME_REWARD',
        metadata: {
          uptime_minutes: dailyRecord.total_minutes,
          tier_level: dailyRecord.tier_level
        }
      };

      const blockchainResult = await this.blockchainService.sendRewardTransaction(blockchainRequest);
      
      if (blockchainResult.success) {
        transaction.blockchain_tx_hash = blockchainResult.transactionHash;
        transaction.status = 'CONFIRMED';
        await this.storeRewardTransaction(transaction);

        await this.updateUserBalance(dailyRecord.user_principal_id, rewardCalculation.totalReward);

        // Update processed minutes and cumulative rewards
        dailyRecord.processed_minutes = dailyRecord.total_minutes; // Mark all current minutes as processed
        dailyRecord.base_reward += rewardCalculation.baseReward; // Accumulate base rewards
        dailyRecord.bonus_reward += rewardCalculation.bonusReward; // Accumulate bonus rewards  
        dailyRecord.total_reward += rewardCalculation.totalReward; // Accumulate total rewards
        dailyRecord.is_processed = true; // Mark as processed (will be reset when new sessions are added)
        await this.storeDailyRecord(dailyRecord);

        return { success: true, data: rewardCalculation };
      } else {
        transaction.status = 'FAILED';
        await this.storeRewardTransaction(transaction);

        this.log('ERROR', 'RewardDistribution', 'Blockchain transaction failed', {
          distributionId,
          userPrincipalId: dailyRecord.user_principal_id,
          error: blockchainResult.error
        });

        return {
          success: false,
          error: { type: 'DatabaseError', message: `Blockchain transaction failed: ${blockchainResult.error}` }
        };
      }

    } catch (error) {
      this.log('ERROR', 'RewardDistribution', 'Failed to process user reward', {
        distributionId,
        userPrincipalId: dailyRecord.user_principal_id,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to process user reward: ${error instanceof Error ? error.message : String(error)}` }
      };
    }
  }

  /**
   * Calculate rewards for a user based on their uptime record (only for unprocessed minutes)
   */
  private calculateRewards(dailyRecord: DailyUptimeRecord): RewardCalculationResult {
    const config = this.uptimeTracker.getConfig();
    
    // Calculate rewards only for unprocessed minutes
    const unprocessedMinutes = dailyRecord.total_minutes - (dailyRecord.processed_minutes || 0);
    
    const baseReward = unprocessedMinutes * config.base_reward_rate;
    const tierBonusRate = this.getTierBonusRate(dailyRecord.tier_level);
    const bonusReward = baseReward * tierBonusRate;
    let totalReward = baseReward + bonusReward;

    // Note: Daily limits should be applied to the cumulative daily total, not per-session
    // For now, we'll apply limits to this session's reward
    if (totalReward < 0) {
      totalReward = 0;
    }

    return {
      userPrincipalId: dailyRecord.user_principal_id,
      uptimeMinutes: unprocessedMinutes, // Return only the minutes being processed this time
      tierLevel: dailyRecord.tier_level,
      baseReward,
      bonusReward,
      totalReward,
      dailyRecord
    };
  }


  private getTierBonusRate(tierLevel: number): number {
    const config = this.uptimeTracker.getConfig();
    const tier = config.performance_tiers.find(t => t.tier === tierLevel);
    return tier ? tier.bonus_rate : 0.00;
  }


  private async updateUserBalance(userPrincipalId: string, rewardAmount: number): Promise<void> {
    try {
      const clientResult = await this.db.getClient(userPrincipalId);
      if (clientResult.success) {
        const client = clientResult.data;
        await this.db.updateClient(userPrincipalId, {
          balance: client.balance + rewardAmount,
          todaysEarnings: client.todaysEarnings + rewardAmount,
          uptimeReward: client.uptimeReward + rewardAmount
        });
      }
    } catch (error) {
      this.log('ERROR', 'RewardDistribution', 'Failed to update user balance', {
        userPrincipalId,
        rewardAmount,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }


  private async storeDistributionStatus(status: RewardDistributionStatus): Promise<void> {
    const key = `${REDIS_KEYS.UPTIME.DISTRIBUTION}${status.distribution_id}`;
    await this.db.setFileMetadata(key, JSON.stringify(status));
  }


  private async storeRewardTransaction(transaction: RewardTransaction): Promise<void> {
    const key = `${REDIS_KEYS.UPTIME.TRANSACTION}${transaction.transaction_id}`;
    await this.db.setFileMetadata(key, JSON.stringify(transaction));
  }


  private async storeDailyRecord(record: DailyUptimeRecord): Promise<void> {
    const key = `${REDIS_KEYS.UPTIME.DAILY}${record.date}:${record.user_principal_id}`;
    await this.db.setFileMetadata(key, JSON.stringify(record));
  }


  private generateDistributionId(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `dist_${timestamp}_${random}`;
  }


  private generateTransactionId(): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `tx_${timestamp}_${random}`;
  }

 
  getStatus(): { isRunning: boolean; config: UptimeConfig; currentLogFile: string } {
    return {
      isRunning: this.isRunning,
      config: this.uptimeTracker.getConfig(),
      currentLogFile: this.currentLogFile
    };
  }
}
