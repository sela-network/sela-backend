import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Database } from '../db/database';
import { 
  FileMetadata, 
  FileUploadRequest, 
  FileChunkRequest, 
  FileListRequest, 
  FileDownloadRequest,
  EntityResult,
  REDIS_KEYS 
} from '../db/types';
import { resolveFilePathWithFallback } from '../utils/file_utils';
import { CanDualStorageManager } from './can_dual_storage_manager';
import { CanFileService } from './can_file_service';
import { CanFileSyncService } from './can_file_sync_service';
import { DEFAULT_CAN_STORAGE_CONFIG } from '../config/can_storage_config';
import { BlockchainService } from './blockchain_service';

export class FileService {
  private db: Database;
  private baseDataPath: string;
  private dualStorageManager: CanDualStorageManager | null = null;
  private canFileService: CanFileService | null = null;
  private syncService: CanFileSyncService | null = null;
  private useDualStorage: boolean;

  constructor(db: Database, baseDataPath?: string) {
    this.db = db;
    this.baseDataPath = baseDataPath || process.env.DATA_PATH || './data/redis';
    this.useDualStorage = process.env.CANISTER_STORAGE_ENABLED === 'true';
    
    // Dual storage is now enabled with proper interface
    console.log('✅ Dual storage enabled with canister integration');
    
    if (this.useDualStorage) {
      this.initializeDualStorage();
    }
  }

  private initializeDualStorage(): void {
    try {
      const canisterId = process.env.FILE_STORAGE_CANISTER_ID;
      if (!canisterId) {
        console.warn('⚠️ Canister storage enabled but FILE_STORAGE_CANISTER_ID not set');
        return;
      }

      // Create canister service with controller identity
      const identity = this.getIdentity();
      this.canFileService = new CanFileService(canisterId, identity);
      
      // Create dual storage manager
      this.dualStorageManager = new CanDualStorageManager(
        this,
        this.canFileService,
        this.db,
        DEFAULT_CAN_STORAGE_CONFIG
      );

      // Create sync service
      this.syncService = new CanFileSyncService(this.dualStorageManager);
      this.syncService.startSyncService();

      console.log('✅ Dual storage system initialized with canister support');
    } catch (error) {
      console.error('❌ Failed to initialize dual storage:', error);
      this.useDualStorage = false;
    }
  }

  async createFile(request: FileUploadRequest): Promise<EntityResult<FileMetadata>> {
    try {
      console.log(`🔍 createFile called with:`, request);
      const fileId = await this.generateFileId();
      const now = Date.now();
      
      console.log(`🔍 Generated file ID: ${fileId}`);
      
      // Create directory structure: data/redis/{principal_id}/{job_id}/
      const fileDir = path.join(this.baseDataPath, request.user_principal_id, request.job_id);
      console.log(`🔍 Creating directory: ${fileDir}`);
      
      await fs.mkdir(fileDir, { recursive: true });
      console.log(`✅ Directory created successfully`);

      const filePath = path.join(fileDir, request.name);
      console.log(`🔍 File path: ${filePath}`);
      
      const fileMetadata: FileMetadata = {
        id: fileId,
        name: request.name,
        content_type: request.content_type,
        size: request.size,
        created_at: now,
        updated_at: now,
        user_principal_id: request.user_principal_id,
        job_id: request.job_id,
        file_path: filePath,
        hash: undefined
      };

      const key = `${REDIS_KEYS.FILE}${fileId}`;
      console.log(`🔍 Setting file metadata with key: ${key}`);
      await this.db.setFileMetadata(key, JSON.stringify(fileMetadata));
      console.log(`✅ File metadata set successfully`);

      console.log(`🔍 Adding file to user index: ${request.user_principal_id}`);
      await this.db.addFileToUserIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_USER}${request.user_principal_id}`, 
        fileId
      );
      console.log(`✅ File added to user index`);

      console.log(`🔍 Adding file to job index: ${request.job_id}`);
      await this.db.addFileToJobIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_JOB}${request.job_id}`, 
        fileId
      );
      console.log(`✅ File added to job index`);

      return { success: true, data: fileMetadata };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to create file: ${error}` }
      };
    }
  }

  async uploadChunk(request: FileChunkRequest): Promise<EntityResult<void>> {
    try {
      const fileResult = await this.getFile(request.file_id);
      if (!fileResult.success) {
        return fileResult;
      }

      const file = fileResult.data;
      
      if (file.user_principal_id !== request.user_principal_id) {
        return { 
          success: false, 
          error: { type: 'InvalidInput', message: 'Unauthorized access to file' }
        };
      }

      const chunkPath = path.join(
        path.dirname(file.file_path), 
        `${file.id}_chunk_${request.chunk_index}`
      );

      await fs.writeFile(chunkPath, request.chunk_data);

      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to upload chunk: ${error}` }
      };
    }
  }

  async completeFileUpload(fileId: string, userPrincipalId: string): Promise<EntityResult<void>> {
    try {
      const fileResult = await this.getFile(fileId);
      if (!fileResult.success) {
        return fileResult;
      }

      const file = fileResult.data;
      
      if (file.user_principal_id !== userPrincipalId) {
        return { 
          success: false, 
          error: { type: 'InvalidInput', message: 'Unauthorized access to file' }
        };
      }

      const fileDir = path.dirname(file.file_path);
      const chunkFiles = await fs.readdir(fileDir);
      const fileChunks = chunkFiles
        .filter(name => name.startsWith(`${file.id}_chunk_`))
        .sort((a, b) => {
          const aIndex = parseInt(a.split('_chunk_')[1]);
          const bIndex = parseInt(b.split('_chunk_')[1]);
          return aIndex - bIndex;
        });

      const finalFile = await fs.open(file.file_path, 'w');
      
      for (const chunkName of fileChunks) {
        const chunkPath = path.join(fileDir, chunkName);
        const chunkData = await fs.readFile(chunkPath);
        await finalFile.write(chunkData);
        
        await fs.unlink(chunkPath);
      }
      
      await finalFile.close();

      const fileBuffer = await fs.readFile(file.file_path);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const updatedMetadata = { ...file, hash, updated_at: Date.now() };
      const key = `${REDIS_KEYS.FILE}${fileId}`;
      await this.db.setFileMetadata(key, JSON.stringify(updatedMetadata));

      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to complete file upload: ${error}` }
      };
    }
  }

  async getFile(fileId: string): Promise<EntityResult<FileMetadata>> {
    try {
      const key = `${REDIS_KEYS.FILE}${fileId}`;
      const data = await this.db.getFileMetadata(key);
      
      if (!data) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: 'File not found' }
        };
      }

      return { success: true, data: JSON.parse(data) };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get file: ${error}` }
      };
    }
  }

  /**
   * Get file content from LOCAL storage ONLY (bypasses dual storage to prevent infinite recursion)
   * Used internally by DualStorageManager
   */
  async getFileContentLocalOnly(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    try {
      const fileResult = await this.getFile(fileId);
      if (!fileResult.success) {
        return fileResult;
      }

      const file = fileResult.data;
      
      if (file.user_principal_id !== userPrincipalId) {
        return { 
          success: false, 
          error: { type: 'InvalidInput', message: 'Unauthorized access to file' }
        };
      }

      // Use utility function to resolve file path with fallback
      const resolutionResult = await resolveFilePathWithFallback(
        file.file_path,
        file,
        fileId,
        this.db
      );

      if (!resolutionResult.success) {
        return { 
          success: false, 
          error: { type: 'NotFound', message: resolutionResult.error || 'File not found on disk' }
        };
      }

      const fileContent = await fs.readFile(resolutionResult.filePath!);
      return { success: true, data: fileContent };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'StorageError', message: `Failed to read file content from local storage: ${error}` }
      };
    }
  }

  async getFileContent(fileId: string, userPrincipalId: string): Promise<EntityResult<Buffer>> {
    try {
      // Use dual storage if available, otherwise fall back to local-only
      if (this.useDualStorage && this.dualStorageManager) {
        console.log(`🔄 Using dual storage retrieval for file: ${fileId}`);
        return await this.dualStorageManager.retrieveFile(fileId, userPrincipalId);
      }

      // Fallback to local-only retrieval
      return await this.getFileContentLocalOnly(fileId, userPrincipalId);
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to get file content: ${error}` }
      };
    }
  }

  async listFiles(request: FileListRequest): Promise<EntityResult<FileMetadata[]>> {
    try {
      let fileIds: string[];
      
      if (request.job_id) {
        fileIds = await this.db.getFileIdsFromIndex(
          `${REDIS_KEYS.INDEX.FILES_BY_JOB}${request.job_id}`
        );
      } else {
        fileIds = await this.db.getFileIdsFromIndex(
          `${REDIS_KEYS.INDEX.FILES_BY_USER}${request.user_principal_id}`
        );
      }

      if (fileIds.length === 0) {
        return { success: true, data: [] };
      }

      let startIndex = 0;
      if (request.start_id) {
        const startIndexFound = fileIds.indexOf(request.start_id);
        if (startIndexFound !== -1) {
          startIndex = startIndexFound + 1;
        }
      }

      const endIndex = request.limit ? startIndex + request.limit : fileIds.length;
      const paginatedIds = fileIds.slice(startIndex, endIndex);

      const files = await Promise.all(
        paginatedIds.map(async (fileId) => {
          const result = await this.getFile(fileId);
          return result.success ? result.data : null;
        })
      );

      const validFiles = files.filter((file): file is FileMetadata => file !== null);
      return { success: true, data: validFiles };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to list files: ${error}` }
      };
    }
  }

  async deleteFile(fileId: string, userPrincipalId: string): Promise<EntityResult<void>> {
    try {
      const fileResult = await this.getFile(fileId);
      if (!fileResult.success) {
        return fileResult;
      }

      const file = fileResult.data;
      
      if (file.user_principal_id !== userPrincipalId) {
        return { 
          success: false, 
          error: { type: 'InvalidInput', message: 'Unauthorized access to file' }
        };
      }

      try {
        await fs.unlink(file.file_path);
      } catch (error) {
        console.warn(`File not found on disk: ${file.file_path}`);
      }

      const key = `${REDIS_KEYS.FILE}${fileId}`;
      await this.db.deleteFileMetadata(key);

      await this.db.removeFileFromUserIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_USER}${file.user_principal_id}`, 
        fileId
      );
      await this.db.removeFileFromJobIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_JOB}${file.job_id}`, 
        fileId
      );

      return { success: true, data: undefined };
    } catch (error) {
      return { 
        success: false, 
        error: { type: 'DatabaseError', message: `Failed to delete file: ${error}` }
      };
    }
  }

  async writeFileData(filePath: string, data: Buffer): Promise<void> {
    await fs.writeFile(filePath, data);
  }

 
  async createFileFromJobResult(jobResult: any): Promise<EntityResult<FileMetadata>> {
    try {
      console.log(`🔍 createFileFromJobResult called with:`, jobResult);
      const { jobId, content, contentType, fileName, userPrincipalId } = jobResult;
      
      console.log(`🔍 Extracted values: jobId=${jobId}, contentType=${contentType}, fileName=${fileName}, userPrincipalId=${userPrincipalId}`);
      
      if (!jobId || !content) {
        console.log(`❌ Validation failed: jobId=${jobId}, content exists=${!!content}`);
        return {
          success: false,
          error: { type: 'InvalidInput', message: 'Missing jobId or content in job result' }
        };
      }

      // Get job information to determine the appropriate content type and file extension
      const jobData = await this.db.getJob(jobId);
      let finalContentType = contentType || 'application/json';
      let fileExtension = 'json';

      if (jobData.success) {
        const job = jobData.data;
        console.log(`🔍 Retrieved job info: jobType=${job.jobType}, target=${job.target}`);
        
        // Determine content type and extension based on job type
        if (job.jobType === 'HTML') {
          finalContentType = 'text/html';
          fileExtension = 'html';
          console.log(`📄 HTML job detected - saving as HTML file`);
        } else {
          finalContentType = 'application/json';
          fileExtension = 'json';
          console.log(`📄 Non-HTML job (${job.jobType}) - saving as JSON file`);
        }
      } else {
        console.warn(`⚠️ Could not retrieve job info for ${jobId}, using default JSON format`);
      }

      // For HTML content, preserve string format; for JSON, ensure proper formatting
      let contentToStore;
      if (finalContentType === 'text/html' && typeof content === 'string') {
        contentToStore = content;
      } else if (typeof content === 'string') {
        contentToStore = content;
      } else {
        contentToStore = JSON.stringify(content, null, 2);
      }
      
      const contentBuffer = Buffer.from(contentToStore, 'utf8');

      // Keep original filename structure, only change extension if not provided
      let finalFileName;
      if (fileName) {
        finalFileName = fileName;
      } else {
        finalFileName = `scrape_result_${jobId}.${fileExtension}`;
      }

      // Use provided userPrincipalId or get from job lookup
      let finalUserPrincipalId = userPrincipalId;
      if (!finalUserPrincipalId) {
        // Fallback: Get job data to find the worker's principal ID
        if (jobData.success) {
          finalUserPrincipalId = jobData.data.user_principal_id || 'unknown_user';
        } else {
          const jobKey = `job:${jobId}`;
          const jobMetadata = await this.db.getFileMetadata(jobKey);
          if (jobMetadata) {
            const job = JSON.parse(jobMetadata);
            finalUserPrincipalId = job.user_principal_id || 'unknown_user';
          } else {
            finalUserPrincipalId = 'unknown_user';
          }
        }
      } 

      const createFileRequest: FileUploadRequest = {
        name: finalFileName,
        content_type: finalContentType,
        size: contentBuffer.length,
        user_principal_id: finalUserPrincipalId,
        job_id: jobId
      };

      console.log(`🔍 Creating file with request:`, createFileRequest);
      console.log(`🔍 Base data path: ${this.baseDataPath}`);

      // Use dual storage if available, otherwise fall back to local-only
      if (this.useDualStorage && this.dualStorageManager) {
        console.log(`🔄 Using dual storage for file: ${finalFileName}`);
        const dualResult = await this.dualStorageManager.storeFile(createFileRequest, contentBuffer);
        
        if (dualResult.success) {
          console.log(`✅ File stored in dual storage: ${dualResult.data.id}`);
          return dualResult;
        } else {
          console.warn(`⚠️ Dual storage failed, falling back to local storage:`, dualResult.error);
        }
      }

      // Fallback to local-only storage
      const fileResult = await this.createFile(createFileRequest);
      if (!fileResult.success) {
        console.log(`❌ File creation failed:`, fileResult.error);
        return fileResult;
      }

      console.log(`✅ File created successfully:`, fileResult.data);

      await this.writeFileData(fileResult.data.file_path, contentBuffer);

      const hash = crypto.createHash('sha256').update(contentBuffer).digest('hex');
      const updatedMetadata = { ...fileResult.data, hash, updated_at: Date.now() };
      
      const key = `${REDIS_KEYS.FILE}${fileResult.data.id}`;
      await this.db.setFileMetadata(key, JSON.stringify(updatedMetadata));

      console.log(`📁 Created file for job ${jobId}: ${fileResult.data.id}`);
      return { success: true, data: updatedMetadata };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to create file from job result: ${error}` }
      };
    }
  }

 
  async getFileContentByStoredId(fileId: string): Promise<EntityResult<string>> {
    try {
      console.log(`📄 Getting file content for file ID: ${fileId}`);
      
      const fileResult = await this.getFile(fileId);
      if (!fileResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: `File with ID ${fileId} not found` }
        };
      }

      // Use dual storage retrieval if available
      if (this.useDualStorage && this.dualStorageManager) {
        console.log(`🔄 Using dual storage retrieval for stored ID: ${fileId}`);
        const contentResult = await this.dualStorageManager.retrieveFile(fileId, fileResult.data.user_principal_id);
        if (contentResult.success) {
          const content = contentResult.data.toString('utf8');
          return { success: true, data: content };
        }
      }

      // Fallback to local retrieval
      const contentResult = await this.getFileContent(fileId, fileResult.data.user_principal_id);
      if (!contentResult.success) {
        return contentResult;
      }

      const content = contentResult.data.toString('utf8');
      return { success: true, data: content };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get file content by file ID: ${error}` }
      };
    }
  }


  async downloadFileByStoredId(fileId: string): Promise<EntityResult<{ filePath: string; metadata: FileMetadata }>> {
    try {
      console.log(`💾 Downloading file for file ID: ${fileId}`);
      
      const fileResult = await this.getFile(fileId);
      if (!fileResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: `File with ID ${fileId} not found` }
        };
      }

      // Use dual storage retrieval if available
      if (this.useDualStorage && this.dualStorageManager) {
        console.log(`🔄 Using dual storage download for stored ID: ${fileId}`);
        const contentResult = await this.dualStorageManager.retrieveFile(fileId, fileResult.data.user_principal_id);
        if (contentResult.success) {
          // For dual storage, we return the metadata and indicate it's from canister
          return { 
            success: true, 
            data: { 
              filePath: `canister:${fileResult.data.canister_file_key || fileResult.data.name}`, 
              metadata: fileResult.data 
            } 
          };
        }
      }

      // Fallback to local file resolution
      const resolutionResult = await resolveFilePathWithFallback(
        fileResult.data.file_path,
        fileResult.data,
        fileId,
        this.db
      );

      if (!resolutionResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: resolutionResult.error || 'File not found on disk and no alternatives found' }
        };
      }

      return { 
        success: true, 
        data: { 
          filePath: resolutionResult.filePath!, 
          metadata: resolutionResult.updatedMetadata! 
        } 
      };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to download file by file ID: ${error}` }
      };
    }
  }


  async storeJobResultAndGetId(jobId: string, resultData: any, userPrincipalId: string): Promise<EntityResult<number>> {
    try {
      // Get job information to determine the appropriate content type and file extension
      const jobData = await this.db.getJob(jobId);
      let contentType = 'application/json';
      let fileExtension = 'json';

      if (jobData.success) {
        const job = jobData.data;
        // Determine content type and extension based on job type
        if (job.jobType === 'HTML') {
          contentType = 'text/html';
          fileExtension = 'html';
        } else {
          contentType = 'application/json';
          fileExtension = 'json';
        }
      }

      const fileName = `job_${jobId}_result_${Date.now()}.${fileExtension}`;
      
      // For HTML content, don't JSON.stringify if it's already a string
      let contentToStore;
      if (contentType === 'text/html' && typeof resultData === 'string') {
        contentToStore = resultData;
      } else {
        contentToStore = JSON.stringify(resultData, null, 2);
      }
      
      const contentBuffer = Buffer.from(contentToStore, 'utf8');

      const createFileRequest: FileUploadRequest = {
        name: fileName,
        content_type: contentType,
        size: contentBuffer.length,
        user_principal_id: userPrincipalId,
        job_id: jobId
      };

      const fileResult = await this.createFile(createFileRequest);
      if (!fileResult.success) {
        return fileResult;
      }

      await this.writeFileData(fileResult.data.file_path, contentBuffer);

      const hash = crypto.createHash('sha256').update(contentBuffer).digest('hex');
      const updatedMetadata = { ...fileResult.data, hash, updated_at: Date.now() };
      
      const key = `${REDIS_KEYS.FILE}${fileResult.data.id}`;
      await this.db.setFileMetadata(key, JSON.stringify(updatedMetadata));

      const storedId = fileResult.data.created_at;
      
      console.log(`💾 Stored job result for ${jobId} with stored ID: ${storedId}`);
      return { success: true, data: storedId };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to store job result: ${error}` }
      };
    }
  }

  
  async getFilesByJobId(jobId: string): Promise<EntityResult<FileMetadata[]>> {
    try {
      const fileIds = await this.db.getFileIdsFromIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_JOB}${jobId}`
      );

      if (fileIds.length === 0) {
        return { success: true, data: [] };
      }

      const files = await Promise.all(
        fileIds.map(async (fileId) => {
          const result = await this.getFile(fileId);
          return result.success ? result.data : null;
        })
      );

      const validFiles = files.filter((file): file is FileMetadata => file !== null);
      return { success: true, data: validFiles };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get files by job ID: ${error}` }
      };
    }
  }

  
  async cleanupOldFiles(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<EntityResult<number>> {
    try {
      const cutoffTime = Date.now() - olderThanMs;
      let deletedCount = 0;

      console.log(`Starting cleanup of files older than ${new Date(cutoffTime).toISOString()}`);
      
      // TODO: Implement efficient cleanup logic      
      return { success: true, data: deletedCount };
    } catch (error) {
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to cleanup old files: ${error}` }
      };
    }
  }

  private async generateFileId(): Promise<string> {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `file_${timestamp}_${random}`;
  }

  /**
   * Get controller identity from BlockchainService
   */
  private async getIdentity() {
    try {
      const blockchainService = new BlockchainService();
      return blockchainService.getControllerIdentity();
    } catch (error) {
      console.error('Failed to get identity from BlockchainService:', error);
      return null;
    }
  }
}
