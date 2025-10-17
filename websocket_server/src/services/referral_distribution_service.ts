import * as fs from 'fs';
import * as path from 'path';
import * as cron from 'node-cron';
import { Database } from '../db/database';
import { ReferralService } from './referral_service';
import { 
  ReferralReward,
  ReferralRewardType,
  ReferralTier,
  DistributionCycle,
  DailyUptimeRecord,
  EntityResult,
  REDIS_KEYS
} from '../db/types';

export interface ReferralDistributionResult {
  distribution_id: string;
  distribution_type: 'WEEKLY_UPTIME' | 'DAILY_TASK' | 'MONTHLY_CAP_RESET';
  processed_count: number;
  total_rewards_distributed: number;
  errors: string[];
  timestamp: number;
}

export class ReferralDistributionService {
  private db: Database;
  private referralService: ReferralService;
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;
  private logStream: fs.WriteStream | null = null;
  private currentLogFile: string = '';

  constructor(db: Database, referralService: ReferralService) {
    this.db = db;
    this.referralService = referralService;
    this.initializeLogDirectory();
  }

  /**
   * Initialize log directory for referral distribution
   */
  private initializeLogDirectory(): void {
    const logDir = './logs/referral-distribution';
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Start all referral distribution cron jobs
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ ReferralDistributionService is already running');
      return;
    }

    try {
      console.log('🚀 Starting ReferralDistributionService...');

      // Start weekly uptime distribution (Sundays at 2 AM)
      this.startWeeklyUptimeDistribution();

      // Start daily task distribution (if configured for daily)
      this.startDailyTaskDistribution();

      // Start monthly cap reset (1st of every month at 3 AM)
      this.startMonthlyCapReset();

      this.isRunning = true;
      console.log('✅ ReferralDistributionService started successfully');
    } catch (error) {
      console.error('❌ Failed to start ReferralDistributionService:', error);
      throw error;
    }
  }

  /**
   * Stop all referral distribution cron jobs
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️ ReferralDistributionService is not running');
      return;
    }

    try {
      console.log('🛑 Stopping ReferralDistributionService...');

      // Stop all cron jobs
      for (const [name, cronJob] of this.cronJobs) {
        cronJob.stop();
        console.log(`✅ Stopped ${name} cron job`);
      }

      this.cronJobs.clear();
      this.isRunning = false;

      // Close log stream
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }

      console.log('✅ ReferralDistributionService stopped successfully');
    } catch (error) {
      console.error('❌ Error stopping ReferralDistributionService:', error);
      throw error;
    }
  }

  /**
   * Start weekly uptime distribution cron job
   */
  private startWeeklyUptimeDistribution(): void {
    const cronJob = cron.schedule('0 2 * * 0', async () => {
      console.log('🔄 Starting weekly uptime referral distribution...');
      await this.processWeeklyUptimeRewards();
    }, {
      timezone: 'UTC'
    });

    this.cronJobs.set('weekly_uptime', cronJob);
    cronJob.start();
    console.log('✅ Weekly uptime distribution cron job started (Sundays at 2 AM UTC)');
  }

  /**
   * Start daily task distribution cron job (if configured)
   */
  private startDailyTaskDistribution(): void {
    const taskConfig = this.referralService.getConfig().task_reward;
    
    if (taskConfig.distribution_cycle === DistributionCycle.DAILY) {
      const cronJob = cron.schedule('0 1 * * *', async () => {
        console.log('🔄 Starting daily task referral distribution...');
        await this.processDailyTaskRewards();
      }, {
        timezone: 'UTC'
      });

      this.cronJobs.set('daily_task', cronJob);
      cronJob.start();
      console.log('✅ Daily task distribution cron job started (Daily at 1 AM UTC)');
    } else {
      console.log('ℹ️ Daily task distribution not needed (configured for immediate distribution)');
    }
  }

  /**
   * Start monthly cap reset cron job
   */
  private startMonthlyCapReset(): void {
    const cronJob = cron.schedule('0 3 1 * *', async () => {
      console.log('🔄 Starting monthly cap reset...');
      await this.resetMonthlyCaps();
    }, {
      timezone: 'UTC'
    });

    this.cronJobs.set('monthly_cap_reset', cronJob);
    cronJob.start();
    console.log('✅ Monthly cap reset cron job started (1st of month at 3 AM UTC)');
  }

  /**
   * Process weekly uptime rewards for all users
   */
  private async processWeeklyUptimeRewards(): Promise<ReferralDistributionResult> {
    const distributionId = `weekly_uptime_${Date.now()}`;
    const result: ReferralDistributionResult = {
      distribution_id: distributionId,
      distribution_type: 'WEEKLY_UPTIME',
      processed_count: 0,
      total_rewards_distributed: 0,
      errors: [],
      timestamp: Date.now()
    };

    try {
      this.log(`INFO`, `Starting weekly uptime referral distribution`, { distributionId });

      // Get all users who have referral relationships
      const redisClient = this.db.getRedisClient();
      const allUsers = await redisClient.keys(`${REDIS_KEYS.REFERRAL.RELATIONSHIP}*`);
      
      console.log(`📊 Found ${allUsers.length} users with referral relationships`);

      for (const userKey of allUsers) {
        try {
          const userPrincipalId = userKey.replace(`${REDIS_KEYS.REFERRAL.RELATIONSHIP}`, '');
          
          // Get user's weekly uptime data
          const weeklyUptimeResult = await this.getWeeklyUptimeData(userPrincipalId);
          
          if (weeklyUptimeResult.success && weeklyUptimeResult.data) {
            const { totalMinutes, earnedPoints } = weeklyUptimeResult.data;
            
            // Check if user meets weekly uptime requirement (100+ hours)
            const uptimeConfig = this.referralService.getConfig().uptime_reward;
            const requiredMinutes = (uptimeConfig.requirements?.min_uptime_hours_weekly || 100) * 60;
            
            if (totalMinutes >= requiredMinutes) {
              console.log(`💰 Processing uptime rewards for ${userPrincipalId}: ${totalMinutes}min, ${earnedPoints} points`);
              
              // Calculate and distribute uptime referral rewards
              const rewardResult = await this.referralService.calculateUptimeReward(
                userPrincipalId,
                earnedPoints,
                totalMinutes
              );
              
              if (rewardResult.success) {
                result.processed_count++;
                result.total_rewards_distributed += rewardResult.data.total_distributed;
                console.log(`✅ Distributed ${rewardResult.data.total_distributed} uptime referral points`);
              } else {
                result.errors.push(`Failed to process ${userPrincipalId}: ${rewardResult.error?.message}`);
              }
            } else {
              console.log(`⚠️ User ${userPrincipalId} has ${totalMinutes}min uptime, needs ${requiredMinutes}min`);
            }
          }
        } catch (error) {
          const errorMsg = `Error processing user ${userKey}: ${error}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

      this.log(`INFO`, `Weekly uptime distribution completed`, {
        distributionId,
        processed: result.processed_count,
        totalDistributed: result.total_rewards_distributed,
        errors: result.errors.length
      });

      console.log(`✅ Weekly uptime distribution completed: ${result.processed_count} users processed, ${result.total_rewards_distributed} points distributed`);
      
    } catch (error) {
      const errorMsg = `Weekly uptime distribution failed: ${error}`;
      result.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
      this.log(`ERROR`, errorMsg, { distributionId, error });
    }

    return result;
  }

  /**
   * Process daily task rewards (if configured for daily distribution)
   */
  private async processDailyTaskRewards(): Promise<ReferralDistributionResult> {
    const distributionId = `daily_task_${Date.now()}`;
    const result: ReferralDistributionResult = {
      distribution_id: distributionId,
      distribution_type: 'DAILY_TASK',
      processed_count: 0,
      total_rewards_distributed: 0,
      errors: [],
      timestamp: Date.now()
    };

    try {
      this.log(`INFO`, `Starting daily task referral distribution`, { distributionId });

      // Get all pending task rewards from today
      const redisClient = this.db.getRedisClient();
      const today = new Date().toISOString().split('T')[0];
      
      // This would need to be implemented based on how you store pending task rewards
      // For now, we'll log that this is a placeholder
      console.log(`ℹ️ Daily task distribution placeholder - would process pending rewards for ${today}`);
      
      this.log(`INFO`, `Daily task distribution completed`, {
        distributionId,
        processed: result.processed_count,
        totalDistributed: result.total_rewards_distributed
      });

    } catch (error) {
      const errorMsg = `Daily task distribution failed: ${error}`;
      result.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
      this.log(`ERROR`, errorMsg, { distributionId, error });
    }

    return result;
  }

  /**
   * Reset monthly caps for all referrers
   */
  private async resetMonthlyCaps(): Promise<ReferralDistributionResult> {
    const distributionId = `monthly_cap_reset_${Date.now()}`;
    const result: ReferralDistributionResult = {
      distribution_id: distributionId,
      distribution_type: 'MONTHLY_CAP_RESET',
      processed_count: 0,
      total_rewards_distributed: 0,
      errors: [],
      timestamp: Date.now()
    };

    try {
      this.log(`INFO`, `Starting monthly cap reset`, { distributionId });

      const redisClient = this.db.getRedisClient();
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      
      // Get all monthly cap keys
      const capKeys = await redisClient.keys(`${REDIS_KEYS.REFERRAL.MONTHLY_CAP}*`);
      
      console.log(`📊 Found ${capKeys.length} monthly cap records to reset`);

      for (const capKey of capKeys) {
        try {
          // Extract user ID and month from key
          const keyParts = capKey.split(':');
          const userPrincipalId = keyParts[2];
          const month = keyParts[3];
          
          // Only reset caps from previous months
          if (month < currentMonth) {
            await redisClient.del(capKey);
            result.processed_count++;
            console.log(`✅ Reset monthly cap for ${userPrincipalId} (${month})`);
          }
        } catch (error) {
          const errorMsg = `Error resetting cap ${capKey}: ${error}`;
          result.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);
        }
      }

      this.log(`INFO`, `Monthly cap reset completed`, {
        distributionId,
        processed: result.processed_count,
        errors: result.errors.length
      });

      console.log(`✅ Monthly cap reset completed: ${result.processed_count} caps reset`);
      
    } catch (error) {
      const errorMsg = `Monthly cap reset failed: ${error}`;
      result.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
      this.log(`ERROR`, errorMsg, { distributionId, error });
    }

    return result;
  }

  /**
   * Get weekly uptime data for a user
   */
  private async getWeeklyUptimeData(userPrincipalId: string): Promise<EntityResult<{ totalMinutes: number; earnedPoints: number }>> {
    try {
      const redisClient = this.db.getRedisClient();
      
      // Get last 7 days of uptime records
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      let totalMinutes = 0;
      let earnedPoints = 0;
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekAgo.getTime() + i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        
        const recordKey = `${REDIS_KEYS.UPTIME.DAILY}${userPrincipalId}:${dateStr}`;
        const recordData = await redisClient.get(recordKey);
        
        if (recordData) {
          const record: DailyUptimeRecord = JSON.parse(recordData);
          totalMinutes += record.total_minutes;
          earnedPoints += record.total_reward || 0;
        }
      }
      
      return {
        success: true,
        data: { totalMinutes, earnedPoints }
      };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get weekly uptime data: ${error}` }
      };
    }
  }

  /**
   * Log referral distribution events
   */
  private log(level: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    const logMessage = `[${timestamp}] [${level}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`;
    
    // Console output
    console.log(logMessage);

    // File output
    try {
      if (!this.logStream || this.currentLogFile !== this.getCurrentLogFile()) {
        this.closeLogStream();
        this.currentLogFile = this.getCurrentLogFile();
        this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
      }

      this.logStream.write(logMessage + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Get current log file path
   */
  private getCurrentLogFile(): string {
    const today = new Date().toISOString().split('T')[0];
    return `./logs/referral-distribution/referral-distribution-${today}.log`;
  }

  /**
   * Close current log stream
   */
  private closeLogStream(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  /**
   * Get service status
   */
  getStatus(): { isRunning: boolean; activeJobs: string[] } {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.cronJobs.keys())
    };
  }

  /**
   * Manually trigger weekly uptime distribution
   */
  async triggerWeeklyUptimeDistribution(): Promise<ReferralDistributionResult> {
    console.log('🔄 Manually triggering weekly uptime distribution...');
    return await this.processWeeklyUptimeRewards();
  }

  /**
   * Manually trigger daily task distribution
   */
  async triggerDailyTaskDistribution(): Promise<ReferralDistributionResult> {
    console.log('🔄 Manually triggering daily task distribution...');
    return await this.processDailyTaskRewards();
  }

  /**
   * Manually trigger monthly cap reset
   */
  async triggerMonthlyCapReset(): Promise<ReferralDistributionResult> {
    console.log('🔄 Manually triggering monthly cap reset...');
    return await this.resetMonthlyCaps();
  }
}
