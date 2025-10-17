import { DatabaseService } from '../db/service';
import { ClientStruct, ClientStatus } from '../db/types';
import { jobQueueManager } from './job_queue_manager';

/**
 * ClientCapacityService provides high-level operations for managing
 * client capacity, load balancing, and performance optimization
 */
export class ClientCapacityService {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  /**
   * Get recommended capacity for a client based on performance metrics
   */
  async getRecommendedCapacity(userPrincipalId: string): Promise<{
    current: number;
    recommended: number;
    factors: {
      downloadSpeed: number;
      ping: number;
      historical_performance?: number;
      current_load?: number;
    };
  }> {
    try {
      const capacityInfo = await this.dbService.getClientCapacityInfo(userPrincipalId);
      const clientResult = await this.dbService.getAllNodes();
      
      if (!clientResult.success) {
        throw new Error('Failed to get client information');
      }

      const client = clientResult.data.find(c => c.user_principal_id === userPrincipalId);
      if (!client) {
        throw new Error('Client not found');
      }

      // Factors for recommendation
      const downloadSpeed = client.downloadSpeed || 0;
      const ping = client.ping || 100;
      const currentCapacity = capacityInfo.maxConcurrentJobs;
      const currentUtilization = capacityInfo.utilizationRate;

      let recommendedCapacity = currentCapacity;

      return {
        current: currentCapacity,
        recommended: recommendedCapacity,
        factors: {
          downloadSpeed,
          ping,
          current_load: currentUtilization
        }
      };
    } catch (error) {
      console.error(`Error getting recommended capacity for ${userPrincipalId}:`, error);
      return {
        current: 3,
        recommended: 3,
        factors: {
          downloadSpeed: 0,
          ping: 100
        }
      };
    }
  }


}

export default ClientCapacityService;


