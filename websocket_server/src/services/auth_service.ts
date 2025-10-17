import { DatabaseService } from '../db/service';
import { EntityResult } from '../db/types';

/**
 * Authentication service equivalent to the original canister's requestAuth functionality
 */
export class AuthService {
  private databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
  }

  /**
   * Equivalent to requestAuth() from the original canister
   * Validates if a user principal ID is authorized to perform operations
   */
  async requestAuth(userPrincipalId: string): Promise<boolean> {
    try {
      console.log(`🔐 Authentication request for user: ${userPrincipalId}`);

      // Check if client exists and is active
      const clientResult = await this.databaseService.clientAuthorization(userPrincipalId);
      
      if (!clientResult.success) {
        console.log(`❌ Authentication failed for ${userPrincipalId}: ${clientResult.error.message}`);
        return false;
      }
      
      console.log(`✅ Authentication successful for ${userPrincipalId}`);
      return true;
    } catch (error) {
      console.error(`❌ Authentication error for ${userPrincipalId}:`, error);
      return false;
    }
  }

  /**
   * Validate API key and get associated user principal ID
   */
  async validateApiKey(apiKey: string): Promise<EntityResult<string>> {
    try {
      console.log(`🔑 Validating API key: ${apiKey.substring(0, 8)}...`);
      
      const uuidResult = await this.databaseService.getUUIDFromAPIKey(apiKey);
      if (!uuidResult.success) {
        console.log(`❌ Failed to get UUID from API key: ${uuidResult.error.message}`);
        return {
          success: false,
          error: { type: 'InvalidInput', message: 'Invalid API key' }
        };
      }

      console.log(`✅ Found UUID for API key: ${uuidResult.data}`);

      // Verify the user is still authorized
      const authResult = await this.requestAuth(uuidResult.data);
      if (!authResult) {
        console.log(`❌ User authorization failed for UUID: ${uuidResult.data}`);
        return {
          success: false,
          error: { type: 'InvalidInput', message: 'User not authorized' }
        };
      }

      console.log(`✅ API key validation successful for UUID: ${uuidResult.data}`);
      return { success: true, data: uuidResult.data };
    } catch (error) {
      console.error(`❌ API key validation error:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `API key validation failed: ${error}` }
      };
    }
  }

  /**
   * Check if user has reached rate limits
   */
  async checkRateLimit(userPrincipalId: string): Promise<boolean> {
    try {
      const apiKeyResult = await this.databaseService.getAPIKeyData(userPrincipalId);
      if (!apiKeyResult.success) {
        return false;
      }

      const { usageCount, usageLimit } = apiKeyResult.data;
      
      if (usageCount >= usageLimit) {
        console.log(`Rate limit exceeded for user ${userPrincipalId}: ${usageCount}/${usageLimit}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Rate limit check failed for ${userPrincipalId}:`, error);
      return false;
    }
  }

  /**
   * Record API usage for rate limiting
   */
  async recordApiUsage(userPrincipalId: string): Promise<boolean> {
    try {
      return await this.databaseService.recordAPIUsage(userPrincipalId);
    } catch (error) {
      console.error(`Failed to record API usage for ${userPrincipalId}:`, error);
      return false;
    }
  }
}
