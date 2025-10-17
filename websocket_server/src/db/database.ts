import { createClient, RedisClientType } from 'redis';
import { 
  ClientStruct, 
  JobStruct, 
  AdminStruct, 
  SessionData, 
  UptimeStats, 
  EntityResult, 
  DatabaseError, 
  JobState, 
  ClientState, 
  ClientStatus, 
  REDIS_KEYS, 
  DatabaseConfig,
  APIKeyData,
  UsageEntry
} from './types';

export class Database {
  private client: RedisClientType;
  private config: DatabaseConfig;
  private isConnected: boolean = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.client = createClient({
      url: config.redis.url,
      socket: {
        host: config.redis.host || 'localhost',
        port: config.redis.port || 6380,
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      },
      password: config.redis.password,
      database: config.redis.db || 0
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('Connected to Redis');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('Redis connection error:', err);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      console.log('Disconnected from Redis');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  // Client operations
  async createClient(userPrincipalId: string, referralCode: string): Promise<EntityResult<ClientStruct>> {
    try {
      const clientId = await this.getNextClientId();
      const now = Date.now();
      
    const client: ClientStruct = {
      user_principal_id: userPrincipalId,
      client_id: clientId,
      activeJobs: [],              // ✅ Initialize empty job array
      maxConcurrentJobs: 10,        // ✅ Default capacity (configurable)
      downloadSpeed: 0.0,
      ping: 0,
      wsConnect: now,
      wsDisconnect: 0,
      todaysEarnings: 0.0,
      balance: 0.0,
      referralCode,
      totalReferral: 0,
      clientStatus: ClientStatus.INACTIVE,
      pingTimestamp: now,
      totalUptime: 0,
      dailyUptime: 0,
      uptimeReward: 0.0
      
    };

      const key = `${REDIS_KEYS.CLIENT}${userPrincipalId}`;
      await this.client.set(key, JSON.stringify(client));
      
      // Add to status index
      await this.client.sAdd(`${REDIS_KEYS.INDEX.CLIENTS_BY_STATUS}${client.clientStatus}`, userPrincipalId);

      // Create referral code lookup for the new client
      const referralLookupKey = `${REDIS_KEYS.REFERRAL.CODE_LOOKUP}${referralCode}`;
      await this.client.set(referralLookupKey, userPrincipalId);
      console.log(`✅ Referral code lookup created: ${referralCode} -> ${userPrincipalId}`);

      return { success: true, data: client };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to create client: ${error}` }
      };
    }
  }

  async getClient(userPrincipalId: string): Promise<EntityResult<ClientStruct>> {
    try {
      const key = `${REDIS_KEYS.CLIENT}${userPrincipalId}`;
      const data = await this.client.get(key);
      
      if (!data) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Client not found' }
        };
      }

      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get client: ${error}` }
      };
    }
  }

  async updateClient(userPrincipalId: string, updates: Partial<ClientStruct>): Promise<EntityResult<void>> {
    try {
      const key = `${REDIS_KEYS.CLIENT}${userPrincipalId}`;
      const maxRetries = 5;
      let retryCount = 0;

      while (retryCount < maxRetries) {
        try {
          // Use Redis WATCH for optimistic locking
          await this.client.watch(key);
          
          const result = await this.getClient(userPrincipalId);
          if (!result.success) {
            await this.client.unwatch();
            return result;
          }

          const updatedClient = { ...result.data, ...updates };
          
          // Use MULTI/EXEC transaction to ensure atomic update
          const multi = this.client.multi();
          multi.set(key, JSON.stringify(updatedClient));

          // Update status index if status changed
          if (updates.clientStatus && updates.clientStatus !== result.data.clientStatus) {
            multi.sRem(`${REDIS_KEYS.INDEX.CLIENTS_BY_STATUS}${result.data.clientStatus}`, userPrincipalId);
            multi.sAdd(`${REDIS_KEYS.INDEX.CLIENTS_BY_STATUS}${updates.clientStatus}`, userPrincipalId);
          }

          const execResult = await multi.exec();
          
          // If exec returns null, transaction was aborted (conflict detected)
          if (execResult === null) {
            retryCount++;
            console.log(`⚠️ Conflict detected updating client ${userPrincipalId}, retry ${retryCount}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, 10 * retryCount)); // Exponential backoff
            continue;
          }

          console.log(`✅ Client ${userPrincipalId} updated successfully (retries: ${retryCount})`);
          return { success: true, data: undefined };
          
        } catch (txError) {
          await this.client.unwatch();
          throw txError;
        }
      }

      // Max retries exceeded
      console.error(`❌ Failed to update client ${userPrincipalId} after ${maxRetries} retries due to conflicts`);
      return { 
        success: false, 
        error: { type: 'UpdateFailed', message: `Failed to update client after ${maxRetries} retries: concurrent modification conflict` }
      };
      
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'UpdateFailed', message: `Failed to update client: ${error}` }
      };
    }
  }

  async getAllClients(): Promise<EntityResult<ClientStruct[]>> {
    try {
      const pattern = `${REDIS_KEYS.CLIENT}*`;
      const keys = await this.client.keys(pattern);
      
      if (keys.length === 0) {
        return { success: true, data: [] };
      }

      const clients = await Promise.all(
        keys.map(async (key) => {
          const data = await this.client.get(key);
          return data ? JSON.parse(data) : null;
        })
      );

      return { success: true, data: clients.filter((client): client is ClientStruct => client !== null) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get all clients: ${error}` }
      };
    }
  }

  async getClientsByStatus(status: ClientStatus): Promise<EntityResult<ClientStruct[]>> {
    try {
      const userIds = await this.client.sMembers(`${REDIS_KEYS.INDEX.CLIENTS_BY_STATUS}${status}`);
      
      if (userIds.length === 0) {
        return { success: true, data: [] };
      }

      const clients = await Promise.all(
        userIds.map(async (userId) => {
          const result = await this.getClient(userId);
          return result.success ? result.data : null;
        })
      );

      return { success: true, data: clients.filter((client): client is ClientStruct => client !== null) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get clients by status: ${error}` }
      };
    }
  }

  // Job operations
  async createJob(jobData: Omit<JobStruct, 'jobID' | 'assignedAt' | 'completeAt' | 'job_views' | 'job_downloads'>): Promise<EntityResult<JobStruct>> {
    try {
      const jobId = await this.generateJobId();
      const now = Date.now();
      
      const job: JobStruct = {
        ...jobData,
        jobID: jobId,
        assignedAt: now,
        completeAt: 0,
        job_views: 0,
        job_downloads: 0
      };

      console.log(`🔍 Creating job: ${jobId}`);
      console.log(`   clientUUID: ${job.clientUUID}`);
      console.log(`   user_principal_id: ${job.user_principal_id || 'empty'}`);

      const key = `${REDIS_KEYS.JOB}${jobId}`;
      await this.client.set(key, JSON.stringify(job));
      
      // Add to state index
      await this.client.sAdd(`${REDIS_KEYS.INDEX.JOBS_BY_STATE}${job.state}`, jobId);
      console.log(`✅ Job ${jobId} added to state index: ${job.state}`);
      
      // Add to user index by clientUUID (job creator) - for RPC routes
      await this.client.sAdd(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${job.clientUUID}`, jobId);
      console.log(`✅ Job ${jobId} added to creator index: ${job.clientUUID}`);
      
      // Also add to user index by user_principal_id (assigned client) - for node routes
      // This will be empty initially but will be updated when job is assigned
      if (job.user_principal_id) {
        await this.client.sAdd(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${job.user_principal_id}`, jobId);
        console.log(`✅ Job ${jobId} added to assigned client index: ${job.user_principal_id}`);
      } else {
        console.log(`⚠️ Job ${jobId} has no assigned client yet (user_principal_id is empty)`);
      }

      return { success: true, data: job };
    } catch (error) {
      console.error(`❌ Error creating job:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to create job: ${error}` }
      };
    }
  }

  async getJob(jobId: string): Promise<EntityResult<JobStruct>> {
    try {
      const key = `${REDIS_KEYS.JOB}${jobId}`;
      const data = await this.client.get(key);
      
      if (!data) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Job not found' }
        };
      }

      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get job: ${error}` }
      };
    }
  }

  async updateJob(jobId: string, updates: Partial<JobStruct>): Promise<EntityResult<void>> {
    try {
      console.log(`🔍 Updating job: ${jobId}`);
      console.log(`   Updates:`, updates);
      
      const result = await this.getJob(jobId);
      if (!result.success) {
        console.log(`❌ Job not found: ${jobId}`);
        return result;
      }

      const updatedJob = { ...result.data, ...updates };
      const key = `${REDIS_KEYS.JOB}${jobId}`;
      await this.client.set(key, JSON.stringify(updatedJob));
      console.log(`✅ Job ${jobId} updated in database`);

      // Update state index if state changed
      if (updates.state && updates.state !== result.data.state) {
        console.log(`🔄 Job ${jobId} state changed from ${result.data.state} to ${updates.state}`);
        await this.client.sRem(`${REDIS_KEYS.INDEX.JOBS_BY_STATE}${result.data.state}`, jobId);
        await this.client.sAdd(`${REDIS_KEYS.INDEX.JOBS_BY_STATE}${updates.state}`, jobId);
        console.log(`✅ Job ${jobId} moved from state index ${result.data.state} to ${updates.state}`);
      }

      // Update user index if user_principal_id changed (job reassigned to different client)
      if (updates.user_principal_id && updates.user_principal_id !== result.data.user_principal_id) {
        console.log(`🔄 Job ${jobId} user_principal_id changed from ${result.data.user_principal_id || 'empty'} to ${updates.user_principal_id}`);
        
        // Remove from old assigned client index
        if (result.data.user_principal_id) {
          await this.client.sRem(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${result.data.user_principal_id}`, jobId);
          console.log(`✅ Job ${jobId} removed from old client index: ${result.data.user_principal_id}`);
        }
        
        // Add to new assigned client index
        await this.client.sAdd(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${updates.user_principal_id}`, jobId);
        console.log(`✅ Job ${jobId} added to new client index: ${updates.user_principal_id}`);
      }

      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Error updating job ${jobId}:`, error);
      return { 
        success: false, 
        error: { type: 'UpdateFailed', message: `Failed to update job: ${error}` }
      };
    }
  }

  async getJobsByState(state: JobState): Promise<EntityResult<JobStruct[]>> {
    try {
      const jobIds = await this.client.sMembers(`${REDIS_KEYS.INDEX.JOBS_BY_STATE}${state}`);
      
      if (jobIds.length === 0) {
        return { success: true, data: [] };
      }

      const jobs = await Promise.all(
        jobIds.map(async (jobId) => {
          const result = await this.getJob(jobId);
          return result.success ? result.data : null;
        })
      );

      return { success: true, data: jobs.filter((job): job is JobStruct => job !== null) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get jobs by state: ${error}` }
      };
    }
  }

  async getJobsByUser(userPrincipalId: string): Promise<EntityResult<JobStruct[]>> {
    try {
      console.log(`🔍 getJobsByUser called for user: ${userPrincipalId}`);
      
      const jobIds = await this.client.sMembers(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${userPrincipalId}`);
      console.log(`📊 Found ${jobIds.length} job IDs in index for user: ${userPrincipalId}`);
      
      if (jobIds.length === 0) {
        console.log(`❌ No jobs found in index for user: ${userPrincipalId}`);
        return { success: true, data: [] };
      }

      
      const jobs = await Promise.all(
        jobIds.map(async (jobId) => {
          const result = await this.getJob(jobId);
          if (result.success) {
            return result.data;
          } else {
            console.log(`❌ Failed to retrieve job ${jobId}:`, result.error);
            return null;
          }
        })
      );

      const validJobs = jobs.filter((job): job is JobStruct => job !== null);
      console.log(`💰 Returning ${validJobs.length} valid jobs for user: ${userPrincipalId}`);
      
      return { success: true, data: validJobs };
    } catch (error) {
      console.error(`❌ Error in getJobsByUser for user ${userPrincipalId}:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get jobs by user: ${error}` }
      };
    }
  }

  async getAllJobs(): Promise<EntityResult<JobStruct[]>> {
    try {
      const pattern = `${REDIS_KEYS.JOB}*`;
      const keys = await this.client.keys(pattern);
      
      if (keys.length === 0) {
        return { success: true, data: [] };
      }

      const jobs = await Promise.all(
        keys.map(async (key) => {
          const data = await this.client.get(key);
          return data ? JSON.parse(data) : null;
        })
      );

      return { success: true, data: jobs.filter((job): job is JobStruct => job !== null) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get all jobs: ${error}` }
      };
    }
  }

  // Session operations
  async createSession(userPrincipalId: string, clientId: string): Promise<EntityResult<SessionData>> {
    try {
      const sessionId = await this.generateSessionId();
      const now = Date.now();
      
      const session: SessionData = {
        sessionId,
        user_principal_id: userPrincipalId,
        client_id: clientId,
        startTime: now,
        isActive: true
      };

      const key = `${REDIS_KEYS.SESSION}${sessionId}`;
      await this.client.set(key, JSON.stringify(session), { EX: this.config.timeouts.sessionTimeout });
      
      // Add to user sessions index
      await this.client.sAdd(`${REDIS_KEYS.INDEX.SESSIONS_BY_USER}${userPrincipalId}`, sessionId);

      return { success: true, data: session };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to create session: ${error}` }
      };
    }
  }

  async endSession(sessionId: string): Promise<EntityResult<void>> {
    try {
      const key = `${REDIS_KEYS.SESSION}${sessionId}`;
      const data = await this.client.get(key);
      
      if (!data) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'Session not found' }
        };
      }

      const session: SessionData = JSON.parse(data);
      const now = Date.now();
      
      const updatedSession: SessionData = {
        ...session,
        endTime: now,
        duration: now - session.startTime,
        isActive: false
      };

      await this.client.set(key, JSON.stringify(updatedSession));
      
      // Remove from user sessions index
      await this.client.sRem(`${REDIS_KEYS.INDEX.SESSIONS_BY_USER}${session.user_principal_id}`, sessionId);

      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'UpdateFailed', message: `Failed to end session: ${error}` }
      };
    }
  }

  // Uptime statistics
  async getUptimeStats(userPrincipalId: string): Promise<EntityResult<UptimeStats>> {
    try {
      const clientResult = await this.getClient(userPrincipalId);
      if (!clientResult.success) {
        return clientResult;
      }

      const client = clientResult.data;
      const now = Date.now();
      const isCurrentlyOnline = client.wsDisconnect === 0;
      const currentSessionDuration = isCurrentlyOnline ? now - client.wsConnect : 0;

      // Get today's date for daily uptime lookup
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      // Try to get detailed daily uptime record
      let todayUptime = client.dailyUptime; // Fallback to basic field
      try {
        const dailyRecordKey = `${REDIS_KEYS.UPTIME.DAILY}${userPrincipalId}:${today}`;
        const dailyRecordData = await this.client.get(dailyRecordKey);
        if (dailyRecordData) {
          const dailyRecord = JSON.parse(dailyRecordData);
          todayUptime = dailyRecord.total_minutes * 60 * 1000; // Convert minutes to milliseconds
        }
      } catch (error) {
        console.log(`⚠️ Could not fetch detailed daily uptime for ${userPrincipalId}, using basic field`);
      }

      // Try to get total uptime from weekly records
      let totalUptime = client.totalUptime; // Fallback to basic field
      try {
        const weeklyIndexKey = `${REDIS_KEYS.UPTIME_INDEX.USER_WEEKLY}${userPrincipalId}`;
        const weeklyRecordIds = await this.client.sMembers(weeklyIndexKey);
        
        if (weeklyRecordIds.length > 0) {
          let totalMinutes = 0;
          for (const recordId of weeklyRecordIds) {
            const weeklyRecordKey = `${REDIS_KEYS.UPTIME.WEEKLY}${recordId}`;
            const weeklyRecordData = await this.client.get(weeklyRecordKey);
            if (weeklyRecordData) {
              const weeklyRecord = JSON.parse(weeklyRecordData);
              totalMinutes += weeklyRecord.total_minutes;
            }
          }
          totalUptime = totalMinutes * 60 * 1000; // Convert minutes to milliseconds
        }
      } catch (error) {
        console.log(`⚠️ Could not fetch detailed total uptime for ${userPrincipalId}, using basic field`);
      }

      const stats: UptimeStats = {
        totalUptime,
        todayUptime,
        isCurrentlyOnline,
        currentSessionDuration
      };

      return { success: true, data: stats };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get uptime stats: ${error}` }
      };
    }
  }

  // Utility methods
  private async getNextClientId(): Promise<string> {
    const key = 'counter:client_id';
    const nextId = await this.client.incr(key);
    return nextId.toString();
  }

  private async generateJobId(): Promise<string> {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `job_${timestamp}_${random}`;
  }

  private async generateSessionId(): Promise<string> {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `session_${timestamp}_${random}`;
  }

  // API Key management
  async createAPIKey(userPrincipalId: string): Promise<EntityResult<APIKeyData>> {
    try {
      const apiKey = await this.generateAPIKey();
      const now = Date.now();
      
      const apiKeyData: APIKeyData = {
        apiKey,
        usageCount: 0,
        usageLimit: this.config.limits.usageLimit,
        usageLog: [{ timestamp: now }]
      };

      const key = `${REDIS_KEYS.API_KEY}${userPrincipalId}`;
      await this.client.set(key, JSON.stringify(apiKeyData));

      const reverseKey = `api_key_lookup:${apiKey}`;
      await this.client.set(reverseKey, userPrincipalId);

      return { success: true, data: apiKeyData };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to create API key: ${error}` }
      };
    }
  }

  async getAPIKey(userPrincipalId: string): Promise<EntityResult<APIKeyData>> {
    try {
      const key = `${REDIS_KEYS.API_KEY}${userPrincipalId}`;
      const data = await this.client.get(key);
      
      if (!data) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'API key not found' }
        };
      }

      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get API key: ${error}` }
      };
    }
  }

  async incrementAPIUsage(userPrincipalId: string): Promise<EntityResult<void>> {
    try {
      const result = await this.getAPIKey(userPrincipalId);
      if (!result.success) {
        return result;
      }

      const apiKeyData = result.data;
      const now = Date.now();
      
      const updatedAPIKeyData: APIKeyData = {
        ...apiKeyData,
        usageCount: apiKeyData.usageCount + 1,
        usageLog: [...apiKeyData.usageLog, { timestamp: now }]
      };

      const key = `${REDIS_KEYS.API_KEY}${userPrincipalId}`;
      await this.client.set(key, JSON.stringify(updatedAPIKeyData));

      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'UpdateFailed', message: `Failed to increment API usage: ${error}` }
      };
    }
  }

  async getUUIDFromAPIKey(apiKey: string): Promise<EntityResult<string>> {
    try {
      const reverseKey = `api_key_lookup:${apiKey}`;
      console.log(`🔍 Looking up UUID for API key with reverse key: ${reverseKey}`);
      
      const userPrincipalId = await this.client.get(reverseKey);
      
      if (!userPrincipalId) {
        console.log(`❌ No UUID found for API key: ${apiKey.substring(0, 8)}...`);
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'UUID not found for API key' }
        };
      }

      console.log(`✅ Found UUID for API key: ${userPrincipalId}`);
      return { success: true, data: userPrincipalId };
    } catch (error) {
      console.error(`❌ Error getting UUID from API key:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get UUID from API key: ${error}` }
      };
    }
  }

  private async generateAPIKey(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }

  async setFileMetadata(key: string, value: string): Promise<void> {
    await this.client.set(key, value);
  }

  async getFileMetadata(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async addFileToUserIndex(userKey: string, fileId: string): Promise<void> {
    await this.client.sAdd(userKey, fileId);
  }

  async addFileToJobIndex(jobKey: string, fileId: string): Promise<void> {
    await this.client.sAdd(jobKey, fileId);
  }

  async getFileIdsFromIndex(indexKey: string): Promise<string[]> {
    return await this.client.sMembers(indexKey);
  }

  async removeFileFromUserIndex(userKey: string, fileId: string): Promise<void> {
    await this.client.sRem(userKey, fileId);
  }

  async removeFileFromJobIndex(jobKey: string, fileId: string): Promise<void> {
    await this.client.sRem(jobKey, fileId);
  }

  async deleteFileMetadata(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incrementJobViews(jobId: string): Promise<EntityResult<void>> {
    try {
      const result = await this.getJob(jobId);
      if (!result.success) {
        return result;
      }

      const updatedJob = { ...result.data, job_views: result.data.job_views + 1 };
      const key = `${REDIS_KEYS.JOB}${jobId}`;
      await this.client.set(key, JSON.stringify(updatedJob));

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: { type: 'UpdateFailed', message: `Failed to increment job views: ${error}` }
      };
    }
  }

  async incrementJobDownloads(jobId: string): Promise<EntityResult<void>> {
    try {
      const result = await this.getJob(jobId);
      if (!result.success) {
        return result;
      }

      const updatedJob = { ...result.data, job_downloads: result.data.job_downloads + 1 };
      const key = `${REDIS_KEYS.JOB}${jobId}`;
      await this.client.set(key, JSON.stringify(updatedJob));

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: { type: 'UpdateFailed', message: `Failed to increment job downloads: ${error}` }
      };
    }
  }

  // Purchase operations
  async storePurchase(userPrincipalId: string, jobId: string): Promise<EntityResult<void>> {
    try {
      const purchaseKey = `${REDIS_KEYS.PURCHASE}${userPrincipalId}:${jobId}`;
      const purchaseData = {
        user_principal_id: userPrincipalId,
        job_id: jobId,
        purchased_at: Date.now()
      };
      
      await this.client.set(purchaseKey, JSON.stringify(purchaseData));
      
      // Add to user purchases index
      await this.client.sAdd(`${REDIS_KEYS.INDEX.PURCHASES_BY_USER}${userPrincipalId}`, jobId);
      
      // Add to job purchases index
      await this.client.sAdd(`${REDIS_KEYS.INDEX.PURCHASES_BY_JOB}${jobId}`, userPrincipalId);
      
      console.log(`✅ Purchase stored: user ${userPrincipalId} -> job ${jobId}`);
      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Error storing purchase:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to store purchase: ${error}` }
      };
    }
  }

  async hasPurchaseAccess(userPrincipalId: string, jobId: string): Promise<EntityResult<boolean>> {
    try {
      const purchaseKey = `${REDIS_KEYS.PURCHASE}${userPrincipalId}:${jobId}`;
      const purchaseData = await this.client.get(purchaseKey);
      
      const hasAccess = purchaseData !== null;
      console.log(`🔍 Purchase access check: user ${userPrincipalId} -> job ${jobId} = ${hasAccess}`);
      
      return { success: true, data: hasAccess };
    } catch (error) {
      console.error(`❌ Error checking purchase access:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to check purchase access: ${error}` }
      };
    }
  }

  async getUserPurchases(userPrincipalId: string): Promise<EntityResult<string[]>> {
    try {
      const jobIds = await this.client.sMembers(`${REDIS_KEYS.INDEX.PURCHASES_BY_USER}${userPrincipalId}`);
      console.log(`📊 Found ${jobIds.length} purchases for user: ${userPrincipalId}`);
      
      return { success: true, data: jobIds };
    } catch (error) {
      console.error(`❌ Error getting user purchases:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get user purchases: ${error}` }
      };
    }
  }

  // Job cleanup operations
  async deleteJob(jobId: string): Promise<EntityResult<void>> {
    try {
      console.log(`🗑️ Deleting job: ${jobId}`);
      
      // Get job data first to clean up indexes
      const jobResult = await this.getJob(jobId);
      if (!jobResult.success) {
        console.log(`⚠️ Job ${jobId} not found, skipping deletion`);
        return { success: true, data: undefined };
      }

      const job = jobResult.data;
      
      // Remove from main job key
      const key = `${REDIS_KEYS.JOB}${jobId}`;
      await this.client.del(key);
      console.log(`✅ Job ${jobId} deleted from main storage`);

      // Remove from state index
      await this.client.sRem(`${REDIS_KEYS.INDEX.JOBS_BY_STATE}${job.state}`, jobId);
      console.log(`✅ Job ${jobId} removed from state index: ${job.state}`);

      // Remove from user indexes
      if (job.clientUUID) {
        await this.client.sRem(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${job.clientUUID}`, jobId);
        console.log(`✅ Job ${jobId} removed from creator index: ${job.clientUUID}`);
      }
      
      if (job.user_principal_id) {
        await this.client.sRem(`${REDIS_KEYS.INDEX.JOBS_BY_USER}${job.user_principal_id}`, jobId);
        console.log(`✅ Job ${jobId} removed from assigned client index: ${job.user_principal_id}`);
      }

      // Remove from purchase indexes
      await this.client.sRem(`${REDIS_KEYS.INDEX.PURCHASES_BY_JOB}${jobId}`, '*');
      console.log(`✅ Job ${jobId} removed from purchase indexes`);

      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Error deleting job ${jobId}:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to delete job: ${error}` }
      };
    }
  }

  async getJobsCreatedBefore(timestamp: number): Promise<EntityResult<JobStruct[]>> {
    try {
      console.log(`🔍 Getting jobs created before: ${new Date(timestamp).toISOString()}`);
      
      const pattern = `${REDIS_KEYS.JOB}*`;
      const keys = await this.client.keys(pattern);
      
      if (keys.length === 0) {
        return { success: true, data: [] };
      }

      const jobs = await Promise.all(
        keys.map(async (key) => {
          const data = await this.client.get(key);
          if (!data) return null;
          
          const job = JSON.parse(data);
          // Check if job was created before the specified timestamp
          if (job.assignedAt && job.assignedAt < timestamp) {
            return job;
          }
          return null;
        })
      );

      const filteredJobs = jobs.filter((job): job is JobStruct => job !== null);
      console.log(`📊 Found ${filteredJobs.length} jobs created before ${new Date(timestamp).toISOString()}`);
      
      return { success: true, data: filteredJobs };
    } catch (error) {
      console.error(`❌ Error getting jobs created before ${timestamp}:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get jobs created before timestamp: ${error}` }
      };
    }
  }

  async cleanupOldJobs(cutoffTimestamp: number): Promise<EntityResult<{
    deletedCount: number;
    failedDeletions: string[];
    errors: string[];
  }>> {
    try {
      console.log(`🧹 Starting cleanup of jobs created before: ${new Date(cutoffTimestamp).toISOString()}`);
      
      // Get all jobs created before the cutoff
      const jobsResult = await this.getJobsCreatedBefore(cutoffTimestamp);
      if (!jobsResult.success) {
        return jobsResult;
      }

      const jobsToDelete = jobsResult.data;
      console.log(`📊 Found ${jobsToDelete.length} jobs to delete`);

      let deletedCount = 0;
      const failedDeletions: string[] = [];
      const errors: string[] = [];

      // Delete jobs in batches to avoid overwhelming Redis
      const batchSize = 10;
      for (let i = 0; i < jobsToDelete.length; i += batchSize) {
        const batch = jobsToDelete.slice(i, i + batchSize);
        
        console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(jobsToDelete.length / batchSize)} (${batch.length} jobs)`);
        
        const deletePromises = batch.map(async (job) => {
          const deleteResult = await this.deleteJob(job.jobID);
          if (deleteResult.success) {
            deletedCount++;
            console.log(`✅ Deleted job: ${job.jobID}`);
          } else {
            failedDeletions.push(job.jobID);
            errors.push(`Failed to delete job ${job.jobID}: ${deleteResult.error.message}`);
            console.error(`❌ Failed to delete job ${job.jobID}:`, deleteResult.error);
          }
        });

        await Promise.all(deletePromises);
        
        // Small delay between batches to avoid overwhelming Redis
        if (i + batchSize < jobsToDelete.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const result = {
        deletedCount,
        failedDeletions,
        errors
      };

      console.log(`🎉 Cleanup completed: ${deletedCount} jobs deleted, ${failedDeletions.length} failed`);
      
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Error during job cleanup:`, error);
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to cleanup old jobs: ${error}` }
      };
    }
  }

  // Get Redis client for direct access
  getRedisClient() {
    return this.client;
  }
}
