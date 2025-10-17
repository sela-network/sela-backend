import { Database } from './database';
import { 
  ClientStruct, 
  JobStruct, 
  EntityResult, 
  JobState, 
  ClientState, 
  ClientStatus,
  UptimeStats,
  SessionData,
  JobCompletionResult,
  REDIS_KEYS
} from './types';
import { SimplifiedReward } from '../types';

export class DatabaseService {
  private db: Database;
  private referralService?: any;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Set referral service for integration
   */
  setReferralService(referralService: any): void {
    this.referralService = referralService;
  }

  // Client authentication and management
  async login(userPrincipalId: string): Promise<EntityResult<ClientStruct>> {
    try {
      // Check if client exists
      const existingClient = await this.db.getClient(userPrincipalId);
      
      if (existingClient.success) {
        // Update connection time
        await this.db.updateClient(userPrincipalId, {
          wsConnect: Date.now(),
          wsDisconnect: 0,
          clientStatus: ClientStatus.ACTIVE
        });
        
        return existingClient;
      }

      // Create new client with default referral code and ACTIVE status
      const referralCode = await this.generateReferralCode();
      const newClient = await this.db.createClient(userPrincipalId, referralCode);
      
      if (newClient.success) {
        // Ensure the new client is set to ACTIVE status
        await this.db.updateClient(userPrincipalId, {
          clientStatus: ClientStatus.ACTIVE
        });
      }
      
      return newClient;
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Login failed: ${error}` }
      };
    }
  }

  async clientConnect(userPrincipalId: string, clientId: string): Promise<EntityResult<string>> {
    try {
      const now = Date.now();
      
      const updateResult = await this.db.updateClient(userPrincipalId, {
        client_id: clientId,  // Set the client_id during connection
        wsConnect: now,
        wsDisconnect: 0,
        clientStatus: ClientStatus.ACTIVE,
        pingTimestamp: now
      });

      if (!updateResult.success) {
        return updateResult;
      }

      // Create session
      await this.db.createSession(userPrincipalId, clientId);

      return { success: true, data: 'Client connected successfully' };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Client connect failed: ${error}` }
      };
    }
  }

  async clientDisconnect(clientId: string): Promise<string> {
    try {
      // Find client by client_id (this would need to be implemented in the database)
      // For now, we'll need to iterate through clients to find the one with matching client_id
      const allClients = await this.db.getAllClients();
      
      if (!allClients.success) {
        return 'Failed to get clients';
      }

      const client = allClients.data.find(c => c.client_id === clientId);
      if (!client) {
        return 'Client not found';
      }

      const now = Date.now();
      const sessionDuration = now - client.wsConnect;
      
      await this.db.updateClient(client.user_principal_id, {
        wsDisconnect: now,
        clientStatus: ClientStatus.INACTIVE,
        totalUptime: client.totalUptime + sessionDuration,
        dailyUptime: client.dailyUptime + sessionDuration
      });

      return 'Client disconnected successfully';
    } catch (error) {
      return `Client disconnect failed: ${error}`;
    }
  }

  async clientAuthorization(userPrincipalId: string): Promise<EntityResult<string>> {
    try {
      console.log(`🔍 Checking authorization for user: ${userPrincipalId}`);
      
      const client = await this.db.getClient(userPrincipalId);
      
      if (!client.success) {
        console.log(`❌ Client not found for user: ${userPrincipalId}`);
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }

      console.log(`✅ Client found for user: ${userPrincipalId}, status: ${client.data.clientStatus}`);

      // Check if client is active
      if (client.data.clientStatus !== ClientStatus.ACTIVE) {
        console.log(`❌ Client is not active for user: ${userPrincipalId}, status: ${client.data.clientStatus}`);
        return { 
          success: false, 
          error: { type: 'InvalidInput', message: 'Client is not active' }
        };
      }

      console.log(`✅ Client authorization successful for user: ${userPrincipalId}`);
      return { success: true, data: 'Client authorized' };
    } catch (error) {
      console.error(`❌ Authorization error for user ${userPrincipalId}:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Authorization failed: ${error}` }
      };
    }
  }

  // Job management
  async addJobToDB(clientUUID: string, jobType: string, target: string): Promise<EntityResult<string>> {
    try {
      const jobData = {
        clientUUID,
        storedID: '',
        jobType,
        target,
        state: JobState.PENDING,
        user_principal_id: '', // Will be assigned later
        reward: 0.0
      };

      const result = await this.db.createJob(jobData);
      
      if (!result.success) {
        return result;
      }

      return { success: true, data: result.data.jobID };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to add job: ${error}` }
      };
    }
  }

  async assignJobToClient(jobId: string, clientId: string): Promise<EntityResult<string>> {
    try {
      // Find client by client_id
      const allClients = await this.db.getAllClients();
      
      if (!allClients.success) {
        return allClients;
      }

      const client = allClients.data.find(c => c.client_id === clientId);
      if (!client) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }

      // ✅ Check client capacity before assignment
      const currentJobs = client.activeJobs || [];
      const maxCapacity = client.maxConcurrentJobs || 3;
      
      
      if (currentJobs.length >= maxCapacity) {
        return {
          success: false,
          error: { type: 'InvalidInput', message: `Client at maximum capacity (${currentJobs.length}/${maxCapacity})` }
        };
      }

      // Update job
      await this.db.updateJob(jobId, {
        user_principal_id: client.user_principal_id, 
        state: JobState.ONGOING,
        assignedAt: Date.now()
      });

      // ✅ Add job to client's activeJobs array
      const updatedActiveJobs = [...currentJobs, jobId];
      
    const clientUpdates: any = {
      activeJobs: updatedActiveJobs
    };

      await this.db.updateClient(client.user_principal_id, clientUpdates);

      return { success: true, data: 'Job assigned successfully' };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to assign job: ${error}` }
      };
    }
  }

  async getJobWithID(jobId: string): Promise<EntityResult<JobStruct>> {
    return await this.db.getJob(jobId);
  }

  async updateJobCompleted(jobId: string, clientId: string, storedFileId?: string | null): Promise<EntityResult<JobCompletionResult>> {
    try {
      console.log(`🔍 updateJobCompleted called: jobId=${jobId}, clientId=${clientId}, storedFileId=${storedFileId}`);
      
      // Find client by client_id
      const allClients = await this.db.getAllClients();
      
      if (!allClients.success) {
        console.log(`❌ Failed to get all clients:`, allClients.error);
        return allClients;
      }

      console.log(`📊 Total clients found: ${allClients.data.length}`);
      
      const client = allClients.data.find(c => c.client_id === clientId);
      if (!client) {
        console.log(`❌ Client not found with client_id: ${clientId}`);
        console.log(`🔍 Available client_ids:`, allClients.data.map(c => c.client_id));
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }

      console.log(`✅ Found client:`, client);

      // Get the job to access its assignedAt time
      const job = await this.db.getJob(jobId);
      if (!job.success) {
        console.log(`❌ Job not found: ${jobId}`);
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Job not found' }
        };
      }

      console.log(`✅ Found job:`, job.data);

      const now = Date.now();
      

      const jobStartTime = job.data.assignedAt;
      const timeDifferenceMs = now - jobStartTime;
      const timeDifferenceSeconds = timeDifferenceMs / 1000;
      const rewardPoints = 0.012 * timeDifferenceSeconds;

      console.log(`💰 Reward calculation for job ${jobId}:`);
      console.log(`   Job start time: ${new Date(jobStartTime).toISOString()}`);
      console.log(`   Completion time: ${new Date(now).toISOString()}`);
      console.log(`   Time difference: ${timeDifferenceSeconds.toFixed(2)} seconds`);
      console.log(`   Reward points: ${rewardPoints.toFixed(4)}`);

      // Calculate pricing information if file is available
      let pricingInfo = null;
      if (storedFileId) {
        try {
          console.log(`💰 Calculating pricing for job ${jobId} with stored file ID: ${storedFileId}`);
          
          // Get file content for pricing calculation
          const fileService = new (await import('../services/file_service')).FileService(this.db);
          const contentResult = await fileService.getFileContentByStoredId(storedFileId);
          
          if (contentResult.success && contentResult.data) {
            const { calculateJobPrice, getContentSizeKB, analyzeScrapedDataByType } = await import('../utils/pricing');
            
            // Calculate file size and object count
            const fileSizeKB = getContentSizeKB(contentResult.data);
            const dataAnalysis = analyzeScrapedDataByType(contentResult.data, job.data.jobType);
            const objectsCount = dataAnalysis ? dataAnalysis.dataCount : 0;
            
            // Calculate pricing
            const pricing = calculateJobPrice({ fileSizeKB, objectsCount });
            
            pricingInfo = {
              price: pricing.totalPrice,
              objectsCount,
              fileSizeKB
            };
            
            console.log(`✅ Pricing calculated for job ${jobId}: ${pricing.totalPrice} USDT (${fileSizeKB}KB, ${objectsCount} objects)`);
          } else {
            console.warn(`⚠️ Could not load file content for pricing calculation: ${storedFileId}`);
          }
        } catch (pricingError) {
          console.warn(`⚠️ Failed to calculate pricing for job ${jobId}:`, pricingError);
          // Continue without pricing - job completion should not fail due to pricing calculation
        }
      }

      const jobUpdates: any = {
        state: JobState.COMPLETED,
        completeAt: now,
        reward: rewardPoints,
        user_principal_id: client.user_principal_id // ✅ CRITICAL FIX: Set the user_principal_id to the client who completed the job
      };
      
      if (storedFileId) {
        jobUpdates.storedID = storedFileId;
      }
      
      // Add pricing information if calculated
      if (pricingInfo) {
        jobUpdates.price = pricingInfo.price;
        jobUpdates.objectsCount = pricingInfo.objectsCount;
        jobUpdates.fileSizeKB = pricingInfo.fileSizeKB;
      }
      
      console.log(`🔍 Updating job ${jobId} with user_principal_id: ${client.user_principal_id}`);
      await this.db.updateJob(jobId, jobUpdates);

      // ✅ Remove job from client's activeJobs array
      const currentActiveJobs = client.activeJobs || [];
      const updatedActiveJobs = currentActiveJobs.filter(id => id !== jobId);
      
    const clientUpdates: any = {
      activeJobs: updatedActiveJobs,
      todaysEarnings: client.todaysEarnings + rewardPoints,
      balance: client.balance + rewardPoints
    };


      await this.db.updateClient(client.user_principal_id, clientUpdates); 

      // ✅ Calculate and distribute task referral rewards
      if (this.referralService) {
        try {
          console.log(`💰 Calculating task referral rewards for job ${jobId} (referee: ${client.user_principal_id}, earned: ${rewardPoints})`);
          const taskRewardResult = await this.referralService.calculateTaskReward(
            client.user_principal_id,
            rewardPoints,
            jobId
          );
          
          if (taskRewardResult.success) {
            console.log(`✅ Task referral rewards distributed: ${taskRewardResult.data.total_distributed} points`);
          } else {
            console.warn(`⚠️ Failed to calculate task referral rewards:`, taskRewardResult.error);
          }
        } catch (referralError) {
          console.error(`❌ Error calculating task referral rewards:`, referralError);
        }
      } else {
        console.warn(`⚠️ ReferralService not available - task referral rewards not distributed`);
      }

      return { 
        success: true, 
        data: { 
          message: 'Job completed successfully', 
          reward: rewardPoints 
        } 
      };
    } catch (error) {
      console.error(`❌ Error in updateJobCompleted:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to complete job: ${error}` }
      };
    }
  }

  /**
   * Mark a job as failed and remove it from client's active jobs
   */
  async markJobAsFailed(jobId: string, clientId: string, errorMessage: string): Promise<EntityResult<string>> {
    try {
      console.log(`🔍 markJobAsFailed called: jobId=${jobId}, clientId=${clientId}, error=${errorMessage}`);
      
      // Find client by client_id
      const allClients = await this.db.getAllClients();
      
      if (!allClients.success) {
        console.log(`❌ Failed to get all clients:`, allClients.error);
        return allClients;
      }
      
      const client = allClients.data.find(c => c.client_id === clientId);
      if (!client) {
        console.log(`❌ Client not found with client_id: ${clientId}`);
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }

      console.log(`✅ Found client: ${client.user_principal_id}`);

      // Update job state to failed
      const now = Date.now();
      const jobUpdates: any = {
        state: JobState.FAILED,
        completeAt: now,
        reward: 0, // No reward for failed jobs
        error: errorMessage
      };
      
      console.log(`🔍 Updating job ${jobId} state to FAILED`);
      await this.db.updateJob(jobId, jobUpdates);

      // ✅ Remove job from client's activeJobs array (no reward for failed jobs)
      const currentActiveJobs = client.activeJobs || [];
      const updatedActiveJobs = currentActiveJobs.filter(id => id !== jobId);
      
      const clientUpdates: any = {
        activeJobs: updatedActiveJobs
      };

      // ✅ Update legacy fields for backward compatibility
      if (updatedActiveJobs.length === 0) {
        // No more active jobs
        clientUpdates.jobID = '';
        clientUpdates.jobStatus = ClientState.NOT_WORKING;
        clientUpdates.jobEndTime = now;
      } else {
        // Still has active jobs - keep the first one as the "current" job
        clientUpdates.jobID = updatedActiveJobs[0];
        clientUpdates.jobStatus = ClientState.WORKING;
        // Don't update jobEndTime since client is still working
      }

      await this.db.updateClient(client.user_principal_id, clientUpdates);

      console.log(`✅ Job ${jobId} marked as failed and removed from client ${clientId}`);
      return { 
        success: true, 
        data: 'Job marked as failed successfully'
      };
    } catch (error) {
      console.error(`❌ Error in markJobAsFailed:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to mark job as failed: ${error}` }
      };
    }
  }

  async updateClientInternetSpeed(userPrincipalId: string, speedData: string): Promise<EntityResult<string>> {
    try {
      let speed: number;
      let ping: number | undefined;
      
      try {
        const parsedData = JSON.parse(speedData);
        if (typeof parsedData === 'object' && parsedData.downloadSpeed !== undefined) {
          speed = parseFloat(parsedData.downloadSpeed);
          ping = parsedData.ping ? parseFloat(parsedData.ping) : undefined;
        } else {
          // Fallback to treating as raw speed value
          speed = parseFloat(speedData);
        }
      } catch (parseError) {
        // If not JSON, treat as raw speed value
        speed = parseFloat(speedData);
      }
      
      if (isNaN(speed)) {
        return { 
          success: false, 
          error: { type: 'InvalidInput', message: 'Invalid speed data' }
        };
      }

      const updateData: any = {
        downloadSpeed: speed,
        pingTimestamp: Date.now()
      };
      
      // Add ping if available
      if (ping !== undefined && !isNaN(ping)) {
        updateData.ping = ping;
      }

      await this.db.updateClient(userPrincipalId, updateData);

      return { success: true, data: 'Speed updated successfully' };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to update speed: ${error}` }
      };
    }
  }

  // Job assignment logic
  async findAndAssignJob(userPrincipalId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
  } | null>> {
    try {
      const client = await this.db.getClient(userPrincipalId);
      
      if (!client.success) {
        return client;
      }

      // Get pending jobs
      const pendingJobs = await this.db.getJobsByState(JobState.PENDING);
      
      if (!pendingJobs.success || pendingJobs.data.length === 0) {
        return { success: true, data: null as any };
      }

      // Find suitable job (simple assignment for now)
      const job = pendingJobs.data[0];
      
      // Assign job to client
      await this.assignJobToClient(job.jobID, client.data.client_id);

      return {
        success: true,
        data: {
          user_principal_id: client.data.user_principal_id,
          client_id: client.data.client_id,
          downloadSpeed: client.data.downloadSpeed,
          target: job.target,
          jobType: job.jobType
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to find and assign job: ${error}` }
      };
    }
  }

  async findAndAssignJobToClient(userPrincipalId: string, targetJobType: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
  } | null>> {
    try {
      const client = await this.db.getClient(userPrincipalId);
      
      if (!client.success) {
        return client;
      }

      // Get pending jobs of specific type
      const pendingJobs = await this.db.getJobsByState(JobState.PENDING);
      
      if (!pendingJobs.success) {
        return pendingJobs;
      }

      const matchingJob = pendingJobs.data.find(job => job.jobType === targetJobType);
      
      if (!matchingJob) {
        return { success: true, data: null as any };
      }

      // Assign job to client
      await this.assignJobToClient(matchingJob.jobID, client.data.client_id);

      return {
        success: true,
        data: {
          user_principal_id: client.data.user_principal_id,
          client_id: client.data.client_id,
          downloadSpeed: client.data.downloadSpeed,
          target: matchingJob.target,
          jobType: matchingJob.jobType
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to find and assign job to client: ${error}` }
      };
    }
  }

  // Rewards and earnings
  async addRewardsToDB(userPrincipalId: string, reward: number): Promise<EntityResult<number>> {
    try {
      const client = await this.db.getClient(userPrincipalId);
      
      if (!client.success) {
        return client;
      }

      const newBalance = client.data.balance + reward;
      const newTodaysEarnings = client.data.todaysEarnings + reward;
      const newUptimeReward = client.data.uptimeReward + reward;

      await this.db.updateClient(userPrincipalId, {
        balance: newBalance,
        todaysEarnings: newTodaysEarnings,
        uptimeReward: newUptimeReward
      });

      return { success: true, data: newBalance };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to add rewards: ${error}` }
      };
    }
  }

  async getUserRewardHistory(userPrincipalId: string, page: number = 1, limit: number = 20): Promise<EntityResult<{
    rewards: SimplifiedReward[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
    summary: {
      totalJobRewards: number;
      totalUptimeRewards: number;
      totalRewards: number;
      totalUptimeMinutes: number;
      jobRewardsCount: number;
      uptimeRewardsCount: number;
    };
  }>> {
    try {
      console.log(`🔍 Getting combined reward history for user: ${userPrincipalId}, page: ${page}, limit: ${limit}`);
      
      // Get job rewards
      const jobs = await this.db.getJobsByUser(userPrincipalId);
      
      if (!jobs.success) {
        console.log(`❌ Failed to get jobs for user: ${userPrincipalId}`, jobs.error);
        return jobs;
      }

      // Filter completed jobs
      const completedJobs = jobs.data.filter(job => job.state === JobState.COMPLETED);
      console.log(`💰 Found ${completedJobs.length} completed jobs for user: ${userPrincipalId}`);
      
      // Get uptime rewards
      const transactionPattern = `${REDIS_KEYS.UPTIME.TRANSACTION}*`;
      const transactionKeys = await this.db.getRedisClient().keys(transactionPattern);
      
      const uptimeRewards = [];
      for (const txKey of transactionKeys) {
        const txData = await this.db.getFileMetadata(txKey);
        if (txData) {
          const transaction = JSON.parse(txData);
          
          if (transaction.user_principal_id === userPrincipalId && transaction.status === 'CONFIRMED') {
            uptimeRewards.push({
              type: 'uptime' as const,
              amount: transaction.amount,
              timestamp: transaction.timestamp,
              date: transaction.date,
              state: 'completed',
              completeAt: transaction.timestamp,
              job_id: null
            });
          }
        }
      }
      
      console.log(`💰 Found ${uptimeRewards.length} uptime rewards for user: ${userPrincipalId}`);
      
      // Convert job rewards to unified format
      const jobRewards = completedJobs.map(job => ({
        type: 'job' as const,
        amount: job.reward,
        timestamp: job.completeAt || job.assignedAt,
        state: job.state,
        completeAt: job.completeAt,
        date: new Date(job.completeAt || job.assignedAt).toISOString().split('T')[0],
        job_id: job.jobID
      }));
      
      // Combine and sort all rewards by timestamp (newest first)
      const allRewards = [...jobRewards, ...uptimeRewards].sort((a, b) => b.timestamp - a.timestamp);
      
      console.log(`📊 Total combined rewards: ${allRewards.length}`);
      
      // Calculate pagination
      const totalItems = allRewards.length;
      const totalPages = Math.ceil(totalItems / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      
      // Get paginated rewards
      const paginatedRewards = allRewards.slice(startIndex, endIndex);
      
      // Calculate summary statistics
      const totalJobRewards = jobRewards.reduce((sum, reward) => sum + reward.amount, 0);
      const totalUptimeRewards = uptimeRewards.reduce((sum, reward) => sum + reward.amount, 0);
      
      // Calculate total uptime minutes from original transaction data
      let totalUptimeMinutes = 0;
      for (const txKey of transactionKeys) {
        const txData = await this.db.getFileMetadata(txKey);
        if (txData) {
          const transaction = JSON.parse(txData);
          if (transaction.user_principal_id === userPrincipalId && transaction.status === 'CONFIRMED') {
            totalUptimeMinutes += transaction.uptime_minutes || 0;
          }
        }
      }
      
      const pagination = {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      };
      
      const summary = {
        totalJobRewards,
        totalUptimeRewards,
        totalRewards: totalJobRewards + totalUptimeRewards,
        totalUptimeMinutes,
        jobRewardsCount: jobRewards.length,
        uptimeRewardsCount: uptimeRewards.length
      };
      
      return { 
        success: true, 
        data: { 
          rewards: paginatedRewards,
          pagination,
          summary
        }
      };
    } catch (error) {
      console.error(`❌ Error getting combined reward history for user ${userPrincipalId}:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get combined reward history: ${error}` }
      };
    }
  }

  async getUserRewardHistoryByDate(userPrincipalId: string, startDate?: string, endDate?: string): Promise<EntityResult<{
    dailyRewards: Array<{
      date: string;
      jobRewards: number;
      uptimeRewards: number;
      totalRewards: number;
      jobCount: number;
      uptimeMinutes: number;
    }>;
    summary: {
      totalJobRewards: number;
      totalUptimeRewards: number;
      totalRewards: number;
      totalDays: number;
      averageDailyRewards: number;
    };
  }>> {
    try {
      console.log(`🔍 Getting reward history by date for user: ${userPrincipalId}`);
      
      // Get job rewards
      const jobs = await this.db.getJobsByUser(userPrincipalId);
      
      if (!jobs.success) {
        console.log(`❌ Failed to get jobs for user: ${userPrincipalId}`, jobs.error);
        return jobs;
      }

      // Filter completed jobs
      const completedJobs = jobs.data.filter(job => job.state === JobState.COMPLETED);
      
      // Get uptime rewards
      const transactionPattern = `${REDIS_KEYS.UPTIME.TRANSACTION}*`;
      const transactionKeys = await this.db.getRedisClient().keys(transactionPattern);
      
      const uptimeRewards = [];
      for (const txKey of transactionKeys) {
        const txData = await this.db.getFileMetadata(txKey);
        if (txData) {
          const transaction = JSON.parse(txData);
          
          if (transaction.user_principal_id === userPrincipalId && transaction.status === 'CONFIRMED') {
            uptimeRewards.push({
              date: transaction.date,
              amount: transaction.amount,
              uptimeMinutes: transaction.uptime_minutes,
              timestamp: transaction.timestamp
            });
          }
        }
      }
      
      // Group job rewards by date
      const jobRewardsByDate = new Map<string, { rewards: number; count: number }>();
      completedJobs.forEach(job => {
        if (job.completeAt) {
          const date = new Date(job.completeAt).toISOString().split('T')[0];
          const existing = jobRewardsByDate.get(date) || { rewards: 0, count: 0 };
          jobRewardsByDate.set(date, {
            rewards: existing.rewards + job.reward,
            count: existing.count + 1
          });
        }
      });
      
      // Group uptime rewards by date
      const uptimeRewardsByDate = new Map<string, { rewards: number; minutes: number }>();
      uptimeRewards.forEach(tx => {
        const existing = uptimeRewardsByDate.get(tx.date) || { rewards: 0, minutes: 0 };
        uptimeRewardsByDate.set(tx.date, {
          rewards: existing.rewards + tx.amount,
          minutes: existing.minutes + tx.uptimeMinutes
        });
      });
      
      // Get all unique dates
      const allDates = new Set([
        ...jobRewardsByDate.keys(),
        ...uptimeRewardsByDate.keys()
      ]);
      
      // Convert to array and sort by date
      const sortedDates = Array.from(allDates).sort();
      
      // Apply date filtering if provided
      let filteredDates = sortedDates;
      if (startDate) {
        filteredDates = filteredDates.filter(date => date >= startDate);
      }
      if (endDate) {
        filteredDates = filteredDates.filter(date => date <= endDate);
      }
      
      // Build daily rewards array
      const dailyRewards = filteredDates.map(date => {
        const jobData = jobRewardsByDate.get(date) || { rewards: 0, count: 0 };
        const uptimeData = uptimeRewardsByDate.get(date) || { rewards: 0, minutes: 0 };
        
        return {
          date,
          jobRewards: jobData.rewards,
          uptimeRewards: uptimeData.rewards,
          totalRewards: jobData.rewards + uptimeData.rewards,
          jobCount: jobData.count,
          uptimeMinutes: uptimeData.minutes
        };
      });
      
      // Calculate summary
      const totalJobRewards = dailyRewards.reduce((sum, day) => sum + day.jobRewards, 0);
      const totalUptimeRewards = dailyRewards.reduce((sum, day) => sum + day.uptimeRewards, 0);
      const totalRewards = totalJobRewards + totalUptimeRewards;
      const totalDays = dailyRewards.length;
      const averageDailyRewards = totalDays > 0 ? totalRewards / totalDays : 0;
      
      const summary = {
        totalJobRewards,
        totalUptimeRewards,
        totalRewards,
        totalDays,
        averageDailyRewards
      };
      
      console.log(`📊 Generated daily rewards data for ${totalDays} days`);
      
      return { 
        success: true, 
        data: { 
          dailyRewards,
          summary
        }
      };
    } catch (error) {
      console.error(`❌ Error getting reward history by date for user ${userPrincipalId}:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get reward history by date: ${error}` }
      };
    }
  }

  // WebSocket session management
  async wsCreateSession(userPrincipalId: string, clientId: string): Promise<string> {
    try {
      const session = await this.db.createSession(userPrincipalId, clientId);
      
      if (!session.success) {
        return 'Failed to create session';
      }

      return session.data.sessionId;
    } catch (error) {
      return `Session creation failed: ${error}`;
    }
  }

  async wsEndSession(sessionId: string): Promise<EntityResult<void>> {
    return await this.db.endSession(sessionId);
  }

  async wsUpdateHeartbeat(userPrincipalId: string): Promise<EntityResult<void>> {
    try {
      await this.db.updateClient(userPrincipalId, {
        pingTimestamp: Date.now()
      });

      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to update heartbeat: ${error}` }
      };
    }
  }

  async wsGetUptimeStats(userPrincipalId: string): Promise<EntityResult<UptimeStats>> {
    return await this.db.getUptimeStats(userPrincipalId);
  }

  // Utility methods
  private async generateReferralCode(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Get all nodes (clients)
  async getAllNodes(): Promise<EntityResult<ClientStruct[]>> {
    return await this.db.getAllClients();
  }

  async getAllRunningNodes(): Promise<EntityResult<ClientStruct[]>> {
    return await this.db.getClientsByStatus(ClientStatus.ACTIVE);
  }

  async updateClient(userPrincipalId: string, updates: Partial<ClientStruct>): Promise<EntityResult<void>> {
    return await this.db.updateClient(userPrincipalId, updates);
  }

  async getAllJobs(userPrincipalId?: string): Promise<EntityResult<JobStruct[]>> {
    if (userPrincipalId) {
      return await this.db.getJobsByUser(userPrincipalId);
    }
    return await this.db.getAllJobs();
  }

  async getAllPendingJobs(userPrincipalId?: string): Promise<EntityResult<JobStruct[]>> {
    if (userPrincipalId) {
      const userJobs = await this.db.getJobsByUser(userPrincipalId);
      if (!userJobs.success) {
        return userJobs;
      }
      
      const pendingJobs = userJobs.data.filter(job => job.state === JobState.PENDING);
      return { success: true, data: pendingJobs };
    }
    
    return await this.db.getJobsByState(JobState.PENDING);
  }

  async resendJob(jobId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
  } | null>> {
    try {
      const job = await this.db.getJob(jobId);
      
      if (!job.success) {
        return job;
      }

      if (job.data.user_principal_id) {
        const client = await this.db.getClient(job.data.user_principal_id);
        
        if (client.success) {
          return {
            success: true,
            data: {
              user_principal_id: client.data.user_principal_id,
              client_id: client.data.client_id,
              downloadSpeed: client.data.downloadSpeed,
              target: job.data.target,
              jobType: job.data.jobType
            }
          };
        }
      }

      return { success: true, data: null as any };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to resend job: ${error}` }
      };
    }
  }

  // API Key management
  async createAPIKey(userPrincipalId: string): Promise<EntityResult<string>> {
    try {
      const result = await this.db.createAPIKey(userPrincipalId);
      if (!result.success) {
        return result;
      }
      return { success: true, data: result.data.apiKey };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to create API key: ${error}` }
      };
    }
  }

  async getAPIKeyData(userPrincipalId: string): Promise<EntityResult<{apiKey: string, usageCount: number, usageLimit: number}>> {
    try {
      const result = await this.db.getAPIKey(userPrincipalId);
      if (!result.success) {
        return result;
      }
      return { 
        success: true, 
        data: {
          apiKey: result.data.apiKey,
          usageCount: result.data.usageCount,
          usageLimit: result.data.usageLimit
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get API key data: ${error}` }
      };
    }
  }

  async getUUIDFromAPIKey(apiKey: string): Promise<EntityResult<string>> {
    try {
      return await this.db.getUUIDFromAPIKey(apiKey);
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get UUID from API key: ${error}` }
      };
    }
  }

  async recordAPIUsage(userPrincipalId: string): Promise<boolean> {
    try {
      const result = await this.db.incrementAPIUsage(userPrincipalId);
      return result.success;
    } catch (error) {
      console.error(`Failed to record API usage: ${error}`);
      return false;
    }
  }

  async getUsageInDateRange(userPrincipalId: string, fromDate: number, toDate: number): Promise<string> {
    try {
      const apiKeyResult = await this.db.getAPIKey(userPrincipalId);
      if (!apiKeyResult.success) {
        return JSON.stringify({ error: 'API key not found' });
      }

      const usageLog = apiKeyResult.data.usageLog.filter(
        entry => entry.timestamp >= fromDate && entry.timestamp <= toDate
      );

      return JSON.stringify({
        clientUUID: userPrincipalId,
        fromDate,
        toDate,
        usageCount: usageLog.length,
        usageDetails: usageLog
      });
    } catch (error) {
      return JSON.stringify({ error: `Failed to get usage in date range: ${error}` });
    }
  }

  async getStoredIdFromJobId(jobId: string): Promise<EntityResult<string>> {
    try {
      const job = await this.db.getJob(jobId);
      if (!job.success) {
        return job;
      }
      return { success: true, data: job.data.storedID };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get stored ID from job ID: ${error}` }
      };
    }
  }

  // Find optimal node for job assignment
  async findOptimalNode(jobId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
  } | null>> {
    try {
      const job = await this.db.getJob(jobId);
      if (!job.success) {
        return job;
      }

      // Get all active clients
      const activeClients = await this.db.getClientsByStatus(ClientStatus.ACTIVE);
      if (!activeClients.success || activeClients.data.length === 0) {
        return { success: true, data: null as any };
      }

      // ✅ Filter clients with available capacity
      const availableClients = activeClients.data.filter(client => {
        const currentJobs = client.activeJobs || [];
        const maxCapacity = client.maxConcurrentJobs || 3;
        const hasCapacity = currentJobs.length < maxCapacity;

        
        return client.wsDisconnect === 0 &&                    // Still connected
               hasCapacity;                                    // Has available capacity
      });

      if (availableClients.length === 0) {
        return { success: true, data: null as any };
      }

      // ✅ Sort by available capacity first, then by download speed
      availableClients.sort((a, b) => {
        const aActiveJobs = a.activeJobs || [];
        const bActiveJobs = b.activeJobs || [];
        const aCapacity = (a.maxConcurrentJobs || 3) - aActiveJobs.length;
        const bCapacity = (b.maxConcurrentJobs || 3) - bActiveJobs.length;
        
        // Prioritize clients with more available capacity
        if (aCapacity !== bCapacity) {
          return bCapacity - aCapacity;
        }
        
        // If capacity is equal, prioritize by download speed
        return b.downloadSpeed - a.downloadSpeed;
      });
      
      const optimalClient = availableClients[0];

      // Assign job to optimal client
      await this.assignJobToClient(jobId, optimalClient.client_id);

      return {
        success: true,
        data: {
          user_principal_id: optimalClient.user_principal_id,
          client_id: optimalClient.client_id,
          downloadSpeed: optimalClient.downloadSpeed,
          target: job.data.target,
          jobType: job.data.jobType
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to find optimal node: ${error}` }
      };
    }
  }

  async findOptimalNodeWithId(jobId: string, principalId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
  } | null>> {
    try {
      const job = await this.db.getJob(jobId);
      if (!job.success) {
        return job;
      }

      const client = await this.db.getClient(principalId);
      if (!client.success) {
        return { success: true, data: null as any };
      }

      // ✅ Check if client is available and has capacity
      const currentJobs = client.data.activeJobs || [];
      const maxCapacity = client.data.maxConcurrentJobs || 3;
      
      if (client.data.clientStatus !== ClientStatus.ACTIVE ||
          client.data.wsDisconnect !== 0 ||
          currentJobs.length >= maxCapacity) {
        return { success: true, data: null as any };
      }

      // Assign job to specific client
      await this.assignJobToClient(jobId, client.data.client_id);

      return {
        success: true,
        data: {
          user_principal_id: client.data.user_principal_id,
          client_id: client.data.client_id,
          downloadSpeed: client.data.downloadSpeed,
          target: job.data.target,
          jobType: job.data.jobType
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to find optimal node with ID: ${error}` }
      };
    }
  }

  // Update job pricing information
  async updateJobPricingInfo(jobId: string, pricingInfo: {
    price: number;
    objectsCount: number;
    fileSizeKB: number;
    dataAnalysis?: { dataCount: number; included: string[] };
  }): Promise<EntityResult<void>> {
    try {
      const updates = {
        price: pricingInfo.price,
        objectsCount: pricingInfo.objectsCount,
        fileSizeKB: pricingInfo.fileSizeKB,
        ...(pricingInfo.dataAnalysis && { dataAnalysis: pricingInfo.dataAnalysis })
      };

      const result = await this.db.updateJob(jobId, updates);
      return result;
    } catch (error) {
      return {
        success: false,
        error: { type: 'UpdateFailed', message: `Failed to update job pricing info: ${error}` }
      };
    }
  }

  // Job cleanup operations
  async cleanupOldJobs(cutoffTimestamp: number): Promise<EntityResult<{
    deletedCount: number;
    failedDeletions: string[];
    errors: string[];
  }>> {
    try {
      console.log(`🧹 Starting job cleanup for jobs created before: ${new Date(cutoffTimestamp).toISOString()}`);
      
      const result = await this.db.cleanupOldJobs(cutoffTimestamp);
      
      if (result.success) {
        console.log(`✅ Job cleanup completed: ${result.data.deletedCount} jobs deleted`);
      } else {
        console.error(`❌ Job cleanup failed:`, result.error);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Error in job cleanup service:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to cleanup old jobs: ${error}` }
      };
    }
  }

  async getJobsCreatedBefore(timestamp: number): Promise<EntityResult<JobStruct[]>> {
    try {
      return await this.db.getJobsCreatedBefore(timestamp);
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get jobs created before timestamp: ${error}` }
      };
    }
  }

  async deleteJob(jobId: string): Promise<EntityResult<void>> {
    try {
      return await this.db.deleteJob(jobId);
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to delete job: ${error}` }
      };
    }
  }

  // ✅ New multi-job utility methods

  /**
   * Get client's current active job count
   */
  async getClientActiveJobCount(userPrincipalId: string): Promise<number> {
    try {
      const client = await this.db.getClient(userPrincipalId);
      if (!client.success) {
        return 0;
      }
      return client.data.activeJobs?.length || 0;
    } catch (error) {
      console.error(`Error getting active job count for ${userPrincipalId}:`, error);
      return 0;
    }
  }

  /**
   * Check if client is available for new jobs
   */
  async isClientAvailable(userPrincipalId: string): Promise<boolean> {
    try {
      const client = await this.db.getClient(userPrincipalId);
      if (!client.success) {
        return false;
      }
      
      const currentJobs = client.data.activeJobs || [];
      const maxCapacity = client.data.maxConcurrentJobs || 3;
      
      return client.data.clientStatus === ClientStatus.ACTIVE &&
             client.data.wsDisconnect === 0 &&
             currentJobs.length < maxCapacity;
    } catch (error) {
      console.error(`Error checking client availability for ${userPrincipalId}:`, error);
      return false;
    }
  }

  /**
   * Get client's capacity information
   */
  async getClientCapacityInfo(userPrincipalId: string): Promise<{
    activeJobs: number;
    maxConcurrentJobs: number;
    availableCapacity: number;
    utilizationRate: number;
    isOnline: boolean;
    isActive: boolean;
  }> {
    try {
      const client = await this.db.getClient(userPrincipalId);
      if (!client.success) {
        return {
          activeJobs: 0,
          maxConcurrentJobs: 0,
          availableCapacity: 0,
          utilizationRate: 0,
          isOnline: false,
          isActive: false
        };
      }

      const currentJobs = client.data.activeJobs || [];
      const maxCapacity = client.data.maxConcurrentJobs || 3;
      const availableCapacity = maxCapacity - currentJobs.length;
      const utilizationRate = maxCapacity > 0 ? (currentJobs.length / maxCapacity) * 100 : 0;

      return {
        activeJobs: currentJobs.length,
        maxConcurrentJobs: maxCapacity,
        availableCapacity,
        utilizationRate: Math.round(utilizationRate * 10) / 10, // Round to 1 decimal
        isOnline: client.data.wsDisconnect === 0,
        isActive: client.data.clientStatus === ClientStatus.ACTIVE
      };
    } catch (error) {
      console.error(`Error getting capacity info for ${userPrincipalId}:`, error);
      return {
        activeJobs: 0,
        maxConcurrentJobs: 0,
        availableCapacity: 0,
        utilizationRate: 0,
        isOnline: false,
        isActive: false
      };
    }
  }

  /**
   * Update client's maximum concurrent jobs capacity
   */
  async updateClientCapacity(userPrincipalId: string, maxConcurrentJobs: number): Promise<EntityResult<void>> {
    try {
      if (maxConcurrentJobs < 1 || maxConcurrentJobs > 10) {
        return {
          success: false,
          error: { type: 'InvalidInput', message: 'maxConcurrentJobs must be between 1 and 10' }
        };
      }

      const result = await this.db.updateClient(userPrincipalId, { maxConcurrentJobs });
      if (result.success) {
        console.log(`✅ Updated client ${userPrincipalId} capacity to ${maxConcurrentJobs} jobs`);
      }
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to update client capacity: ${error}` }
      };
    }
  }

  /**
   * Get all clients with their capacity information
   */
  async getAllClientsWithCapacity(): Promise<EntityResult<Array<{
    user_principal_id: string;
    client_id: string;
    activeJobs: number;
    maxConcurrentJobs: number;
    availableCapacity: number;
    utilizationRate: string;
    downloadSpeed: number;
    clientStatus: string;
    isOnline: boolean;
    lastSeen: number;
  }>>> {
    try {
      const allClientsResult = await this.db.getAllClients();
      if (!allClientsResult.success) {
        return allClientsResult;
      }

      const clientsWithCapacity = allClientsResult.data.map(client => {
        const currentJobs = client.activeJobs || [];
        const maxCapacity = client.maxConcurrentJobs || 3;
        const availableCapacity = maxCapacity - currentJobs.length;
        const utilizationRate = maxCapacity > 0 ? (currentJobs.length / maxCapacity) * 100 : 0;

        return {
          user_principal_id: client.user_principal_id,
          client_id: client.client_id,
          activeJobs: currentJobs.length,
          maxConcurrentJobs: maxCapacity,
          availableCapacity,
          utilizationRate: `${Math.round(utilizationRate * 10) / 10}%`,
          downloadSpeed: client.downloadSpeed,
          clientStatus: client.clientStatus,
          isOnline: client.wsDisconnect === 0,
          lastSeen: client.pingTimestamp
        };
      });

      return { success: true, data: clientsWithCapacity };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get clients with capacity: ${error}` }
      };
    }
  }

  /**
   * Get system-wide capacity statistics
   */
  async getSystemCapacityStats(): Promise<EntityResult<{
    totalClients: number;
    activeClients: number;
    totalCapacity: number;
    totalActiveJobs: number;
    totalAvailableCapacity: number;
    averageUtilization: string;
    highUtilizationClients: number; // >80% utilization
  }>> {
    try {
      const clientsResult = await this.getAllClientsWithCapacity();
      if (!clientsResult.success) {
        return clientsResult;
      }

      const clients = clientsResult.data;
      const activeClients = clients.filter(c => c.isOnline);
      
      const totalCapacity = clients.reduce((sum, c) => sum + c.maxConcurrentJobs, 0);
      const totalActiveJobs = clients.reduce((sum, c) => sum + c.activeJobs, 0);
      const totalAvailableCapacity = clients.reduce((sum, c) => sum + c.availableCapacity, 0);
      
      const avgUtilization = totalCapacity > 0 ? (totalActiveJobs / totalCapacity) * 100 : 0;
      const highUtilizationClients = clients.filter(c => 
        parseFloat(c.utilizationRate.replace('%', '')) > 80
      ).length;

      return {
        success: true,
        data: {
          totalClients: clients.length,
          activeClients: activeClients.length,
          totalCapacity,
          totalActiveJobs,
          totalAvailableCapacity,
          averageUtilization: `${Math.round(avgUtilization * 10) / 10}%`,
          highUtilizationClients
        }
      };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get system capacity stats: ${error}` }
      };
    }
  }

  // Get database instance for direct access
  getDatabase() {
    return this.db;
  }
}
