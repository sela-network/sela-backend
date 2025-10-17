import { Router, Request, Response } from 'express';
import { NodeService } from '../../services/node_service';
import { UptimeTracker } from '../../services/uptime_tracker';
import { NodeWebSocketHandler } from '../../handlers/node_websocket_handler';
import { authMiddleware } from '../middleware';
import { ApiResponse } from '../utils';
import { REDIS_KEYS } from '../../db/types';

// We need access to the hybrid server for client session management
interface HybridServerLike {
  sendJobToClient(clientId: string, userPrincipalId: string, url: string, scrapeType: string, jobId?: string): Promise<{ success: boolean; message?: string; error?: string }>;
  broadcastToClients(message: any): Promise<number>;
  getDatabase(): any;
}

export function createNodeRoutes(nodeService: NodeService, nodeHandler?: NodeWebSocketHandler, hybridServer?: HybridServerLike): Router {
    const router = Router();
  
  // Initialize UptimeTracker
  const uptimeTracker = new UptimeTracker(nodeService.getDatabase().getDatabase());

  // Health check endpoint
  router.get('/health', async (req: Request, res: Response) => {
    try {
      const health = await nodeService.backendHealthCheck();
      return ApiResponse.success(res, { status: health }, 'Node service is healthy');
    } catch (error) {
      console.error('Node service health check failed:', error);
      return ApiResponse.internalError(res, 'Node service health check failed');
    }
  });

  // Get node service statistics
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const stats = nodeService.getStats();
      return ApiResponse.success(res, stats, 'Node service statistics retrieved');
    } catch (error) {
      console.error('Error getting node service stats:', error);
      return ApiResponse.internalError(res, 'Failed to get node service stats');
    }
  });

  // Get all nodes (requires authentication)
  router.get('/nodes', authMiddleware, async (req: Request, res: Response) => {
    try {
      const nodesResult = await nodeService.getAllNodes();
      if (!nodesResult.success) {
        return ApiResponse.error(res, 'Failed to fetch nodes: ' + nodesResult.error.message);
      }

      return ApiResponse.success(res, nodesResult.data, 'All nodes retrieved successfully');
    } catch (error) {
      console.error('Error getting all nodes:', error);
      return ApiResponse.internalError(res, 'Failed to get all nodes');
    }
  });

  // Get running nodes only (requires authentication)
  router.get('/nodes/running', authMiddleware, async (req: Request, res: Response) => {
    try {
      const nodesResult = await nodeService.getAllRunningNodes();
      if (!nodesResult.success) {
        return ApiResponse.error(res, 'Failed to fetch running nodes: ' + nodesResult.error.message);
      }

      return ApiResponse.success(res, nodesResult.data, 'Running nodes retrieved successfully');
    } catch (error) {
      console.error('Error getting running nodes:', error);
      return ApiResponse.internalError(res, 'Failed to get running nodes');
    }
  });

  // Get user data (requires authentication)
  router.get('/user/data', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      
      const loginResult = await nodeService.login(userPrincipalId);
      if (!loginResult.success) {
        return ApiResponse.error(res, 'Failed to fetch user data: ' + loginResult.error.message);
      }

      const userData = loginResult.data;
      
      // Get reward history for additional calculations
      const rewardHistoryResult = await nodeService.getUserRewardHistory(userPrincipalId);
      let totalAccumulativePoints = userData.balance;
      let totalEarnFromLastJob = 0.0;
      let todaysEarnings = userData.todaysEarnings;

      // Calculate today's date range
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

      if (rewardHistoryResult.success) {
        const rewards = rewardHistoryResult.data.rewards;
        const jobRewards = rewards.filter(reward => reward.type === 'job');
        totalAccumulativePoints = rewards.reduce((acc, reward) => acc + reward.amount, 0.0);
        
        const todaysJobEarnings = jobRewards
          .filter(job => job.state === "completed" && job.completeAt &&job.completeAt >= startOfDay && job.completeAt < endOfDay)
          .reduce((acc, job) => acc + job.amount, 0.0);
        
        if (jobRewards.length > 0) {
          const lastJob = jobRewards[jobRewards.length - 1];
          if (lastJob.state === "completed") {
            totalEarnFromLastJob = lastJob.amount;
          }
        }

        // Get today's uptime rewards from distributed transactions
        let todaysUptimeEarnings = 0.0;
        if (hybridServer) {
          const database = hybridServer.getDatabase();
          const transactionPattern = `${REDIS_KEYS.UPTIME.TRANSACTION}*`;
          const transactionKeys = await database.getRedisClient().keys(transactionPattern);
          
          for (const txKey of transactionKeys) {
            const txData = await database.getFileMetadata(txKey);
            if (txData) {
              const transaction = JSON.parse(txData);
              
              // Check if this transaction is for today and this user and is confirmed
              if (transaction.user_principal_id === userPrincipalId && 
                  transaction.status === 'CONFIRMED' &&
                  transaction.timestamp >= startOfDay && 
                  transaction.timestamp < endOfDay) {
                todaysUptimeEarnings += transaction.amount;
              }
            }
          }
        }

        // Combine job and uptime earnings for today's total
        todaysEarnings = todaysJobEarnings + todaysUptimeEarnings;
      }

      // Get real-time active session rewards if user is online
      const activeSessionRewardsResult = await uptimeTracker.calculateActiveSessionRewards(userPrincipalId);
      let activeSessionRewards = 0.0;
      let currentSessionMinutes = 0;
      let isCurrentlyOnline = false;
      
      if (activeSessionRewardsResult.success && activeSessionRewardsResult.data.isOnline) {
        activeSessionRewards = activeSessionRewardsResult.data.totalReward;
        currentSessionMinutes = activeSessionRewardsResult.data.activeSessionMinutes;
        isCurrentlyOnline = true;
        
        // Add active session rewards to today's earnings and total accumulative points
        todaysEarnings += activeSessionRewards;
        totalAccumulativePoints += activeSessionRewards;
        
        console.log(`✅ Added active session rewards for user ${userPrincipalId}: ${activeSessionRewards.toFixed(4)} points (${currentSessionMinutes.toFixed(2)} minutes)`);
      }

      // Calculate real-time balance including active session rewards
      const realTimeBalance = userData.balance + activeSessionRewards;

      // ✅ Check if client has active jobs using new structure
      const activeJobs = userData.activeJobs || [];
      const hasActiveJobs = activeJobs.length > 0;
      const clientState = hasActiveJobs ? "working" : "waiting";

      const responseData = {
        function: "Get Data",
        message: "Getting client data",
        user_principal_id: userData.user_principal_id,
        balance: realTimeBalance.toString(),
        todaysEarnings: todaysEarnings.toString(),
        totalAccumulativePoints: totalAccumulativePoints.toString(),
        totalEarnFromLastJob: totalEarnFromLastJob.toString(),
        referralCode: userData.referralCode,
        totalReferral: userData.totalReferral.toString(),
        state: clientState,
        status: "OK",
        jobAssigned: hasActiveJobs,
        activeJobsCount: activeJobs.length,
        maxConcurrentJobs: userData.maxConcurrentJobs || 10,
        activeSessionRewards: activeSessionRewards.toString(),
        activeSessionMinutes: currentSessionMinutes.toFixed(2),
        isCurrentlyOnline: isCurrentlyOnline
      };

      return ApiResponse.success(res, responseData, 'User data retrieved successfully');
    } catch (error) {
      console.error('Error getting user data:', error);
      return ApiResponse.internalError(res, 'Failed to get user data');
    }
  });

  // Get uptime stats (requires authentication)
  router.get('/user/uptime', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      
      // Format uptime values from minutes to readable format with seconds
      const formatUptime = (minutes: number): string => {
        if (minutes <= 0) return "00:00:00";
        const totalSeconds = Math.floor(minutes * 60); // Convert minutes to seconds
        const hours = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };

      // Use UptimeTracker service methods for cleaner data retrieval
      const [todayUptimeResult, totalUptimeResult] = await Promise.all([
        uptimeTracker.getUserTodayUptime(userPrincipalId),
        uptimeTracker.getUserTotalUptime(userPrincipalId)
      ]);
      
      if (!todayUptimeResult.success || !totalUptimeResult.success) {
        const error = !todayUptimeResult.success ? (todayUptimeResult as any).error : (totalUptimeResult as any).error;
        console.error('Failed to get uptime data:', error);
        return ApiResponse.internalError(res, 'Failed to retrieve uptime data');
      }
      
      const todayData = todayUptimeResult.data;
      const totalData = totalUptimeResult.data;
      
      // Get real-time active session data from UptimeTracker (single source of truth)
      const activeSessionRewardsResult = await uptimeTracker.calculateActiveSessionRewards(userPrincipalId);
      let isCurrentlyOnline = false;
      let currentSessionMinutes = 0;
      let currentSessionDuration = "00:00:00";
      
      if (activeSessionRewardsResult.success && activeSessionRewardsResult.data.isOnline) {
        isCurrentlyOnline = true;
        currentSessionMinutes = activeSessionRewardsResult.data.activeSessionMinutes;
        currentSessionDuration = formatUptime(currentSessionMinutes);
        console.log(`✅ User is currently online - session duration: ${currentSessionDuration} (${currentSessionMinutes.toFixed(2)} minutes)`);
      } else {
        console.log(`❌ User is offline or session is stale`);
      }
      
      // Calculate total uptime including current session if user is online
      let totalMinutesWithCurrentSession = totalData.total_minutes;
      let activeSessionRewards = 0.0;
      
      if (isCurrentlyOnline && activeSessionRewardsResult.success) {
        totalMinutesWithCurrentSession += currentSessionMinutes;
        activeSessionRewards = activeSessionRewardsResult.data.totalReward;
        console.log(`⏰ Added current session (${currentSessionMinutes.toFixed(2)} min) to total uptime: ${totalMinutesWithCurrentSession.toFixed(2)} min`);
      }
      
      const responseData = {
        totalUptime: formatUptime(totalMinutesWithCurrentSession),
        todayUptime: formatUptime(todayData.total_minutes),
        isCurrentlyOnline,
        currentSessionDuration,
        // Real-time session rewards and minutes (ensure consistency)
        activeSessionRewards: activeSessionRewards.toString(),
        activeSessionMinutes: isCurrentlyOnline ? currentSessionMinutes.toFixed(2) : "0"
      };

      return ApiResponse.success(res, responseData, 'Uptime stats retrieved successfully');
    } catch (error) {
      console.error('Error getting uptime stats:', error);
      return ApiResponse.internalError(res, 'Failed to get uptime stats');
    }
  });

  // Get detailed uptime information (requires authentication)
  router.get('/user/uptime/detailed', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { days = 7 } = req.query; // Default to 7 days
      
      // Use UptimeTracker service methods
      const [todayUptimeResult, totalUptimeResult] = await Promise.all([
        uptimeTracker.getUserTodayUptime(userPrincipalId),
        uptimeTracker.getUserTotalUptime(userPrincipalId)
      ]);
      
      if (!todayUptimeResult.success || !totalUptimeResult.success) {
        const error = !todayUptimeResult.success ? (todayUptimeResult as any).error : (totalUptimeResult as any).error;
        console.error('Failed to get uptime data:', error);
        return ApiResponse.internalError(res, 'Failed to retrieve uptime data');
      }
      
      const todayData = todayUptimeResult.data;
      const totalData = totalUptimeResult.data;
      
      // Get additional detailed data from Redis
      const database = nodeService.getDatabase().getDatabase();
      const redis = database.getRedisClient();
      
      // Get today's date
      const today = new Date().toISOString().split('T')[0];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days as string));
      const startDateStr = startDate.toISOString().split('T')[0];
      
      // Get daily records for the specified period
      const dailyRecords = [];
      for (let d = new Date(startDateStr); d <= new Date(today); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dailyRecordKey = `uptime:daily:${dateStr}:${userPrincipalId}`;
        const dailyRecordData = await redis.get(dailyRecordKey);
        
        if (dailyRecordData) {
          const dailyRecord = JSON.parse(dailyRecordData);
          dailyRecords.push({
            date: dateStr,
            ...dailyRecord
          });
        }
      }
      
      // Get weekly records
      const weeklyIndexKey = `uptime:index:user:${userPrincipalId}`;
      const weeklyRecordIds = await redis.sMembers(weeklyIndexKey);
      const weeklyRecords = [];
      
      for (const recordId of weeklyRecordIds) {
        const weeklyRecordKey = `uptime:weekly:${recordId}`;
        const weeklyRecordData = await redis.get(weeklyRecordKey);
        if (weeklyRecordData) {
          weeklyRecords.push(JSON.parse(weeklyRecordData));
        }
      }
      
      // Get active sessions
      const activeSessionKey = `uptime:active:${userPrincipalId}`;
      const activeSessionData = await redis.get(activeSessionKey);
      let activeSession = null;
      if (activeSessionData) {
        activeSession = JSON.parse(activeSessionData);
      }
      
      // Calculate totals
      const totalMinutes = dailyRecords.reduce((sum, record) => sum + record.total_minutes, 0);
      const totalRewards = dailyRecords.reduce((sum, record) => sum + record.total_reward, 0);
      const avgSpeed = dailyRecords.length > 0 ? 
        dailyRecords.reduce((sum, record) => sum + record.avg_speed, 0) / dailyRecords.length : 0;
      const avgPing = dailyRecords.length > 0 ? 
        dailyRecords.reduce((sum, record) => sum + record.avg_ping, 0) / dailyRecords.length : 0;
      
      // Get performance tiers from UptimeTracker config
      const config = uptimeTracker.getConfig();
      
      const responseData = {
        period: {
          start_date: startDateStr,
          end_date: today,
          days: parseInt(days as string)
        },
        summary: {
          total_minutes: totalMinutes,
          total_rewards: totalRewards,
          avg_daily_minutes: dailyRecords.length > 0 ? totalMinutes / dailyRecords.length : 0,
          avg_speed: avgSpeed,
          avg_ping: avgPing,
          days_active: dailyRecords.length
        },
        daily_records: dailyRecords,
        weekly_records: weeklyRecords,
        active_session: activeSession,
        performance_tiers: config.performance_tiers
      };
      
      return ApiResponse.success(res, responseData, 'Detailed uptime information retrieved successfully');
    } catch (error) {
      console.error('Error getting detailed uptime information:', error);
      return ApiResponse.internalError(res, 'Failed to get detailed uptime information');
    }
  });

  // Get user reward history with pagination (requires authentication)
  router.get('/user/reward-history', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      
      // Parse pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 items per page
      
      const rewardHistoryResult = await nodeService.getUserRewardHistory(userPrincipalId, page, limit);
      if (!rewardHistoryResult.success) {
        return ApiResponse.error(res, 'Failed to fetch reward history: ' + rewardHistoryResult.error.message);
      }

      const { rewards, pagination, summary } = rewardHistoryResult.data;
      
      const responseData = {
        userPrincipalId,
        pagination,
        summary,
        data: {
          rewards
        }
      };
      
      return ApiResponse.success(res, responseData, 'Paginated reward history retrieved successfully');
    } catch (error) {
      console.error('Error getting reward history:', error);
      return ApiResponse.internalError(res, 'Failed to get reward history');
    }
  });

  // Get user reward history grouped by date for bar chart (requires authentication)
  router.get('/user/reward-history/chart', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      
      // Parse date range parameters
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      
      const rewardHistoryResult = await nodeService.getUserRewardHistoryByDate(userPrincipalId, startDate, endDate);
      if (!rewardHistoryResult.success) {
        return ApiResponse.error(res, 'Failed to fetch reward history chart data: ' + rewardHistoryResult.error.message);
      }

      const { dailyRewards, summary } = rewardHistoryResult.data;
      
      const filteredDailyRewards = dailyRewards.map(({ jobCount, ...rest }) => rest);
      
      const responseData = {
        userPrincipalId,
        dateRange: {
          startDate: startDate || (dailyRewards.length > 0 ? dailyRewards[0].date : null),
          endDate: endDate || (dailyRewards.length > 0 ? dailyRewards[dailyRewards.length - 1].date : null)
        },
        summary,
        chartData: filteredDailyRewards
      };
      
      return ApiResponse.success(res, responseData, 'Reward history chart data retrieved successfully');
    } catch (error) {
      console.error('Error getting reward history chart data:', error);
      return ApiResponse.internalError(res, 'Failed to get reward history chart data');
    }
  });

  // Authentication check (requires authentication)
  router.get('/auth/check', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      
      const authResult = await nodeService.handleRequestAuth(userPrincipalId);
      if (!authResult.success) {
        return ApiResponse.unauthorized(res, 'Authentication failed: ' + authResult.error.message);
      }

      return ApiResponse.success(res, { status: "RequestAuth OK" }, 'Authentication successful');
    } catch (error) {
      console.error('Error checking authentication:', error);
      return ApiResponse.internalError(res, 'Failed to check authentication');
    }
  });

  // Add rewards (admin only - requires special authorization)
  router.post('/rewards/add', async (req: Request, res: Response) => {
    try {
      // TODO: Implement admin authorization check
      const { principalId, rewards } = req.body;

      if (!principalId || typeof rewards !== 'number') {
        return ApiResponse.validationError(res, 'Missing or invalid principalId or rewards');
      }

      const addRewardsResult = await nodeService.addRewardsToDB(principalId, rewards);
      if (!addRewardsResult.success) {
        return ApiResponse.error(res, 'Failed to add rewards: ' + addRewardsResult.error.message);
      }

      const responseData = {
        balance: addRewardsResult.data.toString(),
        message: "Rewards added successfully"
      };

      return ApiResponse.success(res, responseData, 'Rewards added successfully');
    } catch (error) {
      console.error('Error adding rewards:', error);
      return ApiResponse.internalError(res, 'Failed to add rewards');
    }
  });

  // Send message to client (admin operation)
  router.post('/client/:clientId/message', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const { userPrincipalId, text, data } = req.body;

      if (!clientId || !userPrincipalId) {
        return ApiResponse.validationError(res, 'Missing clientId or userPrincipalId');
      }

      if (!hybridServer) {
        return ApiResponse.error(res, 'Hybrid server not available');
      }

      // Send notification message to client via hybrid server
      const messageText = text || "NOTIFICATION";
      const messageData = data || "Admin message";

      const messageResult = await hybridServer.sendJobToClient(
        clientId, 
        userPrincipalId, 
        messageData, 
        messageText
      );

      if (!messageResult.success) {
        return ApiResponse.error(res, 'Failed to send message: ' + (messageResult.error || 'Unknown error'));
      }

      return ApiResponse.success(res, { message: messageResult.message }, 'Message sent successfully');
    } catch (error) {
      console.error('Error sending message to client:', error);
      return ApiResponse.internalError(res, 'Failed to send message to client');
    }
  });

  // Broadcast message to all clients
  router.post('/broadcast', async (req: Request, res: Response) => {
    try {
      const { text, data, user_principal_id } = req.body;

      if (!text || !user_principal_id) {
        return ApiResponse.validationError(res, 'Missing required fields: text, user_principal_id');
      }

      if (!hybridServer) {
        return ApiResponse.error(res, 'Hybrid server not available');
      }

      const message = {
        text,
        data: data || '',
        user_principal_id,
        node_client_id: 0
      };

      const broadcastCount = await hybridServer.broadcastToClients(message);

      return ApiResponse.success(res, { 
        message: 'Message broadcasted successfully',
        clientsReached: broadcastCount
      }, 'Broadcast completed');
    } catch (error) {
      console.error('Error broadcasting message:', error);
      return ApiResponse.internalError(res, 'Failed to broadcast message');
    }
  });

  return router;
}
