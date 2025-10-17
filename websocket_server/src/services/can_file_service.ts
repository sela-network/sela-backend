import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { FileMetadata, EntityResult } from "../db/types";
import { createCanFileStorageActor, ICanFileStorage } from "../canister/can_file_storage_interface";

// Canister interface types
interface CanFileMetadata {
  name: string;
  content_type: string;
  size: number;
  user_principal_id: string;
  job_id: string;
  created_at: bigint;
  original_file_id: string;
}

interface CanFileRecord {
  content: number[];
  metadata: CanFileMetadata;
  success: boolean;
}

interface CanStorageStats {
  total_files: bigint;
  total_size: bigint;
}

interface CanHealthCheck {
  status: string;
  timestamp: bigint;
}


export class CanFileService {
  private canisterId: string;
  private agent: HttpAgent;
  private canister: ICanFileStorage;

  constructor(canisterId: string, identity: any) {
    this.canisterId = canisterId;
    this.agent = new HttpAgent({ 
      identity,
      host: process.env.IC_URL || "https://ic0.app"
    });
    
    // Create actor with the canister interface
    this.canister = createCanFileStorageActor(canisterId, this.agent);
  }


  async storeFile(content: Buffer, metadata: FileMetadata, customKey?: string): Promise<EntityResult<string>> {
    try {
      const fileKey = customKey || metadata.name;
      console.log(`🔄 Storing file in canister: ${fileKey}`);
      
      const canMetadata: CanFileMetadata = {
        name: metadata.name,
        content_type: metadata.content_type,
        size: metadata.size,
        user_principal_id: metadata.user_principal_id,
        job_id: metadata.job_id,
        created_at: BigInt(metadata.created_at),
        original_file_id: metadata.id
      };

      // Convert Buffer to string for canister (much simpler!)
      const contentString = content.toString('utf8');
      
      const result = await this.canister.store_file(
        fileKey, // Use custom key or filename
        contentString, // Pass as string instead of binary
        canMetadata
      );

      if (result.success) {
        console.log(`✅ File stored in canister: ${result.file_key}`);
        return { success: true, data: result.file_key };
      } else {
        console.error(`❌ Failed to store file in canister: ${fileKey}`);
        return {
          success: false,
          error: { type: 'CanisterError', message: 'Failed to store file in canister' }
        };
      }
    } catch (error) {
      console.error(`❌ Canister store error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Failed to store file: ${error}` }
      };
    }
  }

  async retrieveFile(fileKey: string): Promise<EntityResult<Buffer>> {
    try {
      console.log(`🔄 Retrieving file from canister: ${fileKey}`);
      
      const result = await this.canister.get_file(fileKey);
      
      if (result.success) {
        console.log(`✅ File retrieved from canister: ${fileKey}`);
        // Convert string back to Buffer
        return { success: true, data: Buffer.from(result.content, 'utf8') };
      } else {
        console.error(`❌ Failed to retrieve file from canister: ${fileKey}`);
        return {
          success: false,
          error: { type: 'NotFound', message: 'File not found in canister' }
        };
      }
    } catch (error) {
      console.error(`❌ Canister retrieve error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Failed to retrieve file: ${error}` }
      };
    }
  }


  async listFilesByUser(userPrincipalId: string): Promise<EntityResult<string[]>> {
    try {
      console.log(`🔄 Listing files by user from canister: ${userPrincipalId}`);
      
      const result = await this.canister.list_files_by_user(userPrincipalId);
      
      console.log(`✅ Listed ${result.length} files for user: ${userPrincipalId}`);
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Canister list files by user error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Failed to list files by user: ${error}` }
      };
    }
  }

  async listFilesByJob(jobId: string): Promise<EntityResult<string[]>> {
    try {
      console.log(`🔄 Listing files by job from canister: ${jobId}`);
      
      const result = await this.canister.list_files_by_job(jobId);
      
      console.log(`✅ Listed ${result.length} files for job: ${jobId}`);
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Canister list files by job error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Failed to list files by job: ${error}` }
      };
    }
  }

  async getFileInfo(fileKey: string): Promise<EntityResult<FileMetadata>> {
    try {
      console.log(`🔄 Getting file info from canister: ${fileKey}`);
      
      const result = await this.canister.get_file_info(fileKey);
      
      if (result) {
        const fileMetadata: FileMetadata = {
          id: result.original_file_id,
          name: result.name,
          content_type: result.content_type,
          size: result.size,
          created_at: Number(result.created_at),
          updated_at: Number(result.created_at),
          user_principal_id: result.user_principal_id,
          job_id: result.job_id,
          file_path: `canister:${fileKey}`,
          canister_file_key: fileKey,
          storage_strategy: 'canister'
        };
        
        console.log(`✅ File info retrieved from canister: ${fileKey}`);
        return { success: true, data: fileMetadata };
      } else {
        console.error(`❌ File info not found in canister: ${fileKey}`);
        return {
          success: false,
          error: { type: 'NotFound', message: 'File info not found in canister' }
        };
      }
    } catch (error) {
      console.error(`❌ Canister get file info error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Failed to get file info: ${error}` }
      };
    }
  }

  async getStorageStats(): Promise<EntityResult<{ total_files: number; total_size: number }>> {
    try {
      console.log(`🔄 Getting storage stats from canister`);
      
      const result = await this.canister.get_storage_stats();
      
      const stats = {
        total_files: Number(result.total_files),
        total_size: Number(result.total_size)
      };
      
      console.log(`✅ Storage stats retrieved: ${stats.total_files} files, ${stats.total_size} bytes`);
      return { success: true, data: stats };
    } catch (error) {
      console.error(`❌ Canister storage stats error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Failed to get storage stats: ${error}` }
      };
    }
  }

  async healthCheck(): Promise<EntityResult<{ status: string; timestamp: number }>> {
    try {
      console.log(`🔄 Health check from canister`);
      
      const result = await this.canister.health_check();
      
      const health = {
        status: result.status,
        timestamp: Number(result.timestamp)
      };
      
      console.log(`✅ Canister health check: ${health.status}`);
      return { success: true, data: health };
    } catch (error) {
      console.error(`❌ Canister health check error:`, error);
      return {
        success: false,
        error: { type: 'CanisterError', message: `Health check failed: ${error}` }
      };
    }
  }

}