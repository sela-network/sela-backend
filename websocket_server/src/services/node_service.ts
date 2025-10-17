import { DatabaseService } from '../db/service';
import { FileService } from './file_service';
import { EntityResult, JobStruct, ClientStruct, JobCompletionResult } from '../db/types';
import { SimplifiedReward } from '../types';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';


export class NodeService extends EventEmitter {
  private databaseService: DatabaseService;
  private fileService: FileService;

  constructor(databaseService: DatabaseService, fileService: FileService) {
    super();
    this.databaseService = databaseService;
    this.fileService = fileService;
  }

  
  async getNodeServiceID(): Promise<string> {
    return "node-service-" + crypto.randomBytes(8).toString('hex');
  }

  
  async connectClient(userPrincipalId: string, clientId: string): Promise<EntityResult<string>> {
    return await this.databaseService.clientConnect(userPrincipalId, clientId);
  }

  
  async createWebSocketSession(userPrincipalId: string, clientId: string): Promise<EntityResult<string>> {
    try {
      const sessionId = await this.databaseService.wsCreateSession(userPrincipalId, clientId);
      return { success: true, data: sessionId };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to create WebSocket session: ${error}` }
      };
    }
  }

  
  async endWebSocketSession(userPrincipalId: string): Promise<EntityResult<void>> {
    return await this.databaseService.wsEndSession(userPrincipalId);
  }

 
  async updateHeartbeat(userPrincipalId: string): Promise<EntityResult<void>> {
    return await this.databaseService.wsUpdateHeartbeat(userPrincipalId);
  }

  
  async updateClientInternetSpeed(userPrincipalId: string, speedData: string): Promise<EntityResult<string>> {
    return await this.databaseService.updateClientInternetSpeed(userPrincipalId, speedData);
  }

  
  async updateClientStatus(userPrincipalId: string, statusData: { isActive: boolean; timestamp: number }): Promise<EntityResult<void>> {
    return await this.databaseService.updateClient(userPrincipalId, {
      clientStatus: statusData.isActive ? 'Active' : 'Inactive',
      pingTimestamp: statusData.timestamp
    });
  }

  
  async updateJobCompleted(jobId: string, clientId: string, storedFileId?: string | null): Promise<EntityResult<JobCompletionResult>> {
    return await this.databaseService.updateJobCompleted(jobId, clientId, storedFileId);
  }

  /**
   * Mark a job as failed and remove it from client's active jobs
   */
  async markJobAsFailed(jobId: string, clientId: string, errorMessage: string): Promise<EntityResult<string>> {
    return await this.databaseService.markJobAsFailed(jobId, clientId, errorMessage);
  }

  
  async findAndAssignJob(jobId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
    currentLoad: number;
    maxCapacity: number;
  } | null>> {
    const result = await this.databaseService.findOptimalNode(jobId);
    if (!result.success) {
      return {
        success: false,
        error: result.error
      };
    }
    
    if (!result.data) {
      return {
        success: true,
        data: null
      };
    }
    
    // Get client capacity info
    const capacityInfo = await this.databaseService.getClientCapacityInfo(result.data.user_principal_id);
    
    return {
      success: true,
      data: {
        ...result.data,
        currentLoad: capacityInfo.activeJobs,
        maxCapacity: capacityInfo.maxConcurrentJobs
      }
    };
  }

  
  async findAndAssignJobToClient(jobId: string, principalId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
    currentLoad: number;
    maxCapacity: number;
  } | null>> {
    const result = await this.databaseService.findOptimalNodeWithId(jobId, principalId);
    if (!result.success) {
      return {
        success: false,
        error: result.error
      };
    }
    
    if (!result.data) {
      return {
        success: true,
        data: null
      };
    }
    
    // Get client capacity info
    const capacityInfo = await this.databaseService.getClientCapacityInfo(result.data.user_principal_id);
    
    return {
      success: true,
      data: {
        ...result.data,
        currentLoad: capacityInfo.activeJobs,
        maxCapacity: capacityInfo.maxConcurrentJobs
      }
    };
  }

  
  async resendJob(jobId: string): Promise<EntityResult<{
    user_principal_id: string;
    client_id: string;
    downloadSpeed: number;
    target: string;
    jobType: string;
  } | null>> {
    return await this.databaseService.resendJob(jobId);
  }

  
  async createNewJob(clientUUID: string, jobType: string, url: string): Promise<EntityResult<string>> {
    return await this.databaseService.addJobToDB(clientUUID, jobType, url);
  }

  
  async assignJobToClient(userPrincipalId: string, clientId: string): Promise<EntityResult<string>> {
    return await this.databaseService.assignJobToClient(userPrincipalId.toString(), clientId);
  }

  
  async updateJobComplete(userPrincipalId: string, clientId: string, fileId: number): Promise<EntityResult<JobCompletionResult>> {
    return await this.databaseService.updateJobCompleted(fileId.toString(), clientId); // Reverted to original
  }

  
  async getStoredIdFromJobId(jobId: string): Promise<EntityResult<string>> {
    return await this.databaseService.getStoredIdFromJobId(jobId);
  }

  
  async handleRequestAuth(userPrincipalId: string): Promise<EntityResult<string>> {
    return await this.databaseService.clientAuthorization(userPrincipalId);
  }

  
  async login(userPrincipalId: string): Promise<EntityResult<ClientStruct>> {
    return await this.databaseService.login(userPrincipalId);
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
    return await this.databaseService.getUserRewardHistory(userPrincipalId, page, limit);
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
    return await this.databaseService.getUserRewardHistoryByDate(userPrincipalId, startDate, endDate);
  }

 
  async getAllJobs(clientUUID: string): Promise<EntityResult<JobStruct[]>> {
    return await this.databaseService.getAllJobs(clientUUID);
  }

  
  async getPendingJobs(clientUUID: string): Promise<EntityResult<JobStruct[]>> {
    return await this.databaseService.getAllPendingJobs(clientUUID);
  }

  
  async getJobWithId(jobId: string): Promise<EntityResult<JobStruct>> {
    return await this.databaseService.getJobWithID(jobId);
  }

  
  async updateJobPricingInfo(jobId: string, pricingInfo: {
    price: number;
    objectsCount: number;
    fileSizeKB: number;
    dataAnalysis?: { dataCount: number; included: string[] };
  }): Promise<EntityResult<void>> {
    return await this.databaseService.updateJobPricingInfo(jobId, pricingInfo);
  }


  async getAllNodes(): Promise<EntityResult<ClientStruct[]>> {
    return await this.databaseService.getAllNodes();
  }


  async getAllRunningNodes(): Promise<EntityResult<ClientStruct[]>> {
    return await this.databaseService.getAllRunningNodes();
  }


  async addRewardsToDB(principalId: string, rewards: number): Promise<EntityResult<number>> {
    return await this.databaseService.addRewardsToDB(principalId, rewards);
  }




  async checkAuth(userPrincipalId: string): Promise<EntityResult<string>> {
    return await this.databaseService.clientAuthorization(userPrincipalId);
  }


  async backendHealthCheck(): Promise<string> {
    return "OK";
  }


  async getUptimeStats(userPrincipalId: string): Promise<EntityResult<any>> {
    return await this.databaseService.wsGetUptimeStats(userPrincipalId);
  }

  // Get database instance for direct access
  getDatabase() {
    return this.databaseService;
  }


  getStats(): {
    name: string;
    features: string[];
  } {
    return {
      name: "Node Service",
      features: [
        "Job assignment and processing",
        "File storage and retrieval",
        "Authentication and authorization",
        "Client management",
        "Database operations",
        "Business logic coordination"
      ]
    };
  }
}
