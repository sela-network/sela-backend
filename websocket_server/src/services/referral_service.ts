import { Database } from '../db/database';
import { 
  EntityResult,
  ReferralRelationship,
  ReferralReward,
  ReferralMonthlyCap,
  ReferralStats,
  ReferralConfig,
  ReferralRewardType,
  ReferralTier,
  Installation24hStatus,
  REDIS_KEYS,
  ClientStruct,
  ClientStatus,
  DistributionCycle
} from '../db/types';
import { ReferralConfigManager } from './referral_config_manager';
import { BlockchainService, BlockchainTransactionRequest } from './blockchain_service';

/**
 * ReferralService
 * Manages N-tier referral system with flexible reward configuration
 * Supports installation, uptime, and task rewards with configurable distribution cycles
 */
export class ReferralService {
  private db: Database;
  private configManager: ReferralConfigManager;
  private blockchainService: BlockchainService;

  constructor(db: Database, blockchainService: BlockchainService, config?: Partial<ReferralConfig>) {
    this.db = db;
    this.blockchainService = blockchainService;
    this.configManager = new ReferralConfigManager(config);
    
    console.log(`✅ ReferralService initialized with ${this.configManager.getMaxTierDepth()}-tier support`);
  }

  // ============================================
  // 1. REFERRAL CODE VALIDATION & REGISTRATION
  // ============================================

  /**
   * Validate if a referral code exists and belongs to an active user
   */
  async validateReferralCode(referralCode: string): Promise<EntityResult<{
    valid: boolean;
    referrer_principal_id?: string;
    message: string;
  }>> {
    try {
      console.log(`🔍 Validating referral code: ${referralCode}`);
      
      const redisClient = this.db.getRedisClient();
      const lookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${referralCode}`;
      const referrerPrincipalId = await redisClient.get(lookupKey);
      
      if (!referrerPrincipalId) {
        console.log(`❌ Referral code not found: ${referralCode}`);
        return {
          success: true,
          data: {
            valid: false,
            message: 'Invalid referral code'
          }
        };
      }
      
      // Check if referrer is an active client
      const referrerResult = await this.db.getClient(referrerPrincipalId);
      if (!referrerResult.success) {
        console.log(`❌ Referrer not found: ${referrerPrincipalId}`);
        return {
          success: true,
          data: {
            valid: false,
            message: 'Referrer account not found'
          }
        };
      }
      
      console.log(`✅ Valid referral code from user: ${referrerPrincipalId}`);
      return {
        success: true,
        data: {
          valid: true,
          referrer_principal_id: referrerPrincipalId,
          message: 'Valid referral code'
        }
      };
    } catch (error) {
      console.error(`❌ Error validating referral code:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to validate referral code: ${error}` }
      };
    }
  }

  /**
   * Register a new user with a referral code
   * Establishes L1 and L2 relationships
   */
  async registerWithReferralCode(
    userPrincipalId: string,
    referralCode: string
  ): Promise<EntityResult<ReferralRelationship>> {
    try {
      console.log(`📝 Registering user ${userPrincipalId} with referral code: ${referralCode}`);
      
      // Validate referral code
      const validationResult = await this.validateReferralCode(referralCode);
      if (!validationResult.success || !validationResult.data.valid) {
        return {
          success: false,
          error: { 
            type: 'InvalidInput', 
            message: (validationResult.success ? validationResult.data.message : 'Invalid referral code')
          }
        };
      }
      
      const referrerL1PrincipalId = validationResult.data.referrer_principal_id!;
      
      // Check if user already has a referral relationship
      const existingRelationship = await this.getReferralRelationship(userPrincipalId);
      if (existingRelationship.success && existingRelationship.data) {
        console.log(`⚠️ User ${userPrincipalId} already has a referral relationship`);
        return {
          success: false,
          error: { type: 'AlreadyExists', message: 'User already registered with a referral code' }
        };
      }
      
      // Build referrer chain up to max_tier_depth
      const maxDepth = this.configManager.getMaxTierDepth();
      const referrerChain: string[] = [referrerL1PrincipalId];
      
      // Recursively build the chain
      let currentReferrer = referrerL1PrincipalId;
      for (let tier = 2; tier <= maxDepth; tier++) {
        const referrerRelationship = await this.getReferralRelationship(currentReferrer);
        if (referrerRelationship.success && referrerRelationship.data) {
          // Get the next referrer in the chain
          const nextReferrer = referrerRelationship.data.referrer_chain[0];
          if (nextReferrer) {
            referrerChain.push(nextReferrer);
            currentReferrer = nextReferrer;
            console.log(`📊 Found L${tier} referrer: ${nextReferrer}`);
          } else {
            break; // No more referrers in chain
          }
        } else {
          break; // Referrer has no relationship
        }
      }
      
      console.log(`🔗 Referrer chain built: ${referrerChain.length} levels`, referrerChain);
      
      const now = Date.now();
      
      // Create referral relationship with flexible chain
      const relationship: ReferralRelationship = {
        user_principal_id: userPrincipalId,
        referrer_chain: referrerChain,
        // Legacy fields for backward compatibility
        referrer_l1_principal_id: referrerChain[0],
        referrer_l2_principal_id: referrerChain[1],
        referral_code_used: referralCode,
        signup_timestamp: now,
        first_24h_status: Installation24hStatus.PENDING,
        first_24h_started_at: now,
        installation_reward_claimed: false,
        created_at: now,
        updated_at: now
      };
      
      const redisClient = this.db.getRedisClient();
      
      // Store relationship
      const relationshipKey = `${REDIS_KEYS.REFERRAL.RELATIONSHIP}${userPrincipalId}`;
      await redisClient.set(relationshipKey, JSON.stringify(relationship));
      
      // Update indexes for all tiers in the chain
      for (let i = 0; i < referrerChain.length; i++) {
        const tierLevel = i + 1; // Tier levels are 1-based
        const referrerPrincipalId = referrerChain[i];
        
        // Add to tier-specific index
        const indexKey = tierLevel === 1 
          ? `${REDIS_KEYS.REFERRAL_INDEX.USER_L1_REFERRALS}${referrerPrincipalId}`
          : tierLevel === 2
            ? `${REDIS_KEYS.REFERRAL_INDEX.USER_L2_REFERRALS}${referrerPrincipalId}`
            : `referral:index:user:l${tierLevel}:${referrerPrincipalId}`;
        
        await redisClient.sAdd(indexKey, userPrincipalId);
        console.log(`✅ Added to L${tierLevel} index for referrer: ${referrerPrincipalId}`);
      }
      
      // Add to pending 24h list
      await redisClient.sAdd(REDIS_KEYS.REFERRAL_INDEX.PENDING_24H, userPrincipalId);
      
      // Update referrer's totalReferral count
      const referrerClient = await this.db.getClient(referrerL1PrincipalId);
      if (referrerClient.success) {
        await this.db.updateClient(referrerL1PrincipalId, {
          totalReferral: referrerClient.data.totalReferral + 1
        });
      }
      
      console.log(`✅ Referral relationship created: ${userPrincipalId} -> Chain: [${referrerChain.join(', ')}]`);
      
      return { success: true, data: relationship };
    } catch (error) {
      console.error(`❌ Error registering with referral code:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to register with referral code: ${error}` }
      };
    }
  }

  /**
   * Create referral code lookup entry when a new client is created
   */
  async createReferralCodeLookup(userPrincipalId: string, referralCode: string): Promise<EntityResult<void>> {
    try {
      const redisClient = this.db.getRedisClient();
      const lookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${referralCode}`;
      await redisClient.set(lookupKey, userPrincipalId);
      
      console.log(`✅ Referral code lookup created: ${referralCode} -> ${userPrincipalId}`);
      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Error creating referral code lookup:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to create referral code lookup: ${error}` }
      };
    }
  }

  // ============================================
  // 2. 24-HOUR INSTALLATION TRACKING & REWARD
  // ============================================

  /**
   * Check and update 24-hour installation completion status
   * Called by uptime tracker when a user reaches 24h total uptime
   */
  async check24HourCompletion(userPrincipalId: string): Promise<EntityResult<{
    completed: boolean;
    reward_distributed: boolean;
    reward_amount?: number;
  }>> {
    try {
      console.log(`🔍 Checking 24h completion for user: ${userPrincipalId}`);
      
      // Get referral relationship
      const relationshipResult = await this.getReferralRelationship(userPrincipalId);
      if (!relationshipResult.success || !relationshipResult.data) {
        console.log(`⚠️ No referral relationship found for user: ${userPrincipalId}`);
        return {
          success: true,
          data: { completed: false, reward_distributed: false }
        };
      }
      
      const relationship = relationshipResult.data;
      
      // Check if already completed
      if (relationship.first_24h_status === Installation24hStatus.COMPLETED) {
        console.log(`✅ 24h already completed for user: ${userPrincipalId}`);
        return {
          success: true,
          data: { 
            completed: true, 
            reward_distributed: relationship.installation_reward_claimed 
          }
        };
      }
      
      // Check if user has reached 24 hours
      const clientResult = await this.db.getClient(userPrincipalId);
      if (!clientResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }
      
      const client = clientResult.data;
      const totalUptimeHours = client.totalUptime / (1000 * 60 * 60);
      const installationConfig = this.configManager.getRewardConfig(ReferralRewardType.INSTALLATION);
      const requiredHours = installationConfig?.requirements?.required_uptime_hours || 24;
      
      if (totalUptimeHours < requiredHours) {
        console.log(`⏰ User ${userPrincipalId} has ${totalUptimeHours.toFixed(2)}h uptime, needs ${requiredHours}h`);
        return {
          success: true,
          data: { completed: false, reward_distributed: false }
        };
      }
      
      // Mark as completed
      const now = Date.now();
      relationship.first_24h_status = Installation24hStatus.COMPLETED;
      relationship.first_24h_completed_at = now;
      relationship.updated_at = now;
      
      // Save updated relationship
      const redisClient = this.db.getRedisClient();
      const relationshipKey = `${REDIS_KEYS.REFERRAL.RELATIONSHIP}${userPrincipalId}`;
      await redisClient.set(relationshipKey, JSON.stringify(relationship));
      
      // Remove from pending 24h list
      await redisClient.sRem(REDIS_KEYS.REFERRAL_INDEX.PENDING_24H, userPrincipalId);
      
      console.log(`✅ 24h completion marked for user: ${userPrincipalId}`);
      
      // Distribute installation reward to L1 referrer
      if (relationship.referrer_l1_principal_id && !relationship.installation_reward_claimed) {
        const rewardResult = await this.distributeInstallationReward(
          relationship.referrer_l1_principal_id,
          userPrincipalId
        );
        
        if (rewardResult.success) {
          relationship.installation_reward_claimed = true;
          relationship.updated_at = Date.now();
          await redisClient.set(relationshipKey, JSON.stringify(relationship));
          
          return {
            success: true,
            data: {
              completed: true,
              reward_distributed: true,
              reward_amount: this.configManager.getInstallationRewardAmount()
            }
          };
        }
      }
      
      return {
        success: true,
        data: { completed: true, reward_distributed: false }
      };
    } catch (error) {
      console.error(`❌ Error checking 24h completion:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to check 24h completion: ${error}` }
      };
    }
  }

  /**
   * Distribute installation reward (500 points) to L1 referrer
   */
  private async distributeInstallationReward(
    referrerPrincipalId: string,
    refereePrincipalId: string
  ): Promise<EntityResult<ReferralReward>> {
    try {
      console.log(`💰 Distributing installation reward: ${referrerPrincipalId} <- ${refereePrincipalId}`);
      
      const rewardAmount = this.configManager.getInstallationRewardAmount();
      const now = Date.now();
      const rewardId = `reward_install_${referrerPrincipalId}_${refereePrincipalId}_${now}`;
      
      const reward: ReferralReward = {
        reward_id: rewardId,
        referrer_principal_id: referrerPrincipalId,
        referee_principal_id: refereePrincipalId,
        reward_type: ReferralRewardType.INSTALLATION,
        tier: ReferralTier.L1,
        base_amount: rewardAmount,
        reward_percentage: 100,
        reward_amount: rewardAmount,
        timestamp: now,
        distribution_date: new Date().toISOString().split('T')[0],
        status: 'DISTRIBUTED',
        distributed_at: now,
        created_at: now,
        updated_at: now
      };
      
      // Store reward
      const redisClient = this.db.getRedisClient();
      const rewardKey = `${REDIS_KEYS.REFERRAL.REWARD}${rewardId}`;
      await redisClient.set(rewardKey, JSON.stringify(reward));
      
      // Update indexes
      await redisClient.sAdd(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_USER}${referrerPrincipalId}`,
        rewardId
      );
      await redisClient.sAdd(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_REFEREE}${refereePrincipalId}`,
        rewardId
      );
      
      // Add points to referrer's balance
      const referrerResult = await this.db.getClient(referrerPrincipalId);
      if (referrerResult.success) {
        await this.db.updateClient(referrerPrincipalId, {
          balance: referrerResult.data.balance + rewardAmount,
          todaysEarnings: referrerResult.data.todaysEarnings + rewardAmount
        });
      }
      
      const blockchainRequest: BlockchainTransactionRequest = {
        userPrincipalId: referrerPrincipalId,
        amount: rewardAmount,
        rewardType: 'BONUS_REWARD',
        metadata: {
          tier_level: ReferralTier.L1
        }
      };
      
      const blockchainResult = await this.blockchainService.sendRewardTransaction(blockchainRequest);
      
      if (!blockchainResult.success) {
        console.error(`⚠️ Blockchain transaction failed for installation reward: ${blockchainResult.error}`);
      } else {
        console.log(`🔗 Blockchain transaction successful for installation reward: ${blockchainResult.transactionHash}`);
      }
      
      console.log(`✅ Installation reward distributed: ${rewardAmount} points to ${referrerPrincipalId}`);
      
      return { success: true, data: reward };
    } catch (error) {
      console.error(`❌ Error distributing installation reward:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to distribute installation reward: ${error}` }
      };
    }
  }

  // ============================================
  // 3. UPTIME-BASED REWARDS (Weekly, with Monthly Cap)
  // ============================================

  /**
   * Calculate and distribute uptime rewards
   * Called when a referee earns uptime rewards (weekly 100h+)
   */
  async calculateUptimeReward(
    refereePrincipalId: string,
    earnedPoints: number,
    weeklyUptimeMinutes: number
  ): Promise<EntityResult<{
    l1_reward?: ReferralReward;
    l2_reward?: ReferralReward;
    total_distributed: number;
  }>> {
    try {
      console.log(`💰 Calculating uptime rewards for referee: ${refereePrincipalId}, earned: ${earnedPoints}, uptime: ${weeklyUptimeMinutes}min`);
      
      // Check if weekly uptime meets requirement
      const uptimeConfig = this.configManager.getRewardConfig(ReferralRewardType.UPTIME);
      const requiredWeeklyHours = uptimeConfig?.requirements?.min_uptime_hours_weekly || 100;
      const requiredMinutes = requiredWeeklyHours * 60;
      
      if (weeklyUptimeMinutes < requiredMinutes) {
        console.log(`⚠️ Weekly uptime ${weeklyUptimeMinutes}min does not meet requirement ${requiredMinutes}min`);
        return {
          success: true,
          data: { total_distributed: 0 }
        };
      }
      
      // Get referral relationship
      const relationshipResult = await this.getReferralRelationship(refereePrincipalId);
      if (!relationshipResult.success || !relationshipResult.data) {
        console.log(`⚠️ No referral relationship for referee: ${refereePrincipalId}`);
        return {
          success: true,
          data: { total_distributed: 0 }
        };
      }
      
      const relationship = relationshipResult.data;
      let totalDistributed = 0;
      const rewards: Record<string, ReferralReward> = {};
      
      // Get enabled tiers for uptime rewards
      const enabledTiers = this.configManager.getEnabledTiers(ReferralRewardType.UPTIME);
      
      // Distribute rewards to all referrers in the chain
      for (const tierConfig of enabledTiers) {
        const tierIndex = tierConfig.tier_level - 1; // Convert to 0-based index
        const referrerPrincipalId = relationship.referrer_chain[tierIndex];
        
        if (!referrerPrincipalId) {
          console.log(`⚠️ No referrer at tier ${tierConfig.tier_level} for referee ${refereePrincipalId}`);
          continue;
        }
        
        const tierReward = await this.distributeUptimeReward(
          referrerPrincipalId,
          refereePrincipalId,
          earnedPoints,
          weeklyUptimeMinutes,
          tierConfig.tier_level as ReferralTier,
          tierConfig.reward_percentage
        );
        
        if (tierReward.success) {
          rewards[`l${tierConfig.tier_level}_reward`] = tierReward.data;
          totalDistributed += tierReward.data.reward_amount;
        }
      }
      
      console.log(`✅ Uptime rewards distributed: ${totalDistributed} points total`);
      
      return {
        success: true,
        data: { ...rewards, total_distributed: totalDistributed }
      };
    } catch (error) {
      console.error(`❌ Error calculating uptime rewards:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to calculate uptime rewards: ${error}` }
      };
    }
  }

  /**
   * Distribute a single uptime reward with monthly cap check
   */
  private async distributeUptimeReward(
    referrerPrincipalId: string,
    refereePrincipalId: string,
    earnedPoints: number,
    weeklyUptimeMinutes: number,
    tier: ReferralTier,
    percentage: number
  ): Promise<EntityResult<ReferralReward>> {
    try {
      // Check monthly cap
      const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
      const capResult = await this.checkMonthlyCap(referrerPrincipalId, currentMonth);
      
      let rewardAmount = Math.round(((earnedPoints * percentage) / 100) * 10000) / 10000; // Preserve 4 decimal places
      let status: 'DISTRIBUTED' | 'CAPPED' = 'DISTRIBUTED';
      
      if (capResult.success && capResult.data.cap_reached) {
        console.log(`⚠️ Monthly cap reached for referrer: ${referrerPrincipalId}`);
        status = 'CAPPED';
        rewardAmount = 0;
      } else if (capResult.success) {
        // Check if this reward would exceed the cap
        const remaining = capResult.data.remaining;
        if (rewardAmount > remaining) {
          console.log(`⚠️ Reward ${rewardAmount} exceeds remaining cap ${remaining}, capping reward`);
          rewardAmount = remaining;
        }
      }
      
      const now = Date.now();
      const rewardId = `reward_uptime_${referrerPrincipalId}_${refereePrincipalId}_${tier}_${now}`;
      
      const reward: ReferralReward = {
        reward_id: rewardId,
        referrer_principal_id: referrerPrincipalId,
        referee_principal_id: refereePrincipalId,
        reward_type: ReferralRewardType.UPTIME,
        tier: tier,
        base_amount: earnedPoints,
        reward_percentage: percentage,
        reward_amount: rewardAmount,
        timestamp: now,
        distribution_date: new Date().toISOString().split('T')[0],
        status: status,
        distributed_at: status === 'DISTRIBUTED' ? now : undefined,
        weekly_uptime_minutes: weeklyUptimeMinutes,
        created_at: now,
        updated_at: now
      };
      
      // Store reward
      const redisClient = this.db.getRedisClient();
      const rewardKey = `${REDIS_KEYS.REFERRAL.REWARD}${rewardId}`;
      await redisClient.set(rewardKey, JSON.stringify(reward));
      
      // Update indexes
      await redisClient.sAdd(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_USER}${referrerPrincipalId}`,
        rewardId
      );
      await redisClient.sAdd(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_REFEREE}${refereePrincipalId}`,
        rewardId
      );
      
      // Update monthly cap if reward was distributed
      if (status === 'DISTRIBUTED' && rewardAmount > 0) {
        await this.updateMonthlyCap(referrerPrincipalId, currentMonth, rewardAmount, tier);
        
        // Add points to referrer's balance
        const referrerResult = await this.db.getClient(referrerPrincipalId);
        if (referrerResult.success) {
          await this.db.updateClient(referrerPrincipalId, {
            balance: referrerResult.data.balance + rewardAmount,
            todaysEarnings: referrerResult.data.todaysEarnings + rewardAmount,
            uptimeReward: referrerResult.data.uptimeReward + rewardAmount
          });
        }
        
        const blockchainRequest: BlockchainTransactionRequest = {
          userPrincipalId: referrerPrincipalId,
          amount: rewardAmount,
          rewardType: 'BONUS_REWARD',
          metadata: {
            uptime_minutes: weeklyUptimeMinutes,
            tier_level: tier
          }
        };
        
        const blockchainResult = await this.blockchainService.sendRewardTransaction(blockchainRequest);
        
        if (!blockchainResult.success) {
          console.error(`⚠️ Blockchain transaction failed for uptime reward: ${blockchainResult.error}`);
        } else {
          console.log(`🔗 Blockchain transaction successful for uptime reward: ${blockchainResult.transactionHash}`);
        }
      }
      
      console.log(`✅ Uptime reward (L${tier}): ${rewardAmount} points to ${referrerPrincipalId} (${percentage}% of ${earnedPoints})`);
      
      return { success: true, data: reward };
    } catch (error) {
      console.error(`❌ Error distributing uptime reward:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to distribute uptime reward: ${error}` }
      };
    }
  }

  // ============================================
  // 4. TASK-BASED REWARDS (Per Job Completion)
  // ============================================

  /**
   * Calculate and distribute task rewards when a job is completed
   */
  async calculateTaskReward(
    refereePrincipalId: string,
    earnedPoints: number,
    jobId: string
  ): Promise<EntityResult<{
    l1_reward?: ReferralReward;
    l2_reward?: ReferralReward;
    total_distributed: number;
  }>> {
    try {
      console.log(`💰 Calculating task rewards for referee: ${refereePrincipalId}, earned: ${earnedPoints}, job: ${jobId}`);
      
      // Get referral relationship
      const relationshipResult = await this.getReferralRelationship(refereePrincipalId);
      if (!relationshipResult.success || !relationshipResult.data) {
        console.log(`⚠️ No referral relationship for referee: ${refereePrincipalId}`);
        return {
          success: true,
          data: { total_distributed: 0 }
        };
      }
      
      const relationship = relationshipResult.data;
      let totalDistributed = 0;
      const rewards: Record<string, ReferralReward> = {};
      
      // Get enabled tiers for task rewards
      const enabledTiers = this.configManager.getEnabledTiers(ReferralRewardType.TASK);
      
      // Distribute rewards to all referrers in the chain
      for (const tierConfig of enabledTiers) {
        const tierIndex = tierConfig.tier_level - 1; // Convert to 0-based index
        const referrerPrincipalId = relationship.referrer_chain[tierIndex];
        
        if (!referrerPrincipalId) {
          console.log(`⚠️ No referrer at tier ${tierConfig.tier_level} for referee ${refereePrincipalId}`);
          continue;
        }
        
        const tierReward = await this.distributeTaskReward(
          referrerPrincipalId,
          refereePrincipalId,
          earnedPoints,
          jobId,
          tierConfig.tier_level as ReferralTier,
          tierConfig.reward_percentage
        );
        
        if (tierReward.success) {
          rewards[`l${tierConfig.tier_level}_reward`] = tierReward.data;
          totalDistributed += tierReward.data.reward_amount;
        }
      }
      
      console.log(`✅ Task rewards distributed: ${totalDistributed} points total for job ${jobId}`);
      
      return {
        success: true,
        data: { ...rewards, total_distributed: totalDistributed }
      };
    } catch (error) {
      console.error(`❌ Error calculating task rewards:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to calculate task rewards: ${error}` }
      };
    }
  }

  /**
   * Distribute a single task reward
   */
  private async distributeTaskReward(
    referrerPrincipalId: string,
    refereePrincipalId: string,
    earnedPoints: number,
    jobId: string,
    tier: ReferralTier,
    percentage: number
  ): Promise<EntityResult<ReferralReward>> {
    try {
      const rewardAmount = Math.round(((earnedPoints * percentage) / 100) * 10000) / 10000; // Preserve 4 decimal places
      const now = Date.now();
      const rewardId = `reward_task_${referrerPrincipalId}_${refereePrincipalId}_${tier}_${jobId}_${now}`;
      
      const reward: ReferralReward = {
        reward_id: rewardId,
        referrer_principal_id: referrerPrincipalId,
        referee_principal_id: refereePrincipalId,
        reward_type: ReferralRewardType.TASK,
        tier: tier,
        base_amount: earnedPoints,
        reward_percentage: percentage,
        reward_amount: rewardAmount,
        timestamp: now,
        distribution_date: new Date().toISOString().split('T')[0],
        status: 'DISTRIBUTED',
        distributed_at: now,
        job_id: jobId,
        created_at: now,
        updated_at: now
      };
      
      // Store reward
      const redisClient = this.db.getRedisClient();
      const rewardKey = `${REDIS_KEYS.REFERRAL.REWARD}${rewardId}`;
      await redisClient.set(rewardKey, JSON.stringify(reward));
      
      // Update indexes
      await redisClient.sAdd(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_USER}${referrerPrincipalId}`,
        rewardId
      );
      await redisClient.sAdd(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_REFEREE}${refereePrincipalId}`,
        rewardId
      );
      
      // Add points to referrer's balance
      const referrerResult = await this.db.getClient(referrerPrincipalId);
      if (referrerResult.success) {
        await this.db.updateClient(referrerPrincipalId, {
          balance: referrerResult.data.balance + rewardAmount,
          todaysEarnings: referrerResult.data.todaysEarnings + rewardAmount
        });
      }
      
      const blockchainRequest: BlockchainTransactionRequest = {
        userPrincipalId: referrerPrincipalId,
        amount: rewardAmount,
        rewardType: 'BONUS_REWARD',
        metadata: {
          tier_level: tier
        }
      };
      
      const blockchainResult = await this.blockchainService.sendRewardTransaction(blockchainRequest);
      
      if (!blockchainResult.success) {
        console.error(`⚠️ Blockchain transaction failed for task reward: ${blockchainResult.error}`);
      } else {
        console.log(`🔗 Blockchain transaction successful for task reward: ${blockchainResult.transactionHash}`);
      }
      
      console.log(`✅ Task reward (L${tier}): ${rewardAmount} points to ${referrerPrincipalId} (${percentage}% of ${earnedPoints})`);
      
      return { success: true, data: reward };
    } catch (error) {
      console.error(`❌ Error distributing task reward:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to distribute task reward: ${error}` }
      };
    }
  }

  // ============================================
  // 5. MONTHLY CAP MANAGEMENT
  // ============================================

  /**
   * Check monthly cap for a referrer
   */
  private async checkMonthlyCap(
    referrerPrincipalId: string,
    month: string
  ): Promise<EntityResult<{
    cap_reached: boolean;
    earned: number;
    cap: number;
    remaining: number;
  }>> {
    try {
      const redisClient = this.db.getRedisClient();
      const capKey = `${REDIS_KEYS.REFERRAL.MONTHLY_CAP}${referrerPrincipalId}:${month}`;
      const capData = await redisClient.get(capKey);
      
      if (!capData) {
        // No cap data yet, create new
        const uptimeConfig = this.configManager.getRewardConfig(ReferralRewardType.UPTIME);
        const defaultCap = uptimeConfig?.tier_configs[0]?.monthly_cap_amount || 10000;
        
        return {
          success: true,
          data: {
            cap_reached: false,
            earned: 0,
            cap: defaultCap,
            remaining: defaultCap
          }
        };
      }
      
      const cap: ReferralMonthlyCap = JSON.parse(capData);
      const remaining = cap.uptime_rewards_cap - cap.uptime_rewards_earned;
      
      return {
        success: true,
        data: {
          cap_reached: cap.cap_reached,
          earned: cap.uptime_rewards_earned,
          cap: cap.uptime_rewards_cap,
          remaining: Math.max(0, remaining)
        }
      };
    } catch (error) {
      console.error(`❌ Error checking monthly cap:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to check monthly cap: ${error}` }
      };
    }
  }

  /**
   * Update monthly cap after distributing uptime reward
   */
  private async updateMonthlyCap(
    referrerPrincipalId: string,
    month: string,
    rewardAmount: number,
    tier: ReferralTier
  ): Promise<EntityResult<void>> {
    try {
      const redisClient = this.db.getRedisClient();
      const capKey = `${REDIS_KEYS.REFERRAL.MONTHLY_CAP}${referrerPrincipalId}:${month}`;
      const capData = await redisClient.get(capKey);
      
      const now = Date.now();
      let cap: ReferralMonthlyCap;
      
      if (!capData) {
        // Create new cap record
        const uptimeConfig = this.configManager.getRewardConfig(ReferralRewardType.UPTIME);
        const defaultCap = uptimeConfig?.tier_configs[0]?.monthly_cap_amount || 10000;
        
        cap = {
          referrer_principal_id: referrerPrincipalId,
          month: month,
          uptime_rewards_earned: rewardAmount,
          uptime_rewards_cap: defaultCap,
          cap_reached: false,
          total_l1_uptime_rewards: tier === ReferralTier.L1 ? rewardAmount : 0,
          total_l2_uptime_rewards: tier === ReferralTier.L2 ? rewardAmount : 0,
          created_at: now,
          updated_at: now
        };
      } else {
        // Update existing cap record
        cap = JSON.parse(capData);
        cap.uptime_rewards_earned += rewardAmount;
        cap.updated_at = now;
        
        if (tier === ReferralTier.L1) {
          cap.total_l1_uptime_rewards += rewardAmount;
        } else {
          cap.total_l2_uptime_rewards += rewardAmount;
        }
      }
      
      // Check if cap is now reached
      if (cap.uptime_rewards_earned >= cap.uptime_rewards_cap && !cap.cap_reached) {
        cap.cap_reached = true;
        cap.cap_reached_at = now;
        console.log(`🚨 Monthly cap reached for referrer: ${referrerPrincipalId} in ${month}`);
      }
      
      await redisClient.set(capKey, JSON.stringify(cap));
      
      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Error updating monthly cap:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to update monthly cap: ${error}` }
      };
    }
  }

  // ============================================
  // 6. QUERY METHODS
  // ============================================

  /**
   * Get referral relationship for a user
   */
  async getReferralRelationship(userPrincipalId: string): Promise<EntityResult<ReferralRelationship | null>> {
    try {
      const redisClient = this.db.getRedisClient();
      const relationshipKey = `${REDIS_KEYS.REFERRAL.RELATIONSHIP}${userPrincipalId}`;
      const data = await redisClient.get(relationshipKey);
      
      if (!data) {
        return { success: true, data: null };
      }
      
      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      console.error(`❌ Error getting referral relationship:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get referral relationship: ${error}` }
      };
    }
  }

  /**
   * Get all L1 referrals for a user
   */
  async getL1Referrals(userPrincipalId: string): Promise<EntityResult<string[]>> {
    try {
      const redisClient = this.db.getRedisClient();
      const referrals = await redisClient.sMembers(
        `${REDIS_KEYS.REFERRAL_INDEX.USER_L1_REFERRALS}${userPrincipalId}`
      );
      
      return { success: true, data: referrals };
    } catch (error) {
      console.error(`❌ Error getting L1 referrals:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get L1 referrals: ${error}` }
      };
    }
  }

  /**
   * Get all L2 referrals for a user
   */
  async getL2Referrals(userPrincipalId: string): Promise<EntityResult<string[]>> {
    try {
      const redisClient = this.db.getRedisClient();
      const referrals = await redisClient.sMembers(
        `${REDIS_KEYS.REFERRAL_INDEX.USER_L2_REFERRALS}${userPrincipalId}`
      );
      
      return { success: true, data: referrals };
    } catch (error) {
      console.error(`❌ Error getting L2 referrals:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get L2 referrals: ${error}` }
      };
    }
  }

  /**
   * Get all rewards for a referrer
   */
  async getReferralRewards(referrerPrincipalId: string): Promise<EntityResult<ReferralReward[]>> {
    try {
      const redisClient = this.db.getRedisClient();
      const rewardIds = await redisClient.sMembers(
        `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_USER}${referrerPrincipalId}`
      );
      
      if (rewardIds.length === 0) {
        return { success: true, data: [] };
      }
      
      const rewards: ReferralReward[] = [];
      for (const rewardId of rewardIds) {
        const rewardKey = `${REDIS_KEYS.REFERRAL.REWARD}${rewardId}`;
        const rewardData = await redisClient.get(rewardKey);
        if (rewardData) {
          rewards.push(JSON.parse(rewardData));
        }
      }
      
      // Sort by timestamp (newest first)
      rewards.sort((a, b) => b.timestamp - a.timestamp);
      
      return { success: true, data: rewards };
    } catch (error) {
      console.error(`❌ Error getting referral rewards:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get referral rewards: ${error}` }
      };
    }
  }

  /**
   * Get referral statistics for a user
   */
  async getReferralStats(userPrincipalId: string): Promise<EntityResult<ReferralStats>> {
    try {
      console.log(`📊 Getting referral stats for user: ${userPrincipalId}`);
      
      // Get L1 and L2 referrals
      const l1Result = await this.getL1Referrals(userPrincipalId);
      const l2Result = await this.getL2Referrals(userPrincipalId);
      
      if (!l1Result.success || !l2Result.success) {
        return {
          success: false,
          error: { type: 'DatabaseError', message: 'Failed to get referrals' }
        };
      }
      
      const l1Referrals = l1Result.data;
      const l2Referrals = l2Result.data;
      
      // Count active referrals and track qualified/pending status
      let l1ActiveCount = 0;
      let l1Pending24h = 0;
      let l1QualifiedCount = 0;
      
      for (const refereePrincipalId of l1Referrals) {
        const clientResult = await this.db.getClient(refereePrincipalId);
        if (clientResult.success) {
          if (clientResult.data.clientStatus === ClientStatus.ACTIVE && clientResult.data.wsDisconnect === 0) {
            l1ActiveCount++;
          }
        }
        
        const relationshipResult = await this.getReferralRelationship(refereePrincipalId);
        if (relationshipResult.success && relationshipResult.data) {
          if (relationshipResult.data.first_24h_status === Installation24hStatus.PENDING) {
            l1Pending24h++;
          } else if (relationshipResult.data.first_24h_status === Installation24hStatus.COMPLETED) {
            l1QualifiedCount++;
          }
        }
      }
      
      let l2ActiveCount = 0;
      let l2Pending24h = 0;
      let l2QualifiedCount = 0;
      for (const refereePrincipalId of l2Referrals) {
        const clientResult = await this.db.getClient(refereePrincipalId);
        if (clientResult.success) {
          if (clientResult.data.clientStatus === ClientStatus.ACTIVE && clientResult.data.wsDisconnect === 0) {
            l2ActiveCount++;
          }
        }
        
        const relationshipResult = await this.getReferralRelationship(refereePrincipalId);
        if (relationshipResult.success && relationshipResult.data) {
          if (relationshipResult.data.first_24h_status === Installation24hStatus.PENDING) {
            l2Pending24h++;
          } else if (relationshipResult.data.first_24h_status === Installation24hStatus.COMPLETED) {
            l2QualifiedCount++;
          }
        }
      }
      
      // Get rewards
      const rewardsResult = await this.getReferralRewards(userPrincipalId);
      if (!rewardsResult.success) {
        return {
          success: false,
          error: { type: 'DatabaseError', message: 'Failed to get rewards' }
        };
      }
      
      const rewards = rewardsResult.data.filter(r => r.status === 'DISTRIBUTED');
      
      // Calculate earnings breakdown
      let installationEarnings = 0;
      let uptimeEarnings = 0;
      let taskEarnings = 0;
      let l1TotalEarned = 0;
      let l2TotalEarned = 0;
      let thisWeekRewards = 0;
      
      // Calculate start of current week (Monday)
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
      startOfWeek.setHours(0, 0, 0, 0);
      const startOfWeekTimestamp = startOfWeek.getTime();
      
      for (const reward of rewards) {
        if (reward.reward_type === ReferralRewardType.INSTALLATION) {
          installationEarnings += reward.reward_amount;
        } else if (reward.reward_type === ReferralRewardType.UPTIME) {
          uptimeEarnings += reward.reward_amount;
        } else if (reward.reward_type === ReferralRewardType.TASK) {
          taskEarnings += reward.reward_amount;
        }
        
        if (reward.tier === ReferralTier.L1) {
          l1TotalEarned += reward.reward_amount;
        } else {
          l2TotalEarned += reward.reward_amount;
        }
        
        // Check if reward was earned this week
        if (reward.timestamp >= startOfWeekTimestamp) {
          thisWeekRewards += reward.reward_amount;
        }
      }
      
      const totalEarned = installationEarnings + uptimeEarnings + taskEarnings;
      
      // Get monthly cap info
      const currentMonth = new Date().toISOString().substring(0, 7);
      const capResult = await this.checkMonthlyCap(userPrincipalId, currentMonth);
      
      const stats: ReferralStats = {
        user_principal_id: userPrincipalId,
        l1_total_referrals: l1Referrals.length,
        l1_active_referrals: l1ActiveCount,
        l1_pending_24h: l1Pending24h,
        l2_total_referrals: l2Referrals.length,
        l2_active_referrals: l2ActiveCount,
        total_earned: totalEarned,
        installation_earnings: installationEarnings,
        uptime_earnings: uptimeEarnings,
        task_earnings: taskEarnings,
        l1_total_earned: l1TotalEarned,
        l2_total_earned: l2TotalEarned,
        current_month: currentMonth,
        current_month_uptime_earned: capResult.success ? capResult.data.earned : 0,
        current_month_cap_remaining: capResult.success ? capResult.data.remaining : 0,
        // New requested fields
        total_referral_rewards: totalEarned,
        this_week_referral_rewards: thisWeekRewards,
        qualified_referrals: l1QualifiedCount + l2QualifiedCount,
        pending_referrals: l1Pending24h + l2Pending24h,
        last_updated: Date.now()
      };
      
      console.log(`✅ Referral stats calculated for user: ${userPrincipalId}`);
      
      return { success: true, data: stats };
    } catch (error) {
      console.error(`❌ Error getting referral stats:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get referral stats: ${error}` }
      };
    }
  }

  /**
   * Get referral dashboard data with detailed information
   */
  async getReferralDashboard(userPrincipalId: string): Promise<EntityResult<any>> {
    try {
      console.log(`📊 Getting referral dashboard for user: ${userPrincipalId}`);
      
      // Get user's client data for referral code
      const clientResult = await this.db.getClient(userPrincipalId);
      if (!clientResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }
      
      const client = clientResult.data;
      
      // Get referral stats
      const statsResult = await this.getReferralStats(userPrincipalId);
      if (!statsResult.success) {
        return statsResult;
      }
      
      const stats = statsResult.data;
      
      // Get recent rewards (last 10)
      const rewardsResult = await this.getReferralRewards(userPrincipalId);
      const recentRewards = rewardsResult.success ? rewardsResult.data.slice(0, 10) : [];
      
      // Get recent referrals with details
      const l1Result = await this.getL1Referrals(userPrincipalId);
      const recentReferrals = [];
      const redisClient = this.db.getRedisClient();
      
      if (l1Result.success) {
        for (const refereePrincipalId of l1Result.data.slice(0, 5)) {
          const refereeClient = await this.db.getClient(refereePrincipalId);
          const relationship = await this.getReferralRelationship(refereePrincipalId);
          
          if (refereeClient.success && relationship.success && relationship.data) {
            const refereeRewards = await redisClient.sMembers(
              `${REDIS_KEYS.REFERRAL_INDEX.REWARDS_BY_REFEREE}${refereePrincipalId}`
            );
            
            let totalEarnedForMe = 0;
            for (const rewardId of refereeRewards) {
              const rewardData = await redisClient.get(`${REDIS_KEYS.REFERRAL.REWARD}${rewardId}`);
              if (rewardData) {
                const reward: ReferralReward = JSON.parse(rewardData);
                if (reward.referrer_principal_id === userPrincipalId && reward.status === 'DISTRIBUTED') {
                  totalEarnedForMe += reward.reward_amount;
                }
              }
            }
            
            recentReferrals.push({
              user_principal_id: refereePrincipalId,
              tier: 1,
              signup_date: relationship.data.signup_timestamp,
              status: relationship.data.first_24h_status === Installation24hStatus.COMPLETED ? 'ACTIVE' : 
                      relationship.data.first_24h_status === Installation24hStatus.PENDING ? 'PENDING_24H' : 'INACTIVE',
              is_online: refereeClient.data.wsDisconnect === 0,
              total_earned_for_me: totalEarnedForMe
            });
          }
        }
      }
      
      const dashboard = {
        my_referral_code: client.referralCode,
        
        tier1: {
          total_referrals: stats.l1_total_referrals,
          active_referrals: stats.l1_active_referrals,
          pending_24h: stats.l1_pending_24h,
          total_earned: stats.l1_total_earned,
          breakdown: {
            installation: recentRewards.filter(r => r.tier === ReferralTier.L1 && r.reward_type === ReferralRewardType.INSTALLATION && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
            uptime: recentRewards.filter(r => r.tier === ReferralTier.L1 && r.reward_type === ReferralRewardType.UPTIME && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
            task: recentRewards.filter(r => r.tier === ReferralTier.L1 && r.reward_type === ReferralRewardType.TASK && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
          }
        },
        
        tier2: {
          total_referrals: stats.l2_total_referrals,
          active_referrals: stats.l2_active_referrals,
          total_earned: stats.l2_total_earned,
          breakdown: {
            uptime: recentRewards.filter(r => r.tier === ReferralTier.L2 && r.reward_type === ReferralRewardType.UPTIME && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
            task: recentRewards.filter(r => r.tier === ReferralTier.L2 && r.reward_type === ReferralRewardType.TASK && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
          }
        },
        
        monthly_cap_status: {
          current_month: stats.current_month,
          uptime_rewards_earned: stats.current_month_uptime_earned,
          cap: (() => {
            const uptimeConfig = this.configManager.getRewardConfig(ReferralRewardType.UPTIME);
            return uptimeConfig?.tier_configs[0]?.monthly_cap_amount || 10000;
          })(),
          remaining: stats.current_month_cap_remaining,
          percentage_used: (() => {
            const uptimeConfig = this.configManager.getRewardConfig(ReferralRewardType.UPTIME);
            const cap = uptimeConfig?.tier_configs[0]?.monthly_cap_amount || 10000;
            return Math.round((stats.current_month_uptime_earned / cap) * 100);
          })()
        },
        
        recent_referrals: recentReferrals,
        recent_rewards: recentRewards.map(r => ({
          reward_id: r.reward_id,
          referee_principal_id: r.referee_principal_id,
          reward_type: r.reward_type,
          tier: r.tier,
          reward_amount: r.reward_amount,
          timestamp: r.timestamp,
          distribution_date: r.distribution_date,
          status: r.status
        })),
        
        total_summary: {
          total_earned: stats.total_earned,
          installation_earnings: stats.installation_earnings,
          uptime_earnings: stats.uptime_earnings,
          task_earnings: stats.task_earnings
        }
      };
      
      console.log(`✅ Referral dashboard generated for user: ${userPrincipalId}`);
      
      return { success: true, data: dashboard };
    } catch (error) {
      console.error(`❌ Error getting referral dashboard:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get referral dashboard: ${error}` }
      };
    }
  }

  // ============================================
  // 7. UTILITY METHODS
  // ============================================

  /**
   * Get referral system configuration
   */
  getConfig(): ReferralConfig {
    return this.configManager.getConfig();
  }

  /**
   * Get configuration manager for advanced operations
   */
  getConfigManager(): ReferralConfigManager {
    return this.configManager;
  }

  /**
   * Update referral system configuration
   */
  updateConfig(updates: Partial<ReferralConfig>): void {
    this.configManager.updateConfig(updates);
    console.log(`✅ Referral config updated`);
  }

  /**
   * Check if referral system is enabled
   */
  isEnabled(): boolean {
    return this.configManager.getConfig().enabled;
  }
  
  /**
   * Check if a reward type is enabled
   */
  isRewardTypeEnabled(type: ReferralRewardType): boolean {
    return this.configManager.isRewardTypeEnabled(type);
  }
  
  /**
   * Get distribution cycle for a reward type
   */
  getDistributionCycle(type: ReferralRewardType): DistributionCycle | undefined {
    return this.configManager.getDistributionCycle(type);
  }
  
  /**
   * Add a new tier (for future expansion)
   * Example: Add tier 3 for task rewards with 1% reward
   */
  addTier(type: ReferralRewardType, tierLevel: number, percentage: number, hasMonthlyCap: boolean = false): void {
    this.configManager.addTier(type, {
      tier_level: tierLevel,
      reward_percentage: percentage,
      has_monthly_cap: hasMonthlyCap,
      monthly_cap_amount: hasMonthlyCap ? 10000 : undefined,
      enabled: true
    });
    
    console.log(`✅ Tier ${tierLevel} added for ${type} rewards: ${percentage}%`);
  }
  
  /**
   * Enable/disable a specific tier
   */
  setTierEnabled(type: ReferralRewardType, tierLevel: number, enabled: boolean): void {
    this.configManager.setTierEnabled(type, tierLevel, enabled);
  }
}

