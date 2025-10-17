import { Database } from '../db/database';
import { 
  UptimeSession, 
  DailyUptimeRecord, 
  WeeklyUptimeRecord,
  PerformanceTier,
  UptimeConfig,
  EntityResult,
  REDIS_KEYS
} from '../db/types';
import * as crypto from 'crypto';

export class UptimeTracker {
  private db: Database;
  private config: UptimeConfig;
  private activeSessions: Map<string, UptimeSession> = new Map();
  private referralService?: any;

  constructor(db: Database) {
    this.config = this.getDefaultConfig();
    this.db = db;
  }

  /**
   * Set referral service for integration
   */
  setReferralService(referralService: any): void {
    this.referralService = referralService;
    console.log(`✅ ReferralService integrated with UptimeTracker`);
  }

  /**
   * Initialize uptime tracking for a new client connection
   */
  async initializeUptimeTracking(userPrincipalId: string, clientId: string): Promise<EntityResult<string>> {
    try {
      const sessionId = this.generateSessionId();
      const now = Date.now();
      
      const session: UptimeSession = {
        session_id: sessionId,
        user_principal_id: userPrincipalId,
        start_time: now,
        last_activity_time: now,
        duration_minutes: 0,
        avg_speed: 0,
        avg_ping: 0,
        speed_samples: [],
        ping_samples: [],
        status: 'ACTIVE'
      };

      // Store active session in Redis
      const activeKey = `${REDIS_KEYS.UPTIME.ACTIVE}${userPrincipalId}`;
      await this.db.setFileMetadata(activeKey, JSON.stringify(session));
      
      // Add to user sessions index
      const userSessionsKey = `${REDIS_KEYS.UPTIME_INDEX.USER_SESSIONS}${userPrincipalId}:sessions`;
      await this.db.addFileToUserIndex(userSessionsKey, sessionId);
      
      // Add to date sessions index
      const today = this.getTodayDate();
      const dateSessionsKey = `${REDIS_KEYS.UPTIME_INDEX.DATE_SESSIONS}${today}`;
      await this.db.addFileToUserIndex(dateSessionsKey, sessionId);
      
      // Store in memory for fast access
      this.activeSessions.set(sessionId, session);
      
      console.log(`✅ Uptime tracking initialized for user ${userPrincipalId}, session ${sessionId}`);
      
      return { success: true, data: sessionId };
    } catch (error) {
      console.error(`❌ Failed to initialize uptime tracking:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to initialize uptime tracking: ${error}` }
      };
    }
  }

  /**
   * Update client activity (heartbeat, speed test, etc.)
   */
  async updateClientActivity(userPrincipalId: string, speed?: number, ping?: number): Promise<EntityResult<void>> {
    try {
      const activeKey = `${REDIS_KEYS.UPTIME.ACTIVE}${userPrincipalId}`;
      const activeSessionData = await this.db.getFileMetadata(activeKey);
      
      if (!activeSessionData) {
        console.log(`⚠️ No active session found for user ${userPrincipalId}`);
        return { success: true, data: undefined };
      }

      const session: UptimeSession = JSON.parse(activeSessionData);
      const now = Date.now();
      
      // Update session duration and last activity time
      session.duration_minutes = (now - session.start_time) / (1000 * 60);
      session.last_activity_time = now;
      
      // Add speed/ping samples if provided
      if (speed !== undefined) {
        session.speed_samples.push({ timestamp: now, value: speed });
        session.avg_speed = this.calculateAverage(session.speed_samples.map(s => s.value));
      }
      
      if (ping !== undefined) {
        session.ping_samples.push({ timestamp: now, value: ping });
        session.avg_ping = this.calculateAverage(session.ping_samples.map(s => s.value));
      }
      
      // Update active session in Redis
      await this.db.setFileMetadata(activeKey, JSON.stringify(session));
      
      // Update memory copy
      this.activeSessions.set(session.session_id, session);
      
      console.log(`✅ Updated client activity for user ${userPrincipalId}, duration: ${session.duration_minutes.toFixed(2)} minutes`);
      
      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Failed to update client activity:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to update client activity: ${error}` }
      };
    }
  }

  /**
   * Finalize uptime session when client disconnects
   */
  async finalizeUptimeSession(userPrincipalId: string, reason: string = 'NORMAL_DISCONNECT'): Promise<EntityResult<UptimeSession>> {
    try {
      const activeKey = `${REDIS_KEYS.UPTIME.ACTIVE}${userPrincipalId}`;
      const activeSessionData = await this.db.getFileMetadata(activeKey);
      
      if (!activeSessionData) {
        console.log(`⚠️ No active session to finalize for user ${userPrincipalId}`);
        return { success: true, data: null as any };
      }

      const session: UptimeSession = JSON.parse(activeSessionData);
      const now = Date.now();
      
      // Finalize session
      session.end_time = now;
      session.duration_minutes = (now - session.start_time) / (1000 * 60);
      session.status = 'COMPLETED';
      session.close_reason = reason;
      
      // Store finalized session
      const sessionKey = `${REDIS_KEYS.UPTIME.SESSION}${userPrincipalId}:${session.session_id}`;
      await this.db.setFileMetadata(sessionKey, JSON.stringify(session));
      
      // Remove from active sessions
      await this.db.deleteFileMetadata(activeKey);
      this.activeSessions.delete(session.session_id);
      
      // Update daily record
      await this.updateDailyUptimeRecord(userPrincipalId, session);
      
      console.log(`✅ Finalized uptime session for user ${userPrincipalId}, duration: ${session.duration_minutes.toFixed(2)} minutes, reason: ${reason}`);
      
      return { success: true, data: session };
    } catch (error) {
      console.error(`❌ Failed to finalize uptime session:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to finalize uptime session: ${error}` }
      };
    }
  }

  /**
   * Update daily uptime record
   */
  private async updateDailyUptimeRecord(userPrincipalId: string, session: UptimeSession): Promise<void> {
    try {
      const today = this.getTodayDate();
      const dailyKey = `${REDIS_KEYS.UPTIME.DAILY}${today}:${userPrincipalId}`;
      
      let dailyRecord: DailyUptimeRecord;
      const existingData = await this.db.getFileMetadata(dailyKey);
      
      if (existingData) {
        dailyRecord = JSON.parse(existingData);
        dailyRecord.total_minutes += session.duration_minutes;
        dailyRecord.session_count += 1;
        dailyRecord.last_updated = Date.now();
        
        // Reset processed flag so updated record gets redistributed
        dailyRecord.is_processed = false;
        
        // Recalculate averages
        const allSessions = await this.getUserSessionsForDate(userPrincipalId, today);
        dailyRecord.avg_speed = this.calculateAverage(allSessions.map(s => s.avg_speed));
        dailyRecord.avg_ping = this.calculateAverage(allSessions.map(s => s.avg_ping));
        
        // Determine tier based on daily averages
        dailyRecord.tier_level = this.determineTier(dailyRecord.avg_speed, dailyRecord.avg_ping);
      } else {
        dailyRecord = {
          date: today,
          user_principal_id: userPrincipalId,
          total_minutes: session.duration_minutes,
          processed_minutes: 0, // No minutes processed yet
          session_count: 1,
          avg_speed: session.avg_speed,
          avg_ping: session.avg_ping,
          tier_level: this.determineTier(session.avg_speed, session.avg_ping),
          base_reward: 0,
          bonus_reward: 0,
          total_reward: 0,
          last_updated: Date.now(),
          is_processed: false
        };
        
        // Add to date users index
        const dateUsersKey = `${REDIS_KEYS.UPTIME_INDEX.DATE_USERS}${today}`;
        await this.db.addFileToUserIndex(dateUsersKey, userPrincipalId);
        
        // Add to user daily index
        const userDailyKey = `${REDIS_KEYS.UPTIME_INDEX.USER_DAILY}${userPrincipalId}:daily`;
        await this.db.addFileToUserIndex(userDailyKey, today);
      }
      
      // Store updated daily record
      await this.db.setFileMetadata(dailyKey, JSON.stringify(dailyRecord));
      
      console.log(`✅ Updated daily uptime record for user ${userPrincipalId}, total: ${dailyRecord.total_minutes.toFixed(2)} minutes`);
      
      // 🎁 REFERRAL SYSTEM: Check 24-hour installation completion
      if (this.referralService && this.referralService.isEnabled()) {
        try {
          // Get client's total uptime to check if 24h threshold is met
          const clientResult = await this.db.getClient(userPrincipalId);
          if (clientResult.success) {
            const totalUptimeHours = clientResult.data.totalUptime / (1000 * 60 * 60);
            
            // Only check if they're getting close to or past 24 hours
            if (totalUptimeHours >= 24) {
              console.log(`⏰ Checking 24h completion for user ${userPrincipalId}, current uptime: ${totalUptimeHours.toFixed(2)}h`);
              await this.referralService.check24HourCompletion(userPrincipalId);
            }
          }
        } catch (referralError) {
          console.error(`⚠️ Failed to check 24h installation completion:`, referralError);
          // Don't fail uptime tracking if referral check fails
        }
      }
    } catch (error) {
      console.error(`❌ Failed to update daily uptime record:`, error);
    }
  }

  /**
   * Get user's uptime for today
   */
  async getUserTodayUptime(userPrincipalId: string): Promise<EntityResult<{
    total_minutes: number;
    active_session_minutes: number;
    avg_speed: number;
    avg_ping: number;
    tier_level: number;
  }>> {
    try {
      const today = this.getTodayDate();
      const dailyKey = `${REDIS_KEYS.UPTIME.DAILY}${today}:${userPrincipalId}`;
      const activeKey = `${REDIS_KEYS.UPTIME.ACTIVE}${userPrincipalId}`;
      
      const [dailyData, activeData] = await Promise.all([
        this.db.getFileMetadata(dailyKey),
        this.db.getFileMetadata(activeKey)
      ]);
      
      let totalMinutes = 0;
      let avgSpeed = 0;
      let avgPing = 0;
      let tierLevel = 4;
      
      if (dailyData) {
        const dailyRecord: DailyUptimeRecord = JSON.parse(dailyData);
        totalMinutes = dailyRecord.total_minutes;
        avgSpeed = dailyRecord.avg_speed;
        avgPing = dailyRecord.avg_ping;
        tierLevel = dailyRecord.tier_level;
      }
      
      let activeSessionMinutes = 0;
      let isSessionActive = false;
      if (activeData) {
        const activeSession: UptimeSession = JSON.parse(activeData);
        const timeSinceLastActivity = Date.now() - activeSession.last_activity_time;
        const maxInactivityAge = 30 * 1000; // 30 seconds in milliseconds
        
        // Only consider session active if there was recent activity (within 30 seconds)
        if (timeSinceLastActivity < maxInactivityAge) {
          isSessionActive = true;
          activeSessionMinutes = (Date.now() - activeSession.start_time) / (1000 * 60);
        }
      }
      
      return {
        success: true,
        data: {
          total_minutes: totalMinutes + (isSessionActive ? activeSessionMinutes : 0),
          active_session_minutes: activeSessionMinutes,
          avg_speed: avgSpeed,
          avg_ping: avgPing,
          tier_level: tierLevel
        }
      };
    } catch (error) {
      console.error(`❌ Failed to get user today uptime:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get user today uptime: ${error}` }
      };
    }
  }

  /**
   * Get user's total lifetime uptime
   */
  async getUserTotalUptime(userPrincipalId: string): Promise<EntityResult<{
    total_minutes: number;
    total_days: number;
    avg_daily_uptime: number;
  }>> {
    try {
      const userDailyKey = `${REDIS_KEYS.UPTIME_INDEX.USER_DAILY}${userPrincipalId}:daily`;
      const dailyDates = await this.db.getFileIdsFromIndex(userDailyKey);
      
      if (dailyDates.length === 0) {
        return {
          success: true,
          data: {
            total_minutes: 0,
            total_days: 0,
            avg_daily_uptime: 0
          }
        };
      }
      
      let totalMinutes = 0;
      for (const date of dailyDates) {
        const dailyKey = `${REDIS_KEYS.UPTIME.DAILY}${date}:${userPrincipalId}`;
        const dailyData = await this.db.getFileMetadata(dailyKey);
        if (dailyData) {
          const dailyRecord: DailyUptimeRecord = JSON.parse(dailyData);
          totalMinutes += dailyRecord.total_minutes;
        }
      }
      
      return {
        success: true,
        data: {
          total_minutes: totalMinutes,
          total_days: dailyDates.length,
          avg_daily_uptime: totalMinutes / dailyDates.length
        }
      };
    } catch (error) {
      console.error(`❌ Failed to get user total uptime:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get user total uptime: ${error}` }
      };
    }
  }

  /**
   * Get all user sessions for a specific date
   */
  private async getUserSessionsForDate(userPrincipalId: string, date: string): Promise<UptimeSession[]> {
    try {
      const userSessionsKey = `${REDIS_KEYS.UPTIME_INDEX.USER_SESSIONS}${userPrincipalId}:sessions`;
      const sessionIds = await this.db.getFileIdsFromIndex(userSessionsKey);
      
      const sessions: UptimeSession[] = [];
      for (const sessionId of sessionIds) {
        const sessionKey = `${REDIS_KEYS.UPTIME.SESSION}${userPrincipalId}:${sessionId}`;
        const sessionData = await this.db.getFileMetadata(sessionKey);
        if (sessionData) {
          const session: UptimeSession = JSON.parse(sessionData);
          if (session.status === 'COMPLETED') {
            sessions.push(session);
          }
        }
      }
      
      return sessions;
    } catch (error) {
      console.error(`❌ Failed to get user sessions for date:`, error);
      return [];
    }
  }

  /**
   * Determine performance tier based on speed and ping
   */
  private determineTier(avgSpeed: number, avgPing: number): number {
    for (const tier of this.config.performance_tiers) {
      if (avgSpeed >= tier.min_speed && avgPing <= tier.max_ping) {
        return tier.tier;
      }
    }
    return 4; // Default to lowest tier
  }

  /**
   * Calculate average from array of numbers
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Get today's date in YYYY-MM-DD format
   */
  private getTodayDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Get default uptime configuration
   */
  private getDefaultConfig(): UptimeConfig {
    return {
      heartbeat_interval: 30000, // 30 seconds
      timeout_threshold: 30000, // 30 seconds
      max_missed_heartbeats: 3,
      sample_interval: 300000, // 5 minutes
      base_reward_rate: 0.5, // 0.5 Sela per minute
      daily_min_reward: 0.5,
      daily_max_reward: 720,
      daily_max_reward_with_bonus: 864, 
      weekly_max_reward: 5040,
      performance_tiers: [
        { tier: 1, min_speed: 50, max_ping: 50, bonus_rate: 0.20, description: 'Tier 1: High Performance' },
        { tier: 2, min_speed: 20, max_ping: 100, bonus_rate: 0.10, description: 'Tier 2: Good Performance' },
        { tier: 3, min_speed: 5, max_ping: 150, bonus_rate: 0.05, description: 'Tier 3: Standard Performance' },
        { tier: 4, min_speed: 0, max_ping: 999, bonus_rate: 0.00, description: 'Tier 4: Basic Performance' }
      ],
      reward_distribution_enabled: process.env.REWARD_DISTRIBUTION_ENABLED === 'true',
      reward_distribution_interval: process.env.REWARD_DISTRIBUTION_INTERVAL || '*/5 * * * *', // Every 5 minutes
      reward_log_directory: process.env.REWARD_LOG_DIRECTORY || './logs/rewards',
      reward_max_log_files: parseInt(process.env.REWARD_MAX_LOG_FILES || '30'),
      reward_max_log_size_mb: parseInt(process.env.REWARD_MAX_LOG_SIZE_MB || '10')
    };
  }

  /**
   * Get uptime configuration
   */
  getConfig(): UptimeConfig {
    return this.config;
  }

  /**
   * Update uptime configuration
   */
  updateConfig(newConfig: Partial<UptimeConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Calculate real-time rewards for active session (for display purposes only)
   */
  async calculateActiveSessionRewards(userPrincipalId: string): Promise<EntityResult<{
    activeSessionMinutes: number;
    baseReward: number;
    bonusReward: number;
    totalReward: number;
    tierLevel: number;
    isOnline: boolean;
  }>> {
    try {
      const activeKey = `${REDIS_KEYS.UPTIME.ACTIVE}${userPrincipalId}`;
      const activeSessionData = await this.db.getFileMetadata(activeKey);
      
      if (!activeSessionData) {
        return {
          success: true,
          data: {
            activeSessionMinutes: 0,
            baseReward: 0,
            bonusReward: 0,
            totalReward: 0,
            tierLevel: 4,
            isOnline: false
          }
        };
      }

      const activeSession: UptimeSession = JSON.parse(activeSessionData);
      const timeSinceLastActivity = Date.now() - activeSession.last_activity_time;
      const maxInactivityAge = 30 * 1000; // 30 seconds
      
      // Only consider session active if there was recent activity (within 30 seconds)
      if (timeSinceLastActivity >= maxInactivityAge) {
        return {
          success: true,
          data: {
            activeSessionMinutes: 0,
            baseReward: 0,
            bonusReward: 0,
            totalReward: 0,
            tierLevel: 4,
            isOnline: false
          }
        };
      }

      const activeSessionMinutes = (Date.now() - activeSession.start_time) / (1000 * 60);
      
      // Determine tier for active session
      const tierLevel = this.determineTier(activeSession.avg_speed, activeSession.avg_ping);
      
      // Calculate rewards using the same logic as reward distribution
      const baseReward = activeSessionMinutes * this.config.base_reward_rate;
      const tierBonusRate = this.getTierBonusRate(tierLevel);
      const bonusReward = baseReward * tierBonusRate;
      const totalReward = baseReward + bonusReward;

      return {
        success: true,
        data: {
          activeSessionMinutes,
          baseReward,
          bonusReward,
          totalReward,
          tierLevel,
          isOnline: true
        }
      };
    } catch (error) {
      console.error(`❌ Failed to calculate active session rewards:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to calculate active session rewards: ${error}` }
      };
    }
  }

  /**
   * Get tier bonus rate (same logic as reward distribution service)
   */
  private getTierBonusRate(tierLevel: number): number {
    const tier = this.config.performance_tiers.find(t => t.tier === tierLevel);
    return tier ? tier.bonus_rate : 0;
  }
}
