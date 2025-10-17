import { Router } from 'express';
import { Database } from '../../db/database';
import { ReferralDistributionService } from '../../services/referral_distribution_service';
import { ApiResponse } from '../utils/response';

export function createReferralDistributionRouter(
  database: Database,
  referralDistributionService: ReferralDistributionService
): Router {
  const router = Router();

  /**
   * @swagger
   * /api/referral-distribution/status:
   *   get:
   *     summary: Get referral distribution service status
   *     tags: [Referral Distribution]
   *     responses:
   *       200:
   *         description: Service status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     isRunning:
   *                       type: boolean
   *                     activeJobs:
   *                       type: array
   *                       items:
   *                         type: string
   */
  router.get('/status', async (req, res) => {
    try {
      const status = referralDistributionService.getStatus();
      
      return ApiResponse.success(res, status, 'Referral distribution service status retrieved');
    } catch (error) {
      console.error('Error getting referral distribution status:', error);
      return ApiResponse.error(res, 'Failed to get service status', 500);
    }
  });

  /**
   * @swagger
   * /api/referral-distribution/trigger/weekly-uptime:
   *   post:
   *     summary: Manually trigger weekly uptime distribution
   *     tags: [Referral Distribution]
   *     responses:
   *       200:
   *         description: Weekly uptime distribution triggered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     distribution_id:
   *                       type: string
   *                     distribution_type:
   *                       type: string
   *                     processed_count:
   *                       type: number
   *                     total_rewards_distributed:
   *                       type: number
   *                     errors:
   *                       type: array
   *                       items:
   *                         type: string
   *                     timestamp:
   *                       type: number
   */
  router.post('/trigger/weekly-uptime', async (req, res) => {
    try {
      console.log('🔄 Manual trigger: Weekly uptime distribution');
      
      const result = await referralDistributionService.triggerWeeklyUptimeDistribution();
      
      return ApiResponse.success(res, result, 'Weekly uptime distribution completed');
    } catch (error) {
      console.error('Error triggering weekly uptime distribution:', error);
      return ApiResponse.error(res, 'Failed to trigger weekly uptime distribution', 500);
    }
  });

  /**
   * @swagger
   * /api/referral-distribution/trigger/daily-task:
   *   post:
   *     summary: Manually trigger daily task distribution
   *     tags: [Referral Distribution]
   *     responses:
   *       200:
   *         description: Daily task distribution triggered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     distribution_id:
   *                       type: string
   *                     distribution_type:
   *                       type: string
   *                     processed_count:
   *                       type: number
   *                     total_rewards_distributed:
   *                       type: number
   *                     errors:
   *                       type: array
   *                       items:
   *                         type: string
   *                     timestamp:
   *                       type: number
   */
  router.post('/trigger/daily-task', async (req, res) => {
    try {
      console.log('🔄 Manual trigger: Daily task distribution');
      
      const result = await referralDistributionService.triggerDailyTaskDistribution();
      
      return ApiResponse.success(res, result, 'Daily task distribution completed');
    } catch (error) {
      console.error('Error triggering daily task distribution:', error);
      return ApiResponse.error(res, 'Failed to trigger daily task distribution', 500);
    }
  });

  /**
   * @swagger
   * /api/referral-distribution/trigger/monthly-cap-reset:
   *   post:
   *     summary: Manually trigger monthly cap reset
   *     tags: [Referral Distribution]
   *     responses:
   *       200:
   *         description: Monthly cap reset triggered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     distribution_id:
   *                       type: string
   *                     distribution_type:
   *                       type: string
   *                     processed_count:
   *                       type: number
   *                     total_rewards_distributed:
   *                       type: number
   *                     errors:
   *                       type: array
   *                       items:
   *                         type: string
   *                     timestamp:
   *                       type: number
   */
  router.post('/trigger/monthly-cap-reset', async (req, res) => {
    try {
      console.log('🔄 Manual trigger: Monthly cap reset');
      
      const result = await referralDistributionService.triggerMonthlyCapReset();
      
      return ApiResponse.success(res, result, 'Monthly cap reset completed');
    } catch (error) {
      console.error('Error triggering monthly cap reset:', error);
      return ApiResponse.error(res, 'Failed to trigger monthly cap reset', 500);
    }
  });

  /**
   * @swagger
   * /api/referral-distribution/logs:
   *   get:
   *     summary: Get referral distribution logs
   *     tags: [Referral Distribution]
   *     parameters:
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *         description: Date to get logs for (YYYY-MM-DD), defaults to today
   *       - in: query
   *         name: lines
   *         schema:
   *           type: integer
   *           default: 100
   *         description: Number of lines to return
   *     responses:
   *       200:
   *         description: Logs retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     logs:
   *                       type: array
   *                       items:
   *                         type: string
   *                     totalLines:
   *                       type: number
   *                     filePath:
   *                       type: string
   */
  router.get('/logs', async (req, res) => {
    try {
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      const lines = parseInt(req.query.lines as string) || 100;
      
      const fs = require('fs');
      const path = require('path');
      
      const logFile = `./logs/referral-distribution/referral-distribution-${date}.log`;
      
      if (!fs.existsSync(logFile)) {
        return ApiResponse.success(res, {
          logs: [],
          totalLines: 0,
          filePath: logFile
        }, 'No logs found for the specified date');
      }
      
      const logContent = fs.readFileSync(logFile, 'utf8');
      const logLines = logContent.split('\n').filter((line: string) => line.trim());
      const recentLines = logLines.slice(-lines);
      
      return ApiResponse.success(res, {
        logs: recentLines,
        totalLines: logLines.length,
        filePath: logFile
      }, 'Logs retrieved successfully');
    } catch (error) {
      console.error('Error getting referral distribution logs:', error);
      return ApiResponse.error(res, 'Failed to get logs', 500);
    }
  });

  return router;
}
