import { Database } from '../db/database';
import { FileService } from './file_service';
import { DatabaseService } from '../db/service';
import { 
  JobStruct, 
  FileMetadata, 
  EntityResult, 
  JobState,
  REDIS_KEYS 
} from '../db/types';

export interface MarketplaceJob {
  job_id: string;
  job_type: string;
  target: string;
  job_views: number;
  job_downloads: number;
  completeAt: number;
}

export interface JobDetails {
  job: JobStruct;
  fileMetadata?: FileMetadata;
  filePreview?: string;
  fileContent?: string;
  dataCount?: number;
  included?: string[];
}

export class MarketplaceService {
  private db: Database;
  private fileService: FileService;
  private dbService: DatabaseService;
  private jobDetailsCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(db: Database, fileService: FileService, dbService: DatabaseService) {
    this.db = db;
    this.fileService = fileService;
    this.dbService = dbService;
  }

  /**
   * Get cached job details if available and not expired
   */
  private getCachedJobDetails(jobId: string): any | null {
    const cached = this.jobDetailsCache.get(jobId);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      console.log(`📦 Using cached job details for ${jobId}`);
      return cached.data;
    }
    return null;
  }

  /**
   * Cache job details
   */
  private setCachedJobDetails(jobId: string, data: any): void {
    this.jobDetailsCache.set(jobId, {
      data,
      timestamp: Date.now()
    });
    console.log(`💾 Cached job details for ${jobId}`);
  }

  /**
   * Clear expired cache entries
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.jobDetailsCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.jobDetailsCache.delete(key);
      }
    }
  }

  /**
   * Get all completed jobs for marketplace listing
   */
  async getCompletedJobs(limit: number = 50, offset: number = 0, search?: string, sortDirection: 'asc' | 'desc' = 'desc'): Promise<EntityResult<{ jobs: MarketplaceJob[]; totalCount: number }>> {
    try {
      console.log(`🔍 Getting completed jobs for marketplace (limit: ${limit}, offset: ${offset}, search: ${search || 'none'})`);
      
      // Get all completed jobs from the state index
      const completedJobIds = await this.db.getRedisClient().sMembers(
        `${REDIS_KEYS.INDEX.JOBS_BY_STATE}${JobState.COMPLETED}`
      );
      
      if (completedJobIds.length === 0) {
        console.log(`❌ No completed jobs found`);
        return { success: true, data: { jobs: [], totalCount: 0 } };
      }

      console.log(`📊 Found ${completedJobIds.length} completed jobs`);

      const marketplaceJobs: MarketplaceJob[] = [];
      
      // Process all jobs first to apply search filtering
      for (const jobId of completedJobIds) {
        try {
          const jobResult = await this.db.getJob(jobId);
          if (!jobResult.success) {
            console.warn(`⚠️ Failed to get job ${jobId}:`, jobResult.error);
            continue;
          }

          const job = jobResult.data;

          const marketplaceJob: MarketplaceJob = {
            job_id: job.jobID,
            job_type: job.jobType,
            target: job.target,
            job_views: job.job_views || 0,
            job_downloads: job.job_downloads || 0,
            completeAt: job.completeAt
          };

          // Apply search filter if provided
          if (search) {
            const searchLower = search.toLowerCase();
            const matchesSearch = 
              marketplaceJob.job_id.toLowerCase().includes(searchLower) ||
              marketplaceJob.job_type.toLowerCase().includes(searchLower) ||
              marketplaceJob.target.toLowerCase().includes(searchLower);
            
            if (matchesSearch) {
              marketplaceJobs.push(marketplaceJob);
            }
          } else {
            marketplaceJobs.push(marketplaceJob);
          }
        } catch (error) {
          console.error(`❌ Error processing job ${jobId}:`, error);
          continue;
        }
      }

      // Sort by completeAt
      marketplaceJobs.sort((a, b) => {
        if (sortDirection === 'asc') {
          return a.completeAt - b.completeAt;
        } else {
          return b.completeAt - a.completeAt;
        }
      });

      const totalCount = marketplaceJobs.length;

      // Apply pagination after filtering and sorting
      const paginatedJobs = marketplaceJobs.slice(offset, offset + limit);
      console.log(`📄 Returning ${paginatedJobs.length} jobs after filtering, sorting, and pagination (total filtered: ${totalCount})`);

      return { success: true, data: { jobs: paginatedJobs, totalCount } };
    } catch (error) {
      console.error(`❌ Error getting completed jobs:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get completed jobs: ${error}` }
      };
    }
  }

  /**
   * Get detailed information about a specific job including file preview
   */
  async getJobDetails(jobId: string): Promise<EntityResult<JobDetails>> {
    try {
      console.log(`🔍 Getting job details for: ${jobId}`);
      
      // Get job information
      const jobResult = await this.db.getJob(jobId);
      if (!jobResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: `Job ${jobId} not found` }
        };
      }

      const job = jobResult.data;

      // Check if job is completed
      if (job.state !== JobState.COMPLETED) {
        return {
          success: false,
          error: { type: 'InvalidInput', message: `Job ${jobId} is not completed` }
        };
      }

      // Increment view count
      await this.db.incrementJobViews(jobId);
      console.log(`📈 Incremented view count for job ${jobId}`);

      // Get file information and preview
      const fileResult = await this.getJobFilePreview(jobId);
      const fileMetadata = fileResult.success ? fileResult.data : undefined;
      const filePreview = fileResult.success ? fileResult.preview : undefined;
      const fileContent = fileResult.success ? fileResult.content : undefined;

      let dataCount: number | undefined;
      let included: string[] | undefined;
      
      if (fileContent && fileMetadata?.content_type?.includes('json')) {
        console.log(`📊 Analyzing JSON data (length: ${fileContent.length})`);
        const analysis = this.analyzeJsonData(fileContent);
        if (analysis) {
          dataCount = analysis.dataCount;
          included = analysis.included;
          console.log(`✅ JSON analysis successful: ${dataCount} items, ${included.length} keys`);
        } else {
          console.log(`❌ JSON analysis failed or returned null`);
        }
      } else {
        console.log(`⚠️ Skipping JSON analysis - conditions not met`);
      }

      const jobDetails: JobDetails = {
        job,
        fileMetadata,
        filePreview,
        fileContent,
        dataCount,
        included
      };

      console.log(`✅ Job details retrieved for ${jobId}`);
      return { success: true, data: jobDetails };
    } catch (error) {
      console.error(`❌ Error getting job details for ${jobId}:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get job details: ${error}` }
      };
    }
  }

  /**
   * OPTIMIZED: Get detailed information about a specific job with performance improvements
   * Now only retrieves stored pricing data instead of calculating on-the-fly
   */
  async getJobDetailsOptimized(jobId: string): Promise<EntityResult<JobDetails & { pricing?: any; hasContent?: boolean }>> {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Getting optimized job details for: ${jobId}`);
      
      // Check cache first
      const cachedData = this.getCachedJobDetails(jobId);
      if (cachedData) {
        const duration = Date.now() - startTime;
        console.log(`✅ Cached job details retrieved for ${jobId} in ${duration}ms`);
        return { success: true, data: cachedData };
      }

      // Clean expired cache entries periodically
      if (Math.random() < 0.1) { // 10% chance to clean cache
        this.cleanExpiredCache();
      }
      
      // Parallel execution of independent operations
      const [jobResult, viewIncrementResult] = await Promise.allSettled([
        this.db.getJob(jobId),
        this.db.incrementJobViews(jobId) // Fire and forget - don't wait for this
      ]);

      if (jobResult.status === 'rejected' || !jobResult.value.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: `Job ${jobId} not found` }
        };
      }

      const job = jobResult.value.data;

      // Check if job is completed
      if (job.state !== JobState.COMPLETED) {
        return {
          success: false,
          error: { type: 'InvalidInput', message: `Job ${jobId} is not completed` }
        };
      }

      // Get pricing information from stored job data (no calculation needed)
      let pricingInfo = null;
      if (job.price !== undefined) {
        pricingInfo = {
          price: job.price,
          objectsCount: job.objectsCount || 0,
          fileSizeKB: job.fileSizeKB || 0,
          currency: 'USDT'
        };
        console.log(`✅ Using stored pricing for job ${jobId}: ${job.price} USDT`);
      } else {
        console.log(`⚠️ No pricing information stored for job ${jobId} - may be an older job`);
      }

      // Get file metadata only (no content loading for performance)
      const fileMetadata = await this.getJobFileMetadataOnly(jobId);
      
      // Get file preview without loading full content
      const filePreview = await this.getJobFilePreviewOptimized(jobId);
      
      // Set data count and included from stored job data
      let dataCount: number | undefined;
      let included: string[] | undefined;
      let hasContent = false;

      if (pricingInfo) {
        dataCount = pricingInfo.objectsCount;
        hasContent = true; // Assume content exists if pricing is available
      }
      
      // Get included fields from stored dataAnalysis
      if (job.dataAnalysis) {
        dataCount = job.dataAnalysis.dataCount;
        included = job.dataAnalysis.included;
        console.log(`✅ Using stored dataAnalysis: ${dataCount} items, ${included?.length || 0} keys`);
      }

      const jobDetails: JobDetails & { pricing?: any; hasContent?: boolean } = {
        job,
        fileMetadata,
        filePreview,
        fileContent: undefined, // Don't load content for performance
        dataCount,
        included,
        pricing: pricingInfo,
        hasContent
      };

      // Cache the result
      this.setCachedJobDetails(jobId, jobDetails);

      const duration = Date.now() - startTime;
      console.log(`✅ Optimized job details retrieved for ${jobId} in ${duration}ms`);
      return { success: true, data: jobDetails };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error getting optimized job details for ${jobId} after ${duration}ms:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get job details: ${error}` }
      };
    }
  }

  /**
   * Get file preview for a job (first few lines of content)
   */
  private async getJobFilePreview(jobId: string): Promise<{ success: boolean; data?: FileMetadata; preview?: string; content?: string; error?: any }> {
    try {
      console.log(`🔍 Getting file preview for job: ${jobId}`);
      
      // Get files associated with this job
      const fileIds = await this.db.getFileIdsFromIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_JOB}${jobId}`
      );

      if (fileIds.length === 0) {
        console.log(`❌ No files found for job ${jobId}`);
        return { success: false, error: 'No files found' };
      }

      // Get the first file (assuming one file per job for now)
      const fileId = fileIds[0];
      const fileResult = await this.fileService.getFile(fileId);
      
      if (!fileResult.success) {
        console.log(`❌ Failed to get file metadata for ${fileId}`);
        return { success: false, error: fileResult.error };
      }

      const fileMetadata = fileResult.data;
      console.log(`📄 File metadata retrieved: ${fileMetadata.name} (${fileMetadata.content_type})`);

      // Get file content for preview
      const contentResult = await this.fileService.getFileContentByStoredId(fileId);
      if (!contentResult.success) {
        console.log(`❌ Failed to get file content for ${fileId}`);
        return { 
          success: true, 
          data: fileMetadata, 
          preview: 'File content not available',
          content: undefined
        };
      }

      const content = contentResult.data;
      const preview = this.generateFilePreview(content, fileMetadata.content_type);

      console.log(`✅ File preview generated for ${fileId}`);
      return { 
        success: true, 
        data: fileMetadata, 
        preview, 
        content: content // Return full content for JSON analysis
      };
    } catch (error) {
      console.error(`❌ Error getting file preview for job ${jobId}:`, error);
      return { success: false, error };
    }
  }

  /**
   * Generate a preview of file content (first few lines)
   */
  private generateFilePreview(content: string, contentType: string): string {
    try {
      const maxLines = 5;
      const maxLength = 500;

      // Handle different content types
      if (contentType.includes('json')) {
        try {
          const parsed = JSON.parse(content);
          const jsonStr = JSON.stringify(parsed, null, 2);
          const lines = jsonStr.split('\n').slice(0, maxLines);
          return lines.join('\n') + (lines.length >= maxLines ? '\n...' : '');
        } catch {
          // If JSON parsing fails, treat as text
        }
      }

      if (contentType.includes('text') || contentType.includes('html') || contentType.includes('xml')) {
        const lines = content.split('\n').slice(0, maxLines);
        let preview = lines.join('\n');
        
        if (preview.length > maxLength) {
          preview = preview.substring(0, maxLength) + '...';
        }
        
        return preview;
      }

      // For binary or unknown content types, return a truncated version
      if (content.length > maxLength) {
        return content.substring(0, maxLength) + '...';
      }

      return content;
    } catch (error) {
      console.error(`❌ Error generating file preview:`, error);
      return 'Preview not available';
    }
  }

  /**
   * Analyze JSON content to extract dataCount and included fields
   */
  private analyzeJsonData(content: string): { dataCount: number; included: string[] } | null {
    try {
      console.log(`🔍 Starting JSON analysis with content length: ${content.length}`);
      console.log(`📄 Content preview: ${content.substring(0, 100)}...`);
      
      const parsed = JSON.parse(content);
      console.log(`✅ JSON parsed successfully, type: ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
      
      // Check if it's a top-level array
      if (Array.isArray(parsed)) {
        const dataCount = parsed.length;
        const included: string[] = [];
        
        console.log(`📊 Top-level array has ${dataCount} items`);
        
        // Extract unique keys from all objects in the array
        if (dataCount > 0) {
          const allKeys = new Set<string>();
          
          parsed.forEach((item, index) => {
            if (typeof item === 'object' && item !== null) {
              const itemKeys = Object.keys(item);
              console.log(`   Item ${index}: keys = ${itemKeys.join(', ')}`);
              itemKeys.forEach(key => allKeys.add(key));
            } else {
              console.log(`   Item ${index}: not an object (${typeof item})`);
            }
          });
          
          // Convert Set to Array and sort for consistency
          included.push(...Array.from(allKeys).sort());
        }
        
        console.log(`📊 Analyzed JSON data: ${dataCount} items, keys: ${included.join(', ')}`);
        return { dataCount, included };
      }
      
      // Check if it's an object containing arrays (e.g., Twitter responses with post/reply structure)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        console.log(`📊 Object detected, looking for array properties...`);
        
        // Find all array properties in the object
        const arrayProperties: { key: string; array: any[] }[] = [];
        
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
            console.log(`   Found array property: ${key} with ${parsed[key].length} items`);
            arrayProperties.push({ key, array: parsed[key] });
          }
        }
        
        if (arrayProperties.length === 0) {
          console.log(`⚠️ No array properties found in object`);
          return null;
        }
        
        // Use the largest array for analysis (most likely the main data)
        const largestArray = arrayProperties.reduce((prev, current) => 
          current.array.length > prev.array.length ? current : prev
        );
        
        console.log(`📊 Using array property "${largestArray.key}" with ${largestArray.array.length} items`);
        
        const dataCount = largestArray.array.length;
        const allKeys = new Set<string>();
        
        // Extract unique keys from all objects in the array
        largestArray.array.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            const itemKeys = Object.keys(item);
            console.log(`   Item ${index}: keys = ${itemKeys.join(', ')}`);
            itemKeys.forEach(key => allKeys.add(key));
          } else {
            console.log(`   Item ${index}: not an object (${typeof item})`);
          }
        });
        
        // Convert Set to Array and sort for consistency
        const included = Array.from(allKeys).sort();
        
        console.log(`📊 Analyzed JSON data from "${largestArray.key}": ${dataCount} items, keys: ${included.join(', ')}`);
        return { dataCount, included };
      }
      
      // If it's neither an array nor an object with arrays, return null
      console.log(`⚠️ JSON content is neither an array nor an object with array properties`);
      return null;
    } catch (error) {
      console.error(`❌ Error analyzing JSON data:`, error);
      return null;
    }
  }

  /**
   * OPTIMIZED: Get only file metadata without content loading
   */
  private async getJobFileMetadataOnly(jobId: string): Promise<FileMetadata | undefined> {
    try {
      const fileIds = await this.db.getFileIdsFromIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_JOB}${jobId}`
      );

      if (fileIds.length === 0) {
        return undefined;
      }

      const fileId = fileIds[0];
      const fileResult = await this.fileService.getFile(fileId);
      
      return fileResult.success ? fileResult.data : undefined;
    } catch (error) {
      console.error(`❌ Error getting file metadata for job ${jobId}:`, error);
      return undefined;
    }
  }

  /**
   * OPTIMIZED: Get file preview without loading full content
   */
  private async getJobFilePreviewOptimized(jobId: string): Promise<string | undefined> {
    try {
      const fileIds = await this.db.getFileIdsFromIndex(
        `${REDIS_KEYS.INDEX.FILES_BY_JOB}${jobId}`
      );

      if (fileIds.length === 0) {
        return undefined;
      }

      const fileId = fileIds[0];
      const fileResult = await this.fileService.getFile(fileId);
      
      if (!fileResult.success) {
        return undefined;
      }

      const fileMetadata = fileResult.data;
      
      // Load actual content and generate preview
      try {
        const contentResult = await this.fileService.getFileContentByStoredId(fileId);
        if (contentResult.success && contentResult.data) {
          const content = contentResult.data;
          
          // Generate actual preview from content
          if (fileMetadata.content_type?.includes('json')) {
            try {
              const parsed = JSON.parse(content);
              
              // For arrays, show first few items
              if (Array.isArray(parsed)) {
                const previewItems = parsed.slice(0, 3); // Show first 3 items
                return JSON.stringify(previewItems, null, 2) + 
                       (parsed.length > 3 ? `\n... (${parsed.length - 3} more items)` : '');
              }
              
              // For objects with array properties, show structure with sample
              if (typeof parsed === 'object' && parsed !== null) {
                const keys = Object.keys(parsed);
                const previewObj: any = {};
                
                for (const key of keys.slice(0, 5)) { // First 5 keys
                  const value = parsed[key];
                  
                  if (Array.isArray(value)) {
                    // Show first 2 items from arrays
                    previewObj[key] = value.slice(0, 2);
                    if (value.length > 2) {
                      previewObj[key + '_more'] = `... ${value.length - 2} more items`;
                    }
                  } else {
                    previewObj[key] = value;
                  }
                }
                
                return JSON.stringify(previewObj, null, 2) + 
                       (keys.length > 5 ? `\n... (${keys.length - 5} more fields)` : '');
              }
              
              // Fallback: stringify with limit
              const jsonStr = JSON.stringify(parsed, null, 2);
              return jsonStr.length > 500 ? jsonStr.substring(0, 500) + '\n...' : jsonStr;
              
            } catch (parseError) {
              // If JSON parsing fails, show first 500 chars
              return content.length > 500 ? content.substring(0, 500) + '...' : content;
            }
          } else if (fileMetadata.content_type?.includes('html')) {
            // For HTML, show first few lines
            const lines = content.split('\n').slice(0, 10);
            return lines.join('\n') + (lines.length >= 10 ? '\n...' : '');
          } else {
            // For other types, show first 500 chars
            return content.length > 500 ? content.substring(0, 500) + '...' : content;
          }
        }
      } catch (contentError) {
        console.warn(`⚠️ Could not load content for preview, using metadata fallback:`, contentError);
      }
      
      // Fallback to placeholder if content loading fails
      if (fileMetadata.content_type?.includes('json')) {
        return `{"preview": "JSON file with ${fileMetadata.size} bytes", "type": "${fileMetadata.content_type}"}`;
      } else if (fileMetadata.content_type?.includes('html')) {
        return `<!-- HTML file preview - ${fileMetadata.size} bytes -->`;
      } else {
        return `File preview - ${fileMetadata.size} bytes (${fileMetadata.content_type})`;
      }
    } catch (error) {
      console.error(`❌ Error getting file preview for job ${jobId}:`, error);
      return undefined;
    }
  }


  /**
   * Get job download with download count increment
   */
  async getJobDownload(jobId: string): Promise<EntityResult<{
    job: JobStruct;
    filePath: string;
    metadata: FileMetadata;
  }>> {
    try {
      console.log(`🔍 Getting job download for: ${jobId}`);
      
      // Get job information
      const jobResult = await this.db.getJob(jobId);
      if (!jobResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: `Job ${jobId} not found` }
        };
      }

      const job = jobResult.data;

      // Check if job is completed
      if (job.state !== JobState.COMPLETED) {
        return {
          success: false,
          error: { type: 'InvalidInput', message: `Job ${jobId} is not completed` }
        };
      }

      // Increment download count
      await this.db.incrementJobDownloads(jobId);
      console.log(`📈 Incremented download count for job ${jobId}`);

      // Get file information for download
      const fileResult = await this.getJobFilePreview(jobId);
      if (!fileResult.success || !fileResult.data) {
        return {
          success: false,
          error: { type: 'NotFound', message: `File not found for job ${jobId}` }
        };
      }

      const fileMetadata = fileResult.data;

      const downloadData = {
        job,
        filePath: fileMetadata.file_path,
        metadata: fileMetadata
      };

      console.log(`✅ Job download data retrieved for ${jobId}`);
      return { success: true, data: downloadData };
    } catch (error) {
      console.error(`❌ Error getting job download for ${jobId}:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get job download: ${error}` }
      };
    }
  }

  /**
   * Get job statistics for marketplace
   */
  async getMarketplaceStats(): Promise<EntityResult<{
    totalCompletedJobs: number;
    totalJobsByType: Record<string, number>;
    recentJobsCount: number;
  }>> {
    try {
      console.log(`🔍 Getting marketplace statistics`);
      
      // Get all completed jobs
      const completedJobIds = await this.db.getRedisClient().sMembers(
        `${REDIS_KEYS.INDEX.JOBS_BY_STATE}${JobState.COMPLETED}`
      );

      const totalCompletedJobs = completedJobIds.length;
      const totalJobsByType: Record<string, number> = {};
      let recentJobsCount = 0;

      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      for (const jobId of completedJobIds) {
        try {
          const jobResult = await this.db.getJob(jobId);
          if (jobResult.success) {
            const job = jobResult.data;
            
            // Count by job type
            totalJobsByType[job.jobType] = (totalJobsByType[job.jobType] || 0) + 1;
            
            // Count recent jobs (last week)
            if (job.completeAt > oneWeekAgo) {
              recentJobsCount++;
            }
          }
        } catch (error) {
          console.warn(`⚠️ Error processing job ${jobId} for stats:`, error);
        }
      }

      const stats = {
        totalCompletedJobs,
        totalJobsByType,
        recentJobsCount
      };

      console.log(`✅ Marketplace stats retrieved:`, stats);
      return { success: true, data: stats };
    } catch (error) {
      console.error(`❌ Error getting marketplace stats:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get marketplace stats: ${error}` }
      };
    }
  }

  /**
   * Store a purchase record for a user and job
   */
  async storePurchase(userPrincipalId: string, jobId: string): Promise<EntityResult<void>> {
    try {
      console.log(`🔍 Storing purchase: user ${userPrincipalId} -> job ${jobId}`);
      
      // Verify the job exists and is completed
      const jobResult = await this.db.getJob(jobId);
      if (!jobResult.success) {
        return {
          success: false,
          error: { type: 'NotFound', message: `Job ${jobId} not found` }
        };
      }

      const job = jobResult.data;
      if (job.state !== JobState.COMPLETED) {
        return {
          success: false,
          error: { type: 'InvalidInput', message: `Job ${jobId} is not completed` }
        };
      }

      // Check if purchase already exists
      const accessResult = await this.db.hasPurchaseAccess(userPrincipalId, jobId);
      if (!accessResult.success) {
        return accessResult;
      }

      if (accessResult.data) {
        console.log(`✅ Purchase already exists for user ${userPrincipalId} -> job ${jobId}`);
        return { success: true, data: undefined };
      }

      // Store the purchase
      const storeResult = await this.db.storePurchase(userPrincipalId, jobId);
      if (!storeResult.success) {
        return storeResult;
      }

      console.log(`✅ Purchase stored successfully: user ${userPrincipalId} -> job ${jobId}`);
      return { success: true, data: undefined };
    } catch (error) {
      console.error(`❌ Error storing purchase:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to store purchase: ${error}` }
      };
    }
  }

  /**
   * Check if user has purchase access to a job
   */
  async hasPurchaseAccess(userPrincipalId: string, jobId: string): Promise<EntityResult<boolean>> {
    try {
      console.log(`🔍 Checking purchase access: user ${userPrincipalId} -> job ${jobId}`);
      
      const accessResult = await this.db.hasPurchaseAccess(userPrincipalId, jobId);
      if (!accessResult.success) {
        return accessResult;
      }

      console.log(`✅ Purchase access check result: ${accessResult.data}`);
      return { success: true, data: accessResult.data };
    } catch (error) {
      console.error(`❌ Error checking purchase access:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to check purchase access: ${error}` }
      };
    }
  }

  /**
   * Get user's purchased jobs
   */
  async getUserPurchases(userPrincipalId: string): Promise<EntityResult<string[]>> {
    try {
      console.log(`🔍 Getting purchases for user: ${userPrincipalId}`);
      
      const purchasesResult = await this.db.getUserPurchases(userPrincipalId);
      if (!purchasesResult.success) {
        return purchasesResult;
      }

      console.log(`✅ Found ${purchasesResult.data.length} purchases for user ${userPrincipalId}`);
      return { success: true, data: purchasesResult.data };
    } catch (error) {
      console.error(`❌ Error getting user purchases:`, error);
      return {
        success: false,
        error: { type: 'DatabaseError', message: `Failed to get user purchases: ${error}` }
      };
    }
  }
}
