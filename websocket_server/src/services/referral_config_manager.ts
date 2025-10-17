import { 
  ReferralConfig, 
  RewardTypeConfig, 
  TierRewardConfig,
  ReferralRewardType,
  DistributionCycle
} from '../db/types';

/**
 * ReferralConfigManager
 * Manages referral system configuration with support for flexible tier structures
 */
export class ReferralConfigManager {
  private config: ReferralConfig;

  constructor(customConfig?: Partial<ReferralConfig>) {
    this.config = this.buildDefaultConfig();
    
    // Apply custom configuration
    if (customConfig) {
      this.applyCustomConfig(customConfig);
    }
  }

  /**
   * Build default configuration (2-tier system)
   */
  private buildDefaultConfig(): ReferralConfig {
    return {
      enabled: true,
      max_tier_depth: 2,
      referral_code_length: 8,
      
      // Installation Reward: 500 points to L1 only, immediate distribution
      installation_reward: {
        type: ReferralRewardType.INSTALLATION,
        enabled: true,
        distribution_cycle: DistributionCycle.IMMEDIATE,
        tier_configs: [
          {
            tier_level: 1,
            reward_percentage: 100,  // Full 500 points
            has_monthly_cap: false,
            enabled: true
          }
        ],
        requirements: {
          required_uptime_hours: 24
        }
      },
      
      // Uptime Reward: 2% L1, 1% L2, weekly distribution with monthly cap
      uptime_reward: {
        type: ReferralRewardType.UPTIME,
        enabled: true,
        distribution_cycle: DistributionCycle.WEEKLY,
        tier_configs: [
          {
            tier_level: 1,
            reward_percentage: 2.0,
            has_monthly_cap: true,
            monthly_cap_amount: 10000,
            enabled: true
          },
          {
            tier_level: 2,
            reward_percentage: 1.0,
            has_monthly_cap: true,
            monthly_cap_amount: 10000,
            enabled: true
          }
        ],
        requirements: {
          min_uptime_hours_weekly: 100
        }
      },
      
      // Task Reward: 5% L1, 2% L2, immediate distribution, no cap
      task_reward: {
        type: ReferralRewardType.TASK,
        enabled: true,
        distribution_cycle: DistributionCycle.IMMEDIATE,
        tier_configs: [
          {
            tier_level: 1,
            reward_percentage: 5.0,
            has_monthly_cap: false,
            enabled: true
          },
          {
            tier_level: 2,
            reward_percentage: 2.0,
            has_monthly_cap: false,
            enabled: true
          }
        ]
      }
    };
  }

  /**
   * Apply custom configuration with backward compatibility
   */
  private applyCustomConfig(customConfig: Partial<ReferralConfig>): void {
    // Handle legacy config format
    if (customConfig.installation_reward_points !== undefined) {
      this.config.installation_reward.tier_configs[0].reward_percentage = 100;
      // Legacy: fixed 500 points
    }
    
    if (customConfig.installation_required_uptime_hours !== undefined) {
      this.config.installation_reward.requirements = {
        required_uptime_hours: customConfig.installation_required_uptime_hours
      };
    }
    
    if (customConfig.uptime_l1_percentage !== undefined) {
      if (this.config.uptime_reward.tier_configs[0]) {
        this.config.uptime_reward.tier_configs[0].reward_percentage = customConfig.uptime_l1_percentage;
      }
    }
    
    if (customConfig.uptime_l2_percentage !== undefined) {
      if (this.config.uptime_reward.tier_configs[1]) {
        this.config.uptime_reward.tier_configs[1].reward_percentage = customConfig.uptime_l2_percentage;
      }
    }
    
    if (customConfig.uptime_required_weekly_hours !== undefined) {
      this.config.uptime_reward.requirements = {
        ...this.config.uptime_reward.requirements,
        min_uptime_hours_weekly: customConfig.uptime_required_weekly_hours
      };
    }
    
    if (customConfig.uptime_monthly_cap_per_referrer !== undefined) {
      this.config.uptime_reward.tier_configs.forEach(tier => {
        if (tier.has_monthly_cap) {
          tier.monthly_cap_amount = customConfig.uptime_monthly_cap_per_referrer;
        }
      });
    }
    
    if (customConfig.task_l1_percentage !== undefined) {
      if (this.config.task_reward.tier_configs[0]) {
        this.config.task_reward.tier_configs[0].reward_percentage = customConfig.task_l1_percentage;
      }
    }
    
    if (customConfig.task_l2_percentage !== undefined) {
      if (this.config.task_reward.tier_configs[1]) {
        this.config.task_reward.tier_configs[1].reward_percentage = customConfig.task_l2_percentage;
      }
    }
    
    // Apply new-style config
    if (customConfig.enabled !== undefined) {
      this.config.enabled = customConfig.enabled;
    }
    
    if (customConfig.max_tier_depth !== undefined) {
      this.config.max_tier_depth = customConfig.max_tier_depth;
    }
    
    if (customConfig.referral_code_length !== undefined) {
      this.config.referral_code_length = customConfig.referral_code_length;
    }
    
    if (customConfig.installation_reward) {
      this.config.installation_reward = {
        ...this.config.installation_reward,
        ...customConfig.installation_reward
      };
    }
    
    if (customConfig.uptime_reward) {
      this.config.uptime_reward = {
        ...this.config.uptime_reward,
        ...customConfig.uptime_reward
      };
    }
    
    if (customConfig.task_reward) {
      this.config.task_reward = {
        ...this.config.task_reward,
        ...customConfig.task_reward
      };
    }
  }

  /**
   * Get full configuration
   */
  getConfig(): ReferralConfig {
    return { ...this.config };
  }

  /**
   * Get reward config by type
   */
  getRewardConfig(type: ReferralRewardType): RewardTypeConfig | undefined {
    switch (type) {
      case ReferralRewardType.INSTALLATION:
        return this.config.installation_reward;
      case ReferralRewardType.UPTIME:
        return this.config.uptime_reward;
      case ReferralRewardType.TASK:
        return this.config.task_reward;
      default:
        return undefined;
    }
  }

  /**
   * Get tier config for a specific reward type and tier level
   */
  getTierConfig(type: ReferralRewardType, tierLevel: number): TierRewardConfig | undefined {
    const rewardConfig = this.getRewardConfig(type);
    if (!rewardConfig) return undefined;
    
    return rewardConfig.tier_configs.find(tc => tc.tier_level === tierLevel);
  }

  /**
   * Get all enabled tiers for a reward type
   */
  getEnabledTiers(type: ReferralRewardType): TierRewardConfig[] {
    const rewardConfig = this.getRewardConfig(type);
    if (!rewardConfig || !rewardConfig.enabled) return [];
    
    return rewardConfig.tier_configs.filter(tc => tc.enabled);
  }

  /**
   * Get max tier depth
   */
  getMaxTierDepth(): number {
    return this.config.max_tier_depth;
  }

  /**
   * Check if a reward type is enabled
   */
  isRewardTypeEnabled(type: ReferralRewardType): boolean {
    const rewardConfig = this.getRewardConfig(type);
    return rewardConfig ? rewardConfig.enabled : false;
  }

  /**
   * Check if a specific tier is enabled for a reward type
   */
  isTierEnabled(type: ReferralRewardType, tierLevel: number): boolean {
    const tierConfig = this.getTierConfig(type, tierLevel);
    return tierConfig ? tierConfig.enabled : false;
  }

  /**
   * Get distribution cycle for a reward type
   */
  getDistributionCycle(type: ReferralRewardType): DistributionCycle | undefined {
    const rewardConfig = this.getRewardConfig(type);
    return rewardConfig?.distribution_cycle;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<ReferralConfig>): void {
    this.applyCustomConfig(updates);
  }

  /**
   * Add a new tier to a reward type (for future expansion)
   */
  addTier(type: ReferralRewardType, tierConfig: TierRewardConfig): void {
    const rewardConfig = this.getRewardConfig(type);
    if (!rewardConfig) {
      throw new Error(`Reward type ${type} not found`);
    }
    
    // Check if tier already exists
    const existingIndex = rewardConfig.tier_configs.findIndex(
      tc => tc.tier_level === tierConfig.tier_level
    );
    
    if (existingIndex >= 0) {
      // Update existing tier
      rewardConfig.tier_configs[existingIndex] = tierConfig;
    } else {
      // Add new tier
      rewardConfig.tier_configs.push(tierConfig);
      // Sort by tier level
      rewardConfig.tier_configs.sort((a, b) => a.tier_level - b.tier_level);
    }
    
    console.log(`✅ Tier ${tierConfig.tier_level} ${existingIndex >= 0 ? 'updated' : 'added'} for ${type} rewards`);
  }

  /**
   * Remove a tier from a reward type
   */
  removeTier(type: ReferralRewardType, tierLevel: number): void {
    const rewardConfig = this.getRewardConfig(type);
    if (!rewardConfig) {
      throw new Error(`Reward type ${type} not found`);
    }
    
    rewardConfig.tier_configs = rewardConfig.tier_configs.filter(
      tc => tc.tier_level !== tierLevel
    );
    
    console.log(`✅ Tier ${tierLevel} removed from ${type} rewards`);
  }

  /**
   * Enable/disable a specific tier
   */
  setTierEnabled(type: ReferralRewardType, tierLevel: number, enabled: boolean): void {
    const tierConfig = this.getTierConfig(type, tierLevel);
    if (tierConfig) {
      tierConfig.enabled = enabled;
      console.log(`✅ Tier ${tierLevel} ${enabled ? 'enabled' : 'disabled'} for ${type} rewards`);
    }
  }

  /**
   * Get installation reward amount (for legacy compatibility)
   */
  getInstallationRewardAmount(): number {
    return 500; // Fixed amount
  }

  /**
   * Export configuration as JSON
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from JSON
   */
  importConfig(jsonConfig: string): void {
    try {
      const parsed = JSON.parse(jsonConfig);
      this.config = parsed;
      console.log(`✅ Configuration imported successfully`);
    } catch (error) {
      console.error(`❌ Failed to import configuration:`, error);
      throw new Error(`Invalid configuration JSON: ${error}`);
    }
  }
}


