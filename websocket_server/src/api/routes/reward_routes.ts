import { Router, Request, Response } from 'express';
import { RewardDistributionService } from '../../services/reward_distribution_service';
import { Database } from '../../db/database';
import { REDIS_KEYS } from '../../db/types';
import { rewardAuthMiddleware } from '../middleware/auth';

interface HybridServerLike {
  getRewardDistributionService(): RewardDistributionService;
  getDatabase(): Database;
}

export function createRewardRoutes(hybridServer: HybridServerLike): Router {
  const router = Router();
  
  // Apply authentication middleware to all reward routes
  router.use(rewardAuthMiddleware);

  /**
   * Get reward distribution service status
   */
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const rewardService = hybridServer.getRewardDistributionService();
      const status = rewardService.getStatus();
      
      return res.json({
        success: true,
        data: {
          isRunning: status.isRunning,
          config: {
            enabled: status.config.reward_distribution_enabled,
            interval: status.config.reward_distribution_interval,
            minDailyReward: status.config.daily_min_reward,
            maxDailyReward: status.config.daily_max_reward,
            maxDailyRewardWithBonus: status.config.daily_max_reward_with_bonus,
            maxWeeklyReward: status.config.weekly_max_reward,
            baseRewardRate: status.config.base_reward_rate,
            performanceTiers: status.config.performance_tiers
          },
          currentLogFile: status.currentLogFile
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to get status: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  /**
   * Manually trigger reward distribution
   */
  router.post('/trigger', async (req: Request, res: Response) => {
    try {
      const rewardService = hybridServer.getRewardDistributionService();
      const result = await rewardService.triggerManualDistribution();
      
      if (result.success) {
        return res.json({
          success: true,
          data: {
            distributionId: result.data.distribution_id,
            status: result.data.status,
            totalUsers: result.data.total_users,
            totalRewardsDistributed: result.data.total_rewards_distributed,
            startedAt: new Date(result.data.started_at).toISOString(),
            completedAt: result.data.completed_at ? new Date(result.data.completed_at).toISOString() : null
          }
        });
      } else {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to trigger distribution: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  /**
   * Get recent distribution history
   */
  router.get('/history', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const database = hybridServer.getDatabase();
      const redisClient = database.getRedisClient();
      
      // Get all distribution keys
      const pattern = `${REDIS_KEYS.UPTIME.DISTRIBUTION}*`;
      const keys = await redisClient.keys(pattern);
      
      // Sort by timestamp (newest first)
      const sortedKeys = keys.sort((a, b) => {
        const aId = a.split(':').pop() || '';
        const bId = b.split(':').pop() || '';
        return bId.localeCompare(aId);
      });
      
      // Get distribution records
      const distributions = [];
      const startIndex = offset;
      const endIndex = Math.min(startIndex + limit, sortedKeys.length);
      
      for (let i = startIndex; i < endIndex; i++) {
        const key = sortedKeys[i];
        const data = await database.getFileMetadata(key);
        if (data) {
          const distribution = JSON.parse(data);
          distributions.push({
            distributionId: distribution.distribution_id,
            distributionDate: distribution.distribution_date,
            distributionType: distribution.distribution_type,
            status: distribution.status,
            totalUsers: distribution.total_users,
            totalRewardsDistributed: distribution.total_rewards_distributed,
            startedAt: new Date(distribution.started_at).toISOString(),
            completedAt: distribution.completed_at ? new Date(distribution.completed_at).toISOString() : null,
            errorDetails: distribution.error_details
          });
        }
      }
      
      return res.json({
        success: true,
        data: {
          distributions,
          pagination: {
            total: sortedKeys.length,
            limit,
            offset,
            hasMore: endIndex < sortedKeys.length
          }
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to get distribution history: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  /**
   * Get distribution details by ID
   */
  router.get('/distribution/:distributionId', async (req: Request, res: Response) => {
    try {
      const { distributionId } = req.params;
      const database = hybridServer.getDatabase();
      
      const key = `${REDIS_KEYS.UPTIME.DISTRIBUTION}${distributionId}`;
      const data = await database.getFileMetadata(key);
      
      if (!data) {
        return res.status(404).json({
          success: false,
          error: { type: 'NotFound', message: 'Distribution not found' }
        });
      }
      
      const distribution = JSON.parse(data);
      
      // Get transactions for this distribution
      const transactionPattern = `${REDIS_KEYS.UPTIME.TRANSACTION}*`;
      const transactionKeys = await database.getRedisClient().keys(transactionPattern);
      
      const transactions = [];
      for (const txKey of transactionKeys) {
        const txData = await database.getFileMetadata(txKey);
        if (txData) {
          const transaction = JSON.parse(txData);
          if (transaction.distribution_id === distributionId) {
            transactions.push({
              transactionId: transaction.transaction_id,
              userPrincipalId: transaction.user_principal_id,
              amount: transaction.amount,
              baseAmount: transaction.base_amount,
              bonusAmount: transaction.bonus_amount,
              uptimeMinutes: transaction.uptime_minutes,
              tierLevel: transaction.tier_level,
              status: transaction.status,
              blockchainTxHash: transaction.blockchain_tx_hash,
              timestamp: new Date(transaction.timestamp).toISOString()
            });
          }
        }
      }
      
      return res.json({
        success: true,
        data: {
          distribution: {
            distributionId: distribution.distribution_id,
            distributionDate: distribution.distribution_date,
            distributionType: distribution.distribution_type,
            status: distribution.status,
            totalUsers: distribution.total_users,
            totalRewardsDistributed: distribution.total_rewards_distributed,
            startedAt: new Date(distribution.started_at).toISOString(),
            completedAt: distribution.completed_at ? new Date(distribution.completed_at).toISOString() : null,
            errorDetails: distribution.error_details
          },
          transactions
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to get distribution details: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  /**
   * Get user's reward history
   */
  router.get('/user/:userPrincipalId/history', async (req: Request, res: Response) => {
    try {
      const { userPrincipalId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const database = hybridServer.getDatabase();
      
      // Get all transaction keys
      const transactionPattern = `${REDIS_KEYS.UPTIME.TRANSACTION}*`;
      const transactionKeys = await database.getRedisClient().keys(transactionPattern);
      
      // Filter transactions for this user
      const userTransactions = [];
      for (const txKey of transactionKeys) {
        const txData = await database.getFileMetadata(txKey);
        if (txData) {
          const transaction = JSON.parse(txData);
          if (transaction.user_principal_id === userPrincipalId) {
            userTransactions.push({
              transactionId: transaction.transaction_id,
              distributionId: transaction.distribution_id,
              amount: transaction.amount,
              baseAmount: transaction.base_amount,
              bonusAmount: transaction.bonus_amount,
              uptimeMinutes: transaction.uptime_minutes,
              tierLevel: transaction.tier_level,
              status: transaction.status,
              blockchainTxHash: transaction.blockchain_tx_hash,
              date: transaction.date,
              timestamp: new Date(transaction.timestamp).toISOString()
            });
          }
        }
      }
      
      // Sort by timestamp (newest first)
      userTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      // Apply pagination
      const startIndex = offset;
      const endIndex = Math.min(startIndex + limit, userTransactions.length);
      const paginatedTransactions = userTransactions.slice(startIndex, endIndex);
      
      return res.json({
        success: true,
        data: {
          userPrincipalId,
          transactions: paginatedTransactions,
          pagination: {
            total: userTransactions.length,
            limit,
            offset,
            hasMore: endIndex < userTransactions.length
          }
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to get user reward history: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  /**
   * Get unprocessed daily records count
   */
  router.get('/unprocessed-count', async (req: Request, res: Response) => {
    try {
      const database = hybridServer.getDatabase();
      
      // Get all daily records
      const pattern = `${REDIS_KEYS.UPTIME.DAILY}*`;
      const keys = await database.getRedisClient().keys(pattern);
      
      let unprocessedCount = 0;
      let totalRecords = 0;
      
      for (const key of keys) {
        const data = await database.getFileMetadata(key);
        if (data) {
          const record = JSON.parse(data);
          totalRecords++;
          if (!record.is_processed && record.total_minutes > 0) {
            unprocessedCount++;
          }
        }
      }
      
      return res.json({
        success: true,
        data: {
          unprocessedCount,
          totalRecords,
          processedCount: totalRecords - unprocessedCount
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to get unprocessed count: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  /**
   * Get log file content (last N lines)
   */
  router.get('/logs', async (req: Request, res: Response) => {
    try {
      const lines = parseInt(req.query.lines as string) || 100;
      const rewardService = hybridServer.getRewardDistributionService();
      const status = rewardService.getStatus();
      
      if (!status.currentLogFile) {
        return res.status(404).json({
          success: false,
          error: { type: 'NotFound', message: 'No log file available' }
        });
      }
      
      // Read last N lines from log file
      const fs = require('fs');
      const logContent = fs.readFileSync(status.currentLogFile, 'utf8');
      const logLines = logContent.split('\n').filter((line: string) => line.trim());
      const lastLines = logLines.slice(-lines);
      
      return res.json({
        success: true,
        data: {
          logFile: status.currentLogFile,
          lines: lastLines,
          totalLines: logLines.length
        }
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { type: 'ServerError', message: `Failed to read logs: ${error instanceof Error ? error.message : String(error)}` }
      });
    }
  });

  return router;
}
