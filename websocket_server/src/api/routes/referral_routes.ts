import { Router, Request, Response } from 'express';
import { Database } from '../../db/database';
import { ReferralService } from '../../services/referral_service';
import { ApiResponse } from '../utils/response';
import { authMiddleware } from '../middleware/auth';

export function createReferralRouter(db: Database, referralService: ReferralService): Router {
  const router = Router();

  /**
   * @route POST /api/referral/validate-code
   * @description Validate if a referral code exists and is valid
   * @access Public
   */
  router.post('/validate', async (req: Request, res: Response) => {
    try {
      const { referral_code } = req.body;

      if (!referral_code) {
        return ApiResponse.validationError(res, 'Referral code is required', {
          field: 'referral_code',
          message: 'This field is required'
        });
      }

      if (typeof referral_code !== 'string' || referral_code.trim().length === 0) {
        return ApiResponse.validationError(res, 'Invalid referral code format', {
          field: 'referral_code',
          message: 'Must be a non-empty string'
        });
      }

      const result = await referralService.validateReferralCode(referral_code.trim().toUpperCase());

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400);
      }

      if (!result.data.valid) {
        return ApiResponse.validationError(res, result.data.message, {
          field: 'referral_code',
          valid: false
        });
      }

      return ApiResponse.success(res, {
        valid: true,
        referrer_principal_id: result.data.referrer_principal_id,
        message: result.data.message
      }, 'Referral code is valid');

    } catch (error) {
      console.error('❌ Error validating referral code:', error);
      return ApiResponse.internalError(res, 'Failed to validate referral code');
    }
  });

  /**
   * @route POST /api/referral/register
   * @description Register a new user with a referral code
   * @access Protected
   */
  router.post('/register', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { referral_code } = req.body;

      if (!referral_code) {
        return ApiResponse.validationError(res, 'Referral code is required', {
          field: 'referral_code',
          message: 'This field is required'
        });
      }

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      // Check if referral system is enabled
      if (!referralService.isEnabled()) {
        return ApiResponse.error(res, 'Referral system is currently disabled', 503);
      }

      const result = await referralService.registerWithReferralCode(
        userPrincipalId,
        referral_code.trim().toUpperCase()
      );

      if (!result.success) {
        if (result.error.type === 'InvalidInput') {
          return ApiResponse.validationError(res, result.error.message);
        } else if (result.error.type === 'AlreadyExists') {
          return ApiResponse.conflict(res, result.error.message);
        } else {
          return ApiResponse.error(res, result.error.message, 400);
        }
      }

      return ApiResponse.created(res, {
        relationship: {
          user_principal_id: result.data.user_principal_id,
          referrer_chain: result.data.referrer_chain,
          referrer_l1: result.data.referrer_l1_principal_id,
          referrer_l2: result.data.referrer_l2_principal_id,
          referral_code_used: result.data.referral_code_used,
          signup_timestamp: result.data.signup_timestamp,
          status_24h: result.data.first_24h_status
        }
      }, 'Successfully registered with referral code');

    } catch (error) {
      console.error('❌ Error registering with referral code:', error);
      return ApiResponse.internalError(res, 'Failed to register with referral code');
    }
  });

  /**
   * @route GET /api/referral/dashboard
   * @description Get comprehensive referral dashboard for a user
   * @access Protected
   */
  router.get('/dashboard', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId;

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      const result = await referralService.getReferralDashboard(userPrincipalId);

      if (!result.success) {
        if (result.error.type === 'NotFound') {
          return ApiResponse.notFound(res, result.error.message);
        }
        return ApiResponse.error(res, result.error.message, 400);
      }

      return ApiResponse.success(res, result.data, 'Referral dashboard retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting referral dashboard:', error);
      return ApiResponse.internalError(res, 'Failed to get referral dashboard');
    }
  });

  /**
   * @route GET /api/referral/stats
   * @description Get simplified referral statistics for a user including pending/qualified referrals and reward totals
   * @access Protected
   * @returns {Object} stats - Simplified statistics
   * @returns {number} stats.total_referral_rewards - Total rewards earned from all referrals
   * @returns {number} stats.this_week_referral_rewards - Rewards earned this week
   * @returns {number} stats.total_referrals - Total number of referrals (L1 + L2)
   * @returns {number} stats.pending_referrals - Number of referrals pending 24h completion (L1 + L2)
   * @returns {number} stats.qualified_referrals - Number of referrals who completed 24h (L1 + L2)
   * @returns {number} stats.l1_referral_rewards - Rewards earned from L1 referrals only
   */
  router.get('/stats', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId;

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      const result = await referralService.getReferralStats(userPrincipalId);

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400);
      }

      const stats = result.data;

      // Return only the requested fields
      const simplifiedStats = {
        total_referral_rewards: stats.total_referral_rewards,
        this_week_referral_rewards: stats.this_week_referral_rewards,
        total_referrals: stats.l1_total_referrals + stats.l2_total_referrals,
        pending_referrals: stats.pending_referrals,
        qualified_referrals: stats.qualified_referrals,
        l1_referral_rewards: stats.l1_total_earned
      };

      return ApiResponse.success(res, simplifiedStats, 'Referral stats retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting referral stats:', error);
      return ApiResponse.internalError(res, 'Failed to get referral stats');
    }
  });

  /**
   * @route GET /api/referral/tree
   * @description Get referral tree (L1 and L2 referrals) for a user
   * @access Protected
   */
  router.get('/tree', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId;

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      // Get L1 referrals
      const l1Result = await referralService.getL1Referrals(userPrincipalId);
      if (!l1Result.success) {
        return ApiResponse.error(res, 'Failed to get L1 referrals', 400);
      }

      // Get L2 referrals
      const l2Result = await referralService.getL2Referrals(userPrincipalId);
      if (!l2Result.success) {
        return ApiResponse.error(res, 'Failed to get L2 referrals', 400);
      }

      // Get detailed info for L1 referrals
      const l1Details = [];
      for (const refereePrincipalId of l1Result.data) {
        const clientResult = await db.getClient(refereePrincipalId);
        const relationshipResult = await referralService.getReferralRelationship(refereePrincipalId);
        
        if (clientResult.success && relationshipResult.success && relationshipResult.data) {
          l1Details.push({
            user_principal_id: refereePrincipalId,
            signup_timestamp: relationshipResult.data.signup_timestamp,
            status_24h: relationshipResult.data.first_24h_status,
            is_online: clientResult.data.wsDisconnect === 0,
            client_status: clientResult.data.clientStatus,
            total_uptime: clientResult.data.totalUptime,
            balance: clientResult.data.balance
          });
        }
      }

      // Get detailed info for L2 referrals
      const l2Details = [];
      for (const refereePrincipalId of l2Result.data) {
        const clientResult = await db.getClient(refereePrincipalId);
        const relationshipResult = await referralService.getReferralRelationship(refereePrincipalId);
        
        if (clientResult.success && relationshipResult.success && relationshipResult.data) {
          l2Details.push({
            user_principal_id: refereePrincipalId,
            signup_timestamp: relationshipResult.data.signup_timestamp,
            referred_by_l1: relationshipResult.data.referrer_l1_principal_id,
            status_24h: relationshipResult.data.first_24h_status,
            is_online: clientResult.data.wsDisconnect === 0,
            client_status: clientResult.data.clientStatus
          });
        }
      }

      return ApiResponse.success(res, {
        l1_referrals: {
          count: l1Result.data.length,
          referrals: l1Details
        },
        l2_referrals: {
          count: l2Result.data.length,
          referrals: l2Details
        }
      }, 'Referral tree retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting referral tree:', error);
      return ApiResponse.internalError(res, 'Failed to get referral tree');
    }
  });

  /**
   * @route GET /api/referral/rewards
   * @description Get reward history for a user
   * @access Protected
   */
  router.get('/rewards', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId;
      const { page = 1, limit = 20, type, tier } = req.query;

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);

      if (isNaN(pageNum) || pageNum < 1) {
        return ApiResponse.validationError(res, 'Invalid page number', {
          field: 'page',
          message: 'Must be a positive integer'
        });
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return ApiResponse.validationError(res, 'Invalid limit', {
          field: 'limit',
          message: 'Must be between 1 and 100'
        });
      }

      const result = await referralService.getReferralRewards(userPrincipalId);

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400);
      }

      let rewards = result.data;

      // Filter by type if specified
      if (type) {
        rewards = rewards.filter(r => r.reward_type === type);
      }

      // Filter by tier if specified
      if (tier) {
        const tierNum = parseInt(tier as string);
        rewards = rewards.filter(r => r.tier === tierNum);
      }

      // Calculate pagination
      const totalItems = rewards.length;
      const totalPages = Math.ceil(totalItems / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;
      const paginatedRewards = rewards.slice(startIndex, endIndex);

      // Calculate summary
      const summary = {
        total_rewards: rewards.length,
        total_amount: rewards.filter(r => r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
        by_type: {
          installation: rewards.filter(r => r.reward_type === 'INSTALLATION' && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
          uptime: rewards.filter(r => r.reward_type === 'UPTIME' && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
          task: rewards.filter(r => r.reward_type === 'TASK' && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0)
        },
        by_tier: {
          l1: rewards.filter(r => r.tier === 1 && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0),
          l2: rewards.filter(r => r.tier === 2 && r.status === 'DISTRIBUTED').reduce((sum, r) => sum + r.reward_amount, 0)
        }
      };

      return ApiResponse.success(res, {
        rewards: paginatedRewards,
        pagination: {
          current_page: pageNum,
          total_pages: totalPages,
          total_items: totalItems,
          items_per_page: limitNum,
          has_next_page: pageNum < totalPages,
          has_prev_page: pageNum > 1
        },
        summary
      }, 'Reward history retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting reward history:', error);
      return ApiResponse.internalError(res, 'Failed to get reward history');
    }
  });

  /**
   * @route GET /api/referral/relationship
   * @description Get referral relationship for a user (who referred them)
   * @access Protected
   */
  router.get('/relationship', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId;

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      const result = await referralService.getReferralRelationship(userPrincipalId);

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400);
      }

      if (!result.data) {
        return ApiResponse.success(res, null, 'User was not referred by anyone');
      }

      return ApiResponse.success(res, {
        user_principal_id: result.data.user_principal_id,
        referrer_l1: result.data.referrer_l1_principal_id,
        referrer_l2: result.data.referrer_l2_principal_id,
        referral_code_used: result.data.referral_code_used,
        signup_timestamp: result.data.signup_timestamp,
        status_24h: result.data.first_24h_status,
        first_24h_completed_at: result.data.first_24h_completed_at,
        installation_reward_claimed: result.data.installation_reward_claimed
      }, 'Referral relationship retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting referral relationship:', error);
      return ApiResponse.internalError(res, 'Failed to get referral relationship');
    }
  });

  /**
   * @route GET /api/referral/status
   * @description Get user's referral registration status and details
   * @access Protected
   */
  router.get('/status', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId;

      if (!userPrincipalId) {
        return ApiResponse.unauthorized(res, 'User principal ID not found in request');
      }

      const result = await referralService.getReferralRelationship(userPrincipalId);

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400);
      }

      if (!result.data) {
        return ApiResponse.success(res, {
          registered: false,
          message: 'User is not registered with any referral code'
        }, 'User registration status retrieved successfully');
      }

      const relationship = result.data;
      
      return ApiResponse.success(res, {
        registered: true,
        relationship: {
          user_principal_id: relationship.user_principal_id,
          referrer_chain: relationship.referrer_chain,
          referrer_l1: relationship.referrer_l1_principal_id,
          referrer_l2: relationship.referrer_l2_principal_id,
          referral_code_used: relationship.referral_code_used,
          signup_timestamp: relationship.signup_timestamp,
          status_24h: relationship.first_24h_status,
          first_24h_completed_at: relationship.first_24h_completed_at,
          installation_reward_claimed: relationship.installation_reward_claimed
        },
        message: 'User is registered with a referral code'
      }, 'User registration status retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting referral status:', error);
      return ApiResponse.internalError(res, 'Failed to get referral status');
    }
  });

  /**
   * @route GET /api/referral/config
   * @description Get referral system configuration
   * @access Public
   */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const config = referralService.getConfig();

      return ApiResponse.success(res, {
        installation_reward_points: config.installation_reward_points,
        installation_required_uptime_hours: config.installation_required_uptime_hours,
        uptime_l1_percentage: config.uptime_l1_percentage,
        uptime_l2_percentage: config.uptime_l2_percentage,
        uptime_required_weekly_hours: config.uptime_required_weekly_hours,
        uptime_monthly_cap_per_referrer: config.uptime_monthly_cap_per_referrer,
        task_l1_percentage: config.task_l1_percentage,
        task_l2_percentage: config.task_l2_percentage,
        enabled: config.enabled,
        max_tier_depth: config.max_tier_depth
      }, 'Referral configuration retrieved successfully');

    } catch (error) {
      console.error('❌ Error getting referral config:', error);
      return ApiResponse.internalError(res, 'Failed to get referral configuration');
    }
  });

  return router;
}

