import { Router, Request, Response } from 'express';
import { DatabaseService } from '../../db/service';
import { Database } from '../../db/database';
import { FileService } from '../../services/file_service';
import { AuthService } from '../../services/auth_service';
import { NodeService } from '../../services/node_service';
import { MarketplaceService } from '../../services/marketplace_service';
import { ApiResponse } from '../utils';
import { EventEmitter } from 'events';
import { calculateJobPrice, analyzeJsonContent, analyzeScrapedDataByType, getContentSizeKB, validateContentStructure } from '../../utils/pricing';
import { jobQueueManager } from '../../services/job_queue_manager';
import { JobWaitingPromise, REDIS_KEYS } from '../../db/types';
import { ScrapeLogger } from '../../utils/scrape_logger';

// Interface for hybrid server WebSocket capabilities
interface HybridServerLike {
  sendJobToClient(clientId: string, userPrincipalId: string, url: string, scrapeType: string, jobId?: string, post_count?: number, replies_count?: number, scrollPauseTime?: number): Promise<{ success: boolean; message?: string; error?: string }>;
  getNodeHandler(): any;
  getJobTimeoutMonitor?(): any;
}

// ✅ Removed legacy job waiting - now handled by JobQueueManager
// const waitingJobs = new Map<string, JobWaitingPromise>();
// const jobCompletionEmitter = new EventEmitter();

// ✅ Legacy job waiting functions removed - now handled by JobQueueManager

/**
 * Checks if a result is considered empty (empty array, null, undefined, empty string, or empty HTML)
 */
function checkIfResultIsEmpty(result: any): boolean {
  // Check for null or undefined
  if (result === null || result === undefined) {
    return true;
  }
  
  // Check for empty string
  if (typeof result === 'string' && result.trim() === '') {
    return true;
  }
  
  // Check for empty array
  if (Array.isArray(result) && result.length === 0) {
    return true;
  }
  
  // Check for empty object
  if (typeof result === 'object' && !Array.isArray(result) && Object.keys(result).length === 0) {
    return true;
  }
  
  // Check for string content (JSON or HTML)
  if (typeof result === 'string') {
    const trimmed = result.trim();
    
    // Check for empty string after trimming
    if (trimmed === '') {
      return true;
    }
    
    // Check for JSON string that parses to empty content
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length === 0) {
        return true;
      }
      if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) {
        return true;
      }
    } catch {
      // Not valid JSON, check for HTML content
    }
    
    // Check for empty or minimal HTML content
    if (isHtmlContent(trimmed)) {
      return isHtmlEmpty(trimmed);
    }
  }
  
  return false;
}

/**
 * Checks if a string appears to be HTML content
 */
function isHtmlContent(content: string): boolean {
  // Look for common HTML tags or patterns
  const htmlPatterns = [
    /<html[^>]*>/i,
    /<head[^>]*>/i,
    /<body[^>]*>/i,
    /<div[^>]*>/i,
    /<p[^>]*>/i,
    /<span[^>]*>/i,
    /<h[1-6][^>]*>/i,
    /<a[^>]*>/i,
    /<img[^>]*>/i,
    /<script[^>]*>/i,
    /<style[^>]*>/i,
    /<meta[^>]*>/i,
    /<title[^>]*>/i,
    /<link[^>]*>/i,
    /<br\s*\/?>/i,
    /<hr\s*\/?>/i,
    /<input[^>]*>/i,
    /<button[^>]*>/i,
    /<form[^>]*>/i,
    /<table[^>]*>/i,
    /<ul[^>]*>/i,
    /<ol[^>]*>/i,
    /<li[^>]*>/i
  ];
  
  return htmlPatterns.some(pattern => pattern.test(content));
}

/**
 * Checks if HTML content is considered empty (no meaningful content)
 */
function isHtmlEmpty(htmlContent: string): boolean {
  // Remove HTML tags and check for meaningful content
  const textContent = htmlContent
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags and content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags and content
    .replace(/<[^>]+>/g, '') // Remove all HTML tags
    .replace(/&[a-zA-Z0-9#]+;/g, ' ') // Replace HTML entities with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Check if there's any meaningful text content
  if (textContent === '') {
    return true;
  }
  
  // Check for common empty HTML patterns
  const emptyPatterns = [
    /^<html[^>]*>\s*<\/html>$/i,
    /^<html[^>]*>\s*<head[^>]*>\s*<\/head>\s*<body[^>]*>\s*<\/body>\s*<\/html>$/i,
    /^<div[^>]*>\s*<\/div>$/i,
    /^<p[^>]*>\s*<\/p>$/i,
    /^<span[^>]*>\s*<\/span>$/i,
    /^<body[^>]*>\s*<\/body>$/i,
    /^<head[^>]*>\s*<\/head>$/i
  ];
  
  return emptyPatterns.some(pattern => pattern.test(htmlContent.trim()));
}

export function createRpcRoutes(database: Database, hybridServer?: HybridServerLike): Router {
  const router = Router();
  const dbService = new DatabaseService(database);
  const fileService = new FileService(database);
  const authService = new AuthService(dbService);
  const nodeService = new NodeService(dbService, fileService);
  const marketplaceService = new MarketplaceService(database, fileService, dbService);


  // ✅ Setup JobQueueManager integration with HybridServer
  if (hybridServer && hybridServer.getNodeHandler) {
    try {
      const nodeHandler = hybridServer.getNodeHandler();
      if (nodeHandler && nodeHandler.on) {
        // Listen for job completion events from WebSocket handler
        nodeHandler.on('jobCompleted', (data: { jobId: string; result: any; error?: any }) => {
          ScrapeLogger.logJobQueueEventReceived(data.jobId, !!data.error);
          
          if (data.error) {
            ScrapeLogger.logJobQueueResolution(data.jobId, false, data.error);
            jobQueueManager.rejectJobCompletion(data.jobId, data.error);
          } else {
            ScrapeLogger.logJobQueueResolution(data.jobId, true);
            jobQueueManager.resolveJobCompletion(data.jobId, data.result);
          }
        });

        // Listen for job delivery requests from JobQueueManager
        jobQueueManager.on('deliverJob', async (job: {
          jobId: string;
          userPrincipalId: string;
          url: string;
          scrapeType: string;
          post_count: number;
          replies_count: number;
          scrollPauseTime: number;
        }, callback: (result: { success: boolean; error?: string }) => void) => {
          try {
            // Send job via existing WebSocket infrastructure
            const wsResult = await hybridServer.sendJobToClient(
              '', // clientId will be determined by the job assignment
              job.userPrincipalId,
              job.url,
              job.scrapeType,
              job.jobId,
              job.post_count,
              job.replies_count,
              job.scrollPauseTime
            );
            callback(wsResult);
          } catch (error) {
            callback({ success: false, error: `WebSocket delivery failed: ${error}` });
          }
        });

        console.log('🔗 JobQueueManager integration initialized');
      }
    } catch (error) {
      console.warn('⚠️ Failed to setup JobQueueManager integration:', error);
    }
  }

  const apiKeyMiddleware = async (req: Request, res: Response, next: any): Promise<void> => {
    const authHeader = req.headers.authorization;
    console.log(`🔐 Authorization header received: ${authHeader}`);
    
    if (!authHeader) {
      ApiResponse.unauthorized(res, 'Missing Authorization header');
      return;
    }

    // Handle different Authorization header formats
    let apiKey: string;
    
    if (authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7); // Remove "Bearer " prefix
    } else if (authHeader.startsWith('ApiKey ')) {
      apiKey = authHeader.substring(8); // Remove "ApiKey " prefix
    } else {
      // Assume the entire header is the API key
      apiKey = authHeader;
    }

    console.log(`🔑 Extracted API key: ${apiKey.substring(0, 8)}...`);
    
    if (!apiKey || apiKey.trim() === '') {
      ApiResponse.unauthorized(res, 'Invalid Authorization header format. Expected: "Bearer <api_key>" or "ApiKey <api_key>" or just the API key');
      return;
    }

    try {
      const validationResult = await authService.validateApiKey(apiKey);
      if (!validationResult.success) {
        ApiResponse.unauthorized(res, 'Invalid API key');
        return;
      }
      
      (req as any).userPrincipalId = validationResult.data;
      console.log(`✅ API key validation successful for user: ${validationResult.data}`);
      next();
    } catch (error) {
      console.error('API key validation error:', error);
      ApiResponse.internalError(res, 'Authentication failed');
      return;
    }
  };

  // GET /ping - Health check
  router.get('/ping', (req: Request, res: Response) => {
    return ApiResponse.success(res, { status: 'OK' }, 'Server is healthy');
  });

  // GET /status - Server status with job queue information
  router.get('/status', (req: Request, res: Response) => {
    const queueStatus = jobQueueManager.getSystemQueueStatus();
    
    // Get job timeout monitor status if available
    let jobTimeoutMonitorStatus = null;
    if (hybridServer && hybridServer.getJobTimeoutMonitor) {
      jobTimeoutMonitorStatus = hybridServer.getJobTimeoutMonitor().getStatus();
    }
    
    const status = {
      server: 'OK',
      timestamp: new Date().toISOString(),
      jobQueue: {
        totalClients: queueStatus.totalClients,
        activeQueues: queueStatus.activeQueues,
        totalPendingJobs: queueStatus.totalPendingJobs,
        totalWaitingJobs: queueStatus.totalWaitingJobs,
        clientQueues: queueStatus.clientQueues
      },
      ...(jobTimeoutMonitorStatus && { jobTimeoutMonitor: jobTimeoutMonitorStatus })
    };
    return ApiResponse.success(res, status, 'Server status retrieved successfully');
  });

  // GET /getClientStatus - Get client API key and usage info
  router.get('/getClientStatus', async (req: Request, res: Response) => {
    try {
      const { uuid } = req.query;
      
      if (!uuid || typeof uuid !== 'string') {
        return ApiResponse.validationError(res, 'Missing Client UUID');
      }

      const apiKeyResult = await dbService.getAPIKeyData(uuid);
      if (!apiKeyResult.success) {
        return ApiResponse.notFound(res, 'API key for Client UUID not found');
      }

      const responseData = {
        'clientAPI-Key': apiKeyResult.data.apiKey,
        totalUsage: apiKeyResult.data.usageCount,
        usageLimit: apiKeyResult.data.usageLimit
      };

      return ApiResponse.success(res, responseData, 'Client status retrieved successfully');
    } catch (error) {
      console.error('Error getting client status:', error);
      return ApiResponse.internalError(res, 'Failed to get client status');
    }
  });

  // GET /getTotalUsage - Get total API usage (requires auth header)
  router.get('/getTotalUsage', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      
      const apiKeyResult = await dbService.getAPIKeyData(userPrincipalId);
      if (!apiKeyResult.success) {
        return ApiResponse.notFound(res, 'Client UUID not found');
      }

      const responseData = {
        clientUUID: userPrincipalId,
        totalUsage: apiKeyResult.data.usageCount,
        usageLimit: apiKeyResult.data.usageLimit
      };

      return ApiResponse.success(res, responseData, 'Total usage retrieved successfully');
    } catch (error) {
      console.error('Error getting total usage:', error);
      return ApiResponse.internalError(res, 'Failed to get total usage');
    }
  });

  // GET /getUsageInDateRange - Get usage in date range
  router.get('/getUsageInDateRange', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { fromDate, toDate } = req.query;

      if (!fromDate || !toDate) {
        return ApiResponse.validationError(res, 'Missing required parameters: fromDate and toDate');
      }

      // Convert microsecond timestamps to Unix timestamps (seconds)
      const fromDateMicros = parseInt(fromDate as string);
      const toDateMicros = parseInt(toDate as string);

      if (isNaN(fromDateMicros) || isNaN(toDateMicros)) {
        return ApiResponse.validationError(res, 'Invalid date format. Expected microsecond timestamps');
      }

      // Convert from microseconds to seconds (Unix timestamp)
      const fromDateNum = Math.floor(fromDateMicros / 1000000);
      const toDateNum = Math.floor(toDateMicros / 1000000);

      const jsonResp = await dbService.getUsageInDateRange(userPrincipalId, fromDateNum, toDateNum);
      const responseData = JSON.parse(jsonResp);

      return ApiResponse.success(res, responseData, 'Usage data retrieved successfully');
    } catch (error) {
      console.error('Error getting usage in date range:', error);
      return ApiResponse.internalError(res, 'Failed to get usage data');
    }
  });

  // GET /getFileContent - Get file content by job ID
  router.get('/getFileContent', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { jobID } = req.query;

      if (!jobID || typeof jobID !== 'string') {
        return ApiResponse.validationError(res, 'Missing required parameter: jobID');
      }

      console.log(`🔄 Getting file content for job: ${jobID} - using FileService`);

      const storedIdResult = await nodeService.getStoredIdFromJobId(jobID);
      if (!storedIdResult.success) {
        return ApiResponse.notFound(res, 'Job not found');
      }

      const jobResult = await nodeService.getJobWithId(jobID);
      if (!jobResult.success) {
        return ApiResponse.notFound(res, 'Job not found');
      }

      if (jobResult.data.clientUUID !== userPrincipalId) {
        return ApiResponse.forbidden(res, 'Access denied: Job does not belong to authenticated user');
      }

      const fileContentResult = await fileService.getFileContentByStoredId(storedIdResult.data);
      if (!fileContentResult.success) {
        return ApiResponse.notFound(res, 'File content not found');
      }

      return ApiResponse.success(res, { 
        ok: fileContentResult.data 
      }, 'File content retrieved successfully');
    } catch (error) {
      console.error('Error getting file content:', error);
      return ApiResponse.internalError(res, 'Failed to get file content');
    }
  });

  // GET /jobs - Get all jobs for authenticated client
  router.get('/jobs', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      
      const jobsResult = await nodeService.getAllJobs(userPrincipalId);
      if (!jobsResult.success) {
        return ApiResponse.error(res, 'Failed to fetch jobs: ' + jobsResult.error.message);
      }

      return ApiResponse.success(res, jobsResult.data, 'Jobs retrieved successfully');
    } catch (error) {
      console.error('Error getting jobs:', error);
      return ApiResponse.internalError(res, 'Failed to get jobs');
    }
  });

  // GET /pendingJobs - Get pending jobs for authenticated client
  router.get('/pendingJobs', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      
      const jobsResult = await nodeService.getPendingJobs(userPrincipalId);
      if (!jobsResult.success) {
        return ApiResponse.error(res, 'Failed to fetch jobs: ' + jobsResult.error.message);
      }

      return ApiResponse.success(res, jobsResult.data, 'Pending jobs retrieved successfully');
    } catch (error) {
      console.error('Error getting pending jobs:', error);
      return ApiResponse.internalError(res, 'Failed to get pending jobs');
    }
  });

  // GET /job/id - Get specific job by ID
  router.get('/job/id', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { id } = req.query;
      
      if (!id || typeof id !== 'string') {
        return ApiResponse.validationError(res, 'Missing id parameter');
      }

      const jobResult = await nodeService.getJobWithId(id);
      if (!jobResult.success) {
        return ApiResponse.notFound(res, 'Job not found');
      }

      if (jobResult.data.clientUUID !== userPrincipalId) {
        return ApiResponse.forbidden(res, 'Access denied: Job does not belong to authenticated user');
      }

      return ApiResponse.success(res, jobResult.data, 'Job retrieved successfully');
    } catch (error) {
      console.error('Error getting job by ID:', error);
      return ApiResponse.internalError(res, 'Failed to get job');
    }
  });

  // GET /job/:id/download - Download job content by ID
  router.get('/job/:id/download', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { id } = req.params; // Use params instead of query for route parameter

      if (!id) {
        return ApiResponse.validationError(res, 'Missing required parameter: id');
      }

      console.log(`🔄 Downloading job content for ID: ${id} - using FileService`);

      const storedIdResult = await nodeService.getStoredIdFromJobId(id);
      if (!storedIdResult.success) {
        return ApiResponse.notFound(res, 'Job not found');
      }

      const jobResult = await nodeService.getJobWithId(id);
      if (!jobResult.success) {
        return ApiResponse.notFound(res, 'Job not found');
      }

      if (jobResult.data.clientUUID !== userPrincipalId) {
        return ApiResponse.forbidden(res, 'Access denied: Job does not belong to authenticated user');
      }

      const downloadResult = await fileService.downloadFileByStoredId(storedIdResult.data);
      if (!downloadResult.success) {
        return ApiResponse.notFound(res, 'File not found');
      }

      const { filePath, metadata } = downloadResult.data;

      // Set appropriate headers for file download
      res.setHeader('Content-Type', metadata.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${metadata.name}"`);
      
      const fs = require('fs');
      
      // For dual storage, prefer local file (faster), fallback to canister
      if (filePath.startsWith('canister:') || !fs.existsSync(filePath)) {
        // File not available locally, get from file service (handles canister/dual storage)
        console.log(`📦 File not on local disk, fetching content via file service: ${metadata.id}`);
        const contentResult = await fileService.getFileContentByStoredId(metadata.id);
        
        if (!contentResult.success) {
          console.error(`❌ Failed to get file content for ${metadata.id}:`, contentResult.error);
          return ApiResponse.notFound(res, 'File content not available');
        }
        
        const contentBuffer = Buffer.from(contentResult.data, 'utf8');
        return res.send(contentBuffer);
      }
      
      // Stream the file directly from local disk (fastest option)
      console.log(`📁 Streaming from local disk: ${filePath}`);
      const fileStream = fs.createReadStream(filePath);
      
      fileStream.on('error', (streamError: any) => {
        console.error('Error streaming file:', streamError);
        if (!res.headersSent) {
          ApiResponse.internalError(res, 'Failed to stream file');
        }
      });

      return fileStream.pipe(res);
    } catch (error) {
      console.error('Error downloading job content:', error);
      return ApiResponse.internalError(res, 'Failed to download job content');
    }
  });

  // POST /registerClient - Register new client and generate API key
  router.post('/registerClient', async (req: Request, res: Response) => {
    try {
      const { uuid } = req.body;

      if (!uuid) {
        return ApiResponse.validationError(res, 'Missing or invalid client_id in request body');
      }

      const clientResult = await dbService.login(uuid);
      if (!clientResult.success) {
        return ApiResponse.error(res, 'Failed to create client: ' + clientResult.error.message, 400);
      }

      const apiKeyResult = await dbService.createAPIKey(uuid);
      if (!apiKeyResult.success) {
        return ApiResponse.error(res, 'Failed to create API key ' + apiKeyResult.error.message, 400);
      }

      const responseData = {
        function: 'Register',
        message: 'API key generated',
        apiKey: apiKeyResult.data,
        status: 'OK'
      };

      return ApiResponse.success(res, responseData, 'Client registered successfully');
    } catch (error) {
      console.error('Error registering client:', error);
      return ApiResponse.internalError(res, 'Failed to register client');
    }
  });

  // POST /addJob - Add new scraping job
  router.post('/addJob', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { url, scrapeType } = req.body;

      if (!url || !scrapeType) {
        return ApiResponse.validationError(res, 'Missing or invalid url or scrapeType in request body');
      }

      // Check rate limit before creating job
      const rateLimitCheck = await authService.checkRateLimit(userPrincipalId);
      if (!rateLimitCheck) {
        return ApiResponse.error(res, 'Rate limit exceeded', 429);
      }

      const addJobResult = await nodeService.createNewJob(userPrincipalId, scrapeType, url);
      if (!addJobResult.success) {
        return ApiResponse.error(res, 'Failed to add job to DB');
      }

      // Record API usage
      await authService.recordApiUsage(userPrincipalId);

      const responseData = {
        jobId: addJobResult.data,
        message: 'Job successfully added'
      };

      return ApiResponse.success(res, responseData, 'Job added successfully');
    } catch (error) {
      console.error('Error adding job:', error);
      return ApiResponse.internalError(res, 'Failed to add job');
    }
  });

  // POST /scrapeUrl - One-stop scraping API: Add job + Assign + Wait for result  
  router.post('/scrapeUrl', apiKeyMiddleware, async (req: Request, res: Response) => {
    const requestStartTime = Date.now();
    
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { url, scrapeType, timeoutMs = 60000, principalId, postCount, replyCount, scrollPauseTime } = req.body;

      // Enhanced validation with better error messages
      if (!url) {
        return ApiResponse.validationError(res, 'Missing required field: url');
      }
      
      if (!scrapeType) {
        return ApiResponse.validationError(res, 'Missing required field: scrapeType');
      }

      if (typeof url !== 'string') {
        return ApiResponse.validationError(res, 'url must be a string');
      }

      if (typeof scrapeType !== 'string') {
        return ApiResponse.validationError(res, 'scrapeType must be a string');
      }

      // Validate optional numeric parameters
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || timeoutMs < 1000)) {
        return ApiResponse.validationError(res, 'timeoutMs must be a number >= 1000 (1 second)');
      }

      if (postCount !== undefined && (typeof postCount !== 'number' || postCount < 0)) {
        return ApiResponse.validationError(res, 'postCount must be a non-negative number');
      }

      if (replyCount !== undefined && (typeof replyCount !== 'number' || replyCount < 0)) {
        return ApiResponse.validationError(res, 'replyCount must be a non-negative number');
      }

      if (scrollPauseTime !== undefined && (typeof scrollPauseTime !== 'number' || scrollPauseTime < 0)) {
        return ApiResponse.validationError(res, 'scrollPauseTime must be a non-negative number');
      }

      // ⚠️ CRITICAL: Set HTTP timeout to be longer than job timeout to prevent socket hang up
      // Add 60 seconds buffer for processing after job completes
      const httpTimeoutMs = timeoutMs + 60000;
      
      // Set timeout on the request socket
      req.socket.setTimeout(httpTimeoutMs);
      req.socket.on('timeout', () => {
        console.error(`⏰ HTTP socket timeout for scrapeUrl after ${httpTimeoutMs}ms (${Math.round(httpTimeoutMs / 60000)} minutes)`);
        if (!res.headersSent) {
          ScrapeLogger.logJobTimeout('unknown', timeoutMs, Date.now() - requestStartTime);
          ApiResponse.error(res, `HTTP connection timed out after ${Math.round(httpTimeoutMs / 60000)} minutes`, 408);
        }
      });

      // Also set timeout on the response
      res.setTimeout(httpTimeoutMs, () => {
        console.error(`⏰ HTTP response timeout for scrapeUrl after ${httpTimeoutMs}ms (${Math.round(httpTimeoutMs / 60000)} minutes)`);
        if (!res.headersSent) {
          ScrapeLogger.logJobTimeout('unknown', timeoutMs, Date.now() - requestStartTime);
          ApiResponse.error(res, `HTTP response timed out after ${Math.round(httpTimeoutMs / 60000)} minutes`, 408);
        }
      });

      ScrapeLogger.logHttpTimeout('/scrapeUrl', timeoutMs, httpTimeoutMs);

      // Check rate limit before creating job
      const rateLimitCheck = await authService.checkRateLimit(userPrincipalId);
      if (!rateLimitCheck) {
        return ApiResponse.error(res, 'Rate limit exceeded', 429);
      }

      console.log(`🚀 Starting scrape operation: ${scrapeType} for ${url} (User: ${userPrincipalId})`);
      console.log(`⏱️  Timeout settings: job=${timeoutMs}ms (${Math.round(timeoutMs / 60000)}min), HTTP=${httpTimeoutMs}ms (${Math.round(httpTimeoutMs / 60000)}min)`);

      // Step 1: Add the job
      const addJobResult = await nodeService.createNewJob(userPrincipalId, scrapeType, url);
      if (!addJobResult.success) {
        console.error(`❌ Failed to create job for user ${userPrincipalId}:`, addJobResult.error);
        return ApiResponse.error(res, 'Failed to add job to DB');
      }

      const jobId = addJobResult.data;
      console.log(`✅ Job created: ${jobId} (User: ${userPrincipalId})`);

      // Log scrape start with all parameters
      ScrapeLogger.logScrapeUrlStart(jobId, url, scrapeType, timeoutMs, {
        postCount: postCount || 0,
        replyCount: replyCount || 0,
        scrollPauseTime: scrollPauseTime || 0,
        principalId: principalId || 'auto'
      });

      // Step 2: Find and assign the job
      const assignResult = principalId 
        ? await nodeService.findAndAssignJobToClient(jobId, principalId)
        : await nodeService.findAndAssignJob(jobId);
        
      if (!assignResult.success || !assignResult.data) {
        return ApiResponse.error(res, 'Failed to find optimal node for assignment');
      }

      console.log(`✅ Job assigned to client: ${assignResult.data.client_id} (Capacity: ${assignResult.data.currentLoad || 0}/${assignResult.data.maxCapacity || 10})`);
      

      // Step 3: Queue job for delivery via JobQueueManager
      let jobQueued = false;
      try {
        console.log(`📬 Queuing job ${jobId} for delivery to client ${assignResult.data.client_id} with postCount: ${postCount || 0}, replyCount: ${replyCount || 0}, scrollPauseTime: ${scrollPauseTime || 0}`);
        const queueResult = await jobQueueManager.queueJobForClient(
          assignResult.data.client_id,
          assignResult.data.user_principal_id,
          assignResult.data.target,
          assignResult.data.jobType,
          jobId,
          0,
          postCount || 0,
          replyCount || 0,
          scrollPauseTime || 0
        );
        
        if (queueResult.success) {
          console.log(`✅ Job ${jobId} queued for client ${assignResult.data.client_id}: ${queueResult.message}`);
          jobQueued = true;
        } else {
          console.warn(`⚠️ Failed to queue job ${jobId}: ${queueResult.error}`);
        }
      } catch (queueError) {
        console.error(`❌ Job queuing error for job ${jobId}:`, queueError);
      }

      if (!jobQueued) {
        console.error(`❌ Failed to queue job ${jobId} for client ${assignResult.data.client_id}`);
        return ApiResponse.error(res, 'Failed to queue job for delivery');
      }

      // Step 4: Wait for job completion via JobQueueManager
      try {
        console.log(`⏳ Waiting for job ${jobId} completion...`);
        ScrapeLogger.logWaitingForCompletion(jobId, assignResult.data.client_id, timeoutMs);
        
        const waitStartTime = Date.now();
        const jobResult = await jobQueueManager.waitForJobCompletion(
          jobId,
          assignResult.data.client_id,
          userPrincipalId,
          timeoutMs
        );
        
        const waitDuration = Date.now() - waitStartTime;
        ScrapeLogger.logJobCompletionDuration(jobId, waitDuration);
        
        // Step 5: get content from job result first, then from stored file
        let finalResult = jobResult;
        let resultSource = 'job_result';
        let contentForAnalysis: string | null = null;
        
        if (jobResult && (jobResult.content || jobResult.result)) {
          finalResult = jobResult.content || jobResult.result;
          contentForAnalysis = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);
          console.log(`✅ Using content from job result for job ${jobId}`);
        } else {
          const storedIdResult = await nodeService.getStoredIdFromJobId(jobId);
          if (storedIdResult.success && storedIdResult.data) {
            const fileContentResult = await fileService.getFileContentByStoredId(storedIdResult.data);
            if (fileContentResult.success) {
              contentForAnalysis = fileContentResult.data;
              try {
                finalResult = JSON.parse(fileContentResult.data);
                resultSource = 'stored_file';
                console.log(`✅ Retrieved content from stored file for job ${jobId}`);
              } catch (parseError) {
                finalResult = fileContentResult.data;
                resultSource = 'stored_file_raw';
                console.log(`✅ Retrieved raw content from stored file for job ${jobId}`);
              }
            }
          }
        }

        // Step 6: Check for empty results and mark job as failed if necessary
        const isEmptyResult = checkIfResultIsEmpty(finalResult);
        if (isEmptyResult) {
          console.log(`❌ Job ${jobId} returned empty results - marking as failed`);
          
          // Mark job as failed
          try {
            const markFailedResult = await nodeService.markJobAsFailed(jobId, assignResult.data.client_id, 'Empty results returned');
            if (markFailedResult.success) {
              console.log(`✅ Job ${jobId} successfully marked as failed due to empty results`);
            } else {
              console.warn(`⚠️ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
            }
          } catch (markFailedError) {
            console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
          }
          
          return ApiResponse.error(res, 'Scraping returned empty results', 422, {
            function: 'ScrapeEmpty',
            message: 'Scraping completed but returned empty results - no data found',
            jobId,
            url,
            scrapeType,
            user_principal_id: assignResult.data.user_principal_id,
            client_id: assignResult.data.client_id,
            state: 'failed',
            error: 'NO_DATA_FOUND',
            timestamp: Date.now()
          });
        }

        // Step 7: Calculate pricing information if we have content
        let pricingInfo = null;
        if (contentForAnalysis) {
          try {
            console.log(`💰 Calculating pricing for job ${jobId} (scrapeType: ${scrapeType})`);
            
            // Get file size in KB
            const fileSizeKB = getContentSizeKB(contentForAnalysis);
            console.log(`📊 File size: ${fileSizeKB} KB`);
            
            // Analyze JSON content based on scrape type to get accurate object count
            const dataAnalysis = analyzeScrapedDataByType(contentForAnalysis, scrapeType);
            const objectsCount = dataAnalysis ? dataAnalysis.dataCount : 0;
            console.log(`📊 Objects count for ${scrapeType}: ${objectsCount}`);
            
            // Calculate price
            const pricing = calculateJobPrice({ fileSizeKB, objectsCount });
            console.log(`💰 Pricing calculation: ${pricing.breakdown}`);
            
            pricingInfo = {
              price: pricing.totalPrice,
              objectsCount,
              fileSizeKB,
              ...(dataAnalysis && { dataAnalysis })
            };
            
            // Update the job with pricing information
            await nodeService.updateJobPricingInfo(jobId, pricingInfo);
            console.log(`✅ Job ${jobId} updated with pricing information`);
            
          } catch (pricingError) {
            console.warn(`⚠️ Failed to calculate pricing for job ${jobId}:`, pricingError);
          }
        }

        // Record API usage
        await authService.recordApiUsage(userPrincipalId);

        // Automatically store purchase for the user who scraped the data
        try {
          const purchaseResult = await marketplaceService.storePurchase(userPrincipalId, jobId);
          if (purchaseResult.success) {
            console.log(`✅ Automatic purchase stored for user ${userPrincipalId} -> job ${jobId}`);
          } else {
            console.warn(`⚠️ Failed to store automatic purchase for user ${userPrincipalId} -> job ${jobId}:`, purchaseResult.error);
          }
        } catch (purchaseError) {
          console.warn(`⚠️ Error storing automatic purchase for user ${userPrincipalId} -> job ${jobId}:`, purchaseError);
        }
        
        // Prepare enhanced response with detailed object count information
        const responseData: any = {
          function: 'ScrapeComplete',
          message: resultSource === 'job_result' ? 'URL scraped successfully' : 
                   resultSource === 'stored_file' ? 'URL scraped successfully (from stored file)' :
                   'URL scraped but result content not available',
          jobId,
          url,
          scrapeType,
          result: finalResult,
          user_principal_id: assignResult.data.user_principal_id,
          client_id: assignResult.data.client_id,
          state: 'completed',
          status: 'OK',
          completedAt: Date.now(),
          resultSource
        };

        // Add pricing information if available
        if (pricingInfo) {
          responseData.pricing = {
            price: pricingInfo.price,
            objectsCount: pricingInfo.objectsCount,
            fileSizeKB: pricingInfo.fileSizeKB,
            currency: 'USDT'
          };
        }

        // Add detailed object count and data analysis information
        if (contentForAnalysis) {
          const contentValidation = validateContentStructure(contentForAnalysis);
          
          // Enhanced content analysis with file size information
          responseData.contentAnalysis = {
            ...contentValidation,
            fileSizeBytes: Buffer.byteLength(contentForAnalysis, 'utf8'),
            fileSizeKB: getContentSizeKB(contentForAnalysis)
          };
          
          console.log(`📊 Enhanced object count data for job ${jobId}:`, {
            objectsCount: contentValidation.objectsCount,
            contentType: contentValidation.contentType,
            isAnalyzable: contentValidation.isAnalyzable,
            fileSizeKB: responseData.contentAnalysis.fileSizeKB,
            isPriceable: contentValidation.validation.isPriceable
          });
        }

        return ApiResponse.success(res, responseData, 'URL scraping completed successfully');

      } catch (waitError) {
        // Job timed out or failed
        const elapsedTime = Date.now() - requestStartTime;
        console.error(`❌ Job ${jobId} wait failed after ${elapsedTime}ms:`, waitError);
        const errorMessage = waitError instanceof Error ? waitError.message : 'Unknown error occurred';
        
        // Log timeout if it was a timeout error
        if (errorMessage.toLowerCase().includes('timeout') || errorMessage.toLowerCase().includes('timed out')) {
          ScrapeLogger.logJobTimeout(jobId, timeoutMs, elapsedTime);
        }
        
        // Mark job as failed and remove from client's active jobs
        try {
          const markFailedResult = await nodeService.markJobAsFailed(jobId, assignResult.data.client_id, errorMessage);
          if (markFailedResult.success) {
            console.log(`✅ Job ${jobId} successfully marked as failed and removed from active jobs`);
          } else {
            console.warn(`⚠️ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
          }
        } catch (markFailedError) {
          console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
        }
        
        // Check if it's an empty results error
        if (errorMessage.includes('empty results') || errorMessage.includes('no data found')) {
          return ApiResponse.error(res, 'Scraping returned empty results', 422, {
            function: 'ScrapeEmpty',
            message: 'Scraping completed but returned empty results - no data found',
            jobId,
            url,
            scrapeType,
            user_principal_id: assignResult.data.user_principal_id,
            client_id: assignResult.data.client_id,
            state: 'failed',
            error: 'NO_DATA_FOUND',
            timestamp: Date.now(),
            elapsedTimeMs: elapsedTime
          });
        }
        
        return ApiResponse.error(res, `Scraping failed: ${errorMessage}`, 408, {
          jobId,
          url,
          scrapeType,
          timeoutMs,
          elapsedTimeMs: elapsedTime,
          elapsedMinutes: Math.round(elapsedTime / 60000)
        });
      }

    } catch (error) {
      console.error('Error in scrapeUrl operation:', error);
      return ApiResponse.internalError(res, 'Failed to scrape URL');
    }
  });

  // // POST /assignJob - Assign job to optimal node and wait for result
  // router.post('/assignJob', apiKeyMiddleware, async (req: Request, res: Response) => {
  //   try {
  //     const userPrincipalId = (req as any).userPrincipalId;
  //     const { jobId, waitForResult = true, timeoutMs = 300000 } = req.body;

  //     if (!jobId) {
  //       return ApiResponse.validationError(res, 'Missing or invalid jobId in request body');
  //     }

  //     // Check rate limit
  //     const rateLimitCheck = await authService.checkRateLimit(userPrincipalId);
  //     if (!rateLimitCheck) {
  //       return ApiResponse.error(res, 'Rate limit exceeded', 429);
  //     }

  //     const jobResult = await nodeService.getJobWithId(jobId);
  //     if (!jobResult.success) {
  //       return ApiResponse.notFound(res, 'Job not found');
  //     }

  //     if (jobResult.data.clientUUID !== userPrincipalId) {
  //       return ApiResponse.forbidden(res, 'Access denied: Job does not belong to authenticated user');
  //     }

  //     const result = await nodeService.findAndAssignJob(jobId);
  //     if (!result.success) {
  //       return ApiResponse.error(res, 'Failed to find optimal node');
  //     }

  //     if (!result.data) {
  //       const responseData = {
  //         jobId,
  //         message: 'No optimal node found'
  //       };
  //       return ApiResponse.success(res, responseData, 'No optimal node available');
  //     }

  //     // Send WebSocket message to the assigned client
  //     let jobSent = false;
  //     if (hybridServer) {
  //       try {
  //         const wsResult = await hybridServer.sendJobToClient(
  //           result.data.client_id,
  //           result.data.user_principal_id,
  //           result.data.target,
  //           result.data.jobType,
  //           jobId
  //         );
  //         if (wsResult.success) {
  //           console.log(`✅ Job ${jobId} sent via WebSocket to client ${result.data.client_id}`);
  //           jobSent = true;
  //         } else {
  //           console.warn(`⚠️ Failed to send WebSocket message for job ${jobId}: ${wsResult.error}`);
  //         }
  //       } catch (wsError) {
  //         console.error(`❌ WebSocket sending error for job ${jobId}:`, wsError);
  //       }
  //     }

  //     // Record API usage
  //     await authService.recordApiUsage(userPrincipalId);

  //     // If waitForResult is false, return immediately with assignment confirmation
  //     if (!waitForResult || !jobSent) {
  //       const responseData = {
  //         function: 'Notification',
  //         message: 'Client found, sending job details',
  //         jobId,
  //         user_principal_id: result.data.user_principal_id,
  //         client_id: result.data.client_id,
  //         downloadSpeed: result.data.downloadSpeed.toString(),
  //         state: 'assigned',
  //         status: 'OK',
  //         jobAssigned: true
  //       };
  //       return ApiResponse.success(res, responseData, 'Job assigned successfully');
  //     }

  //     // Wait for job completion and return the scraped result
  //     try {
  //       console.log(`⏳ Waiting for job ${jobId} completion...`);
  //       const jobResult = await jobQueueManager.waitForJobCompletion(jobId, result.data.client_id, userPrincipalId, timeoutMs);
        
  //       // get content from job result first, then from stored file
  //       let finalResult = jobResult;
  //       let resultSource = 'job_result';
  //       let contentForAnalysis: string | null = null;
        
  //       if (jobResult && (jobResult.content || jobResult.result)) {
  //         finalResult = jobResult.content || jobResult.result;
  //         contentForAnalysis = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);
  //         console.log(`✅ Using content from job result for job ${jobId}`);
  //       } else {
  //         const storedIdResult = await nodeService.getStoredIdFromJobId(jobId);
  //         if (storedIdResult.success && storedIdResult.data) {
  //           const fileContentResult = await fileService.getFileContentByStoredId(storedIdResult.data);
  //           if (fileContentResult.success) {
  //             contentForAnalysis = fileContentResult.data;
  //             try {
  //               finalResult = JSON.parse(fileContentResult.data);
  //               resultSource = 'stored_file';
  //               console.log(`✅ Retrieved content from stored file for job ${jobId}`);
  //             } catch (parseError) {
  //               finalResult = fileContentResult.data;
  //               resultSource = 'stored_file_raw';
  //               console.log(`✅ Retrieved raw content from stored file for job ${jobId}`);
  //             }
  //           }
  //         }
  //       }

  //       // Check for empty results and mark job as failed if necessary
  //       const isEmptyResult = checkIfResultIsEmpty(finalResult);
  //       if (isEmptyResult) {
  //         console.log(`❌ Job ${jobId} returned empty results - marking as failed`);
          
  //         // Mark job as failed
  //         try {
  //           const markFailedResult = await nodeService.markJobAsFailed(jobId, result.data.client_id, 'Empty results returned');
  //           if (markFailedResult.success) {
  //             console.log(`✅ Job ${jobId} successfully marked as failed due to empty results`);
  //           } else {
  //             console.warn(`⚠️ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
  //           }
  //         } catch (markFailedError) {
  //           console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
  //         }
          
  //         return ApiResponse.error(res, 'Scraping returned empty results', 422, {
  //           function: 'ScrapeEmpty',
  //           message: 'Scraping completed but returned empty results - no data found',
  //           jobId,
  //           user_principal_id: result.data.user_principal_id,
  //           client_id: result.data.client_id,
  //           state: 'failed',
  //           error: 'NO_DATA_FOUND',
  //           timestamp: Date.now()
  //         });
  //       }

  //       // Calculate pricing information if we have content
  //       let pricingInfo = null;
  //       if (contentForAnalysis) {
  //         try {
  //           // Get job details to determine scrape type
  //           const jobDetails = await nodeService.getJobWithId(jobId);
  //           const scrapeType = jobDetails.success ? jobDetails.data.jobType : 'unknown';
            
  //           console.log(`💰 Calculating pricing for job ${jobId} (scrapeType: ${scrapeType})`);
            
  //           // Get file size in KB
  //           const fileSizeKB = getContentSizeKB(contentForAnalysis);
  //           console.log(`📊 File size: ${fileSizeKB} KB`);
            
  //           // Analyze JSON content based on scrape type to get accurate object count
  //           const dataAnalysis = analyzeScrapedDataByType(contentForAnalysis, scrapeType);
  //           const objectsCount = dataAnalysis ? dataAnalysis.dataCount : 0;
  //           console.log(`📊 Objects count for ${scrapeType}: ${objectsCount}`);
            
  //           // Calculate price
  //           const pricing = calculateJobPrice({ fileSizeKB, objectsCount });
  //           console.log(`💰 Pricing calculation: ${pricing.breakdown}`);
            
  //           pricingInfo = {
  //             price: pricing.totalPrice,
  //             objectsCount,
  //             fileSizeKB,
  //             ...(dataAnalysis && { dataAnalysis })
  //           };
            
  //           // Update the job with pricing information
  //           await nodeService.updateJobPricingInfo(jobId, pricingInfo);
  //           console.log(`✅ Job ${jobId} updated with pricing information`);
            
  //         } catch (pricingError) {
  //           console.warn(`⚠️ Failed to calculate pricing for job ${jobId}:`, pricingError);
  //         }
  //       }

  //       // Automatically store purchase for the user who requested the job assignment
  //       try {
  //         const purchaseResult = await marketplaceService.storePurchase(userPrincipalId, jobId);
  //         if (purchaseResult.success) {
  //           console.log(`✅ Automatic purchase stored for user ${userPrincipalId} -> job ${jobId} (assignJob)`);
  //         } else {
  //           console.warn(`⚠️ Failed to store automatic purchase for user ${userPrincipalId} -> job ${jobId} (assignJob):`, purchaseResult.error);
  //         }
  //       } catch (purchaseError) {
  //         console.warn(`⚠️ Error storing automatic purchase for user ${userPrincipalId} -> job ${jobId} (assignJob):`, purchaseError);
  //       }

  //       return ApiResponse.success(res, {
  //         function: 'JobCompleteWithResult',
  //         message: resultSource === 'job_result' ? 'Job completed successfully' : 
  //                  resultSource === 'stored_file' ? 'Job completed successfully (from stored file)' :
  //                  'Job completed but result content not available',
  //         jobId,
  //         result: finalResult,
  //         user_principal_id: result.data.user_principal_id,
  //         client_id: result.data.client_id,
  //         state: 'completed',
  //         status: 'OK',
  //         completedAt: Date.now(),
  //         resultSource,
  //         ...(pricingInfo && {
  //           pricing: {
  //             price: pricingInfo.price,
  //             objectsCount: pricingInfo.objectsCount,
  //             currency: 'USDT'
  //           }
  //         })
  //       }, 'Job completed and result retrieved successfully');

  //     } catch (waitError) {
  //       // Job timed out or failed
  //       console.error(`❌ Job ${jobId} wait failed:`, waitError);
  //       const errorMessage = waitError instanceof Error ? waitError.message : 'Unknown error occurred';
        
  //       // Mark job as failed and remove from client's active jobs
  //       try {
  //         const markFailedResult = await nodeService.markJobAsFailed(jobId, result.data.client_id, errorMessage);
  //         if (markFailedResult.success) {
  //           console.log(`✅ Job ${jobId} successfully marked as failed and removed from active jobs`);
  //         } else {
  //           console.warn(`⚠️ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
  //         }
  //       } catch (markFailedError) {
  //         console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
  //       }
        
  //       // Check if it's an empty results error
  //       if (errorMessage.includes('empty results') || errorMessage.includes('no data found')) {
  //         return ApiResponse.error(res, 'Scraping returned empty results', 422, {
  //           function: 'ScrapeEmpty',
  //           message: 'Scraping completed but returned empty results - no data found',
  //           jobId,
  //           user_principal_id: result.data.user_principal_id,
  //           client_id: result.data.client_id,
  //           state: 'failed',
  //           error: 'NO_DATA_FOUND',
  //           timestamp: Date.now()
  //         });
  //       }
        
  //       return ApiResponse.error(res, `Job execution failed: ${errorMessage}`, 408);
  //     }

  //   } catch (error) {
  //     console.error('Error assigning job:', error);
  //     return ApiResponse.internalError(res, 'Failed to assign job');
  //   }
  // });

  // // POST /assignJobToClient - Assign job to specific client by principal ID and wait for result
  // router.post('/assignJobToClient', apiKeyMiddleware, async (req: Request, res: Response) => {
  //   try {
  //     const userPrincipalId = (req as any).userPrincipalId;
  //     const { jobId, principalId, waitForResult = true, timeoutMs = 300000 } = req.body;

  //     if (!jobId) {
  //       return ApiResponse.validationError(res, 'Missing or invalid jobId in request body');
  //     }

  //     // Check rate limit
  //     const rateLimitCheck = await authService.checkRateLimit(userPrincipalId);
  //     if (!rateLimitCheck) {
  //       return ApiResponse.error(res, 'Rate limit exceeded', 429);
  //     }

  //     const jobResult = await nodeService.getJobWithId(jobId);
  //     if (!jobResult.success) {
  //       return ApiResponse.notFound(res, 'Job not found');
  //     }

  //     if (jobResult.data.clientUUID !== userPrincipalId) {
  //       return ApiResponse.forbidden(res, 'Access denied: Job does not belong to authenticated user');
  //     }

  //     const result = await nodeService.findAndAssignJobToClient(jobId, principalId || userPrincipalId);
  //     if (!result.success) {
  //       return ApiResponse.error(res, 'Failed to find optimal node');
  //     }

  //     if (!result.data) {
  //       const responseData = {
  //         jobId,
  //         message: 'No optimal node found'
  //       };
  //       return ApiResponse.success(res, responseData, 'No optimal node available');
  //     }

  //     // Send WebSocket message to the assigned client
  //     let jobSent = false;
  //     if (hybridServer) {
  //       try {
  //         const wsResult = await hybridServer.sendJobToClient(
  //           result.data.client_id,
  //           result.data.user_principal_id,
  //           result.data.target,
  //           result.data.jobType,
  //           jobId
  //         );
  //         if (wsResult.success) {
  //           console.log(`✅ Job ${jobId} sent via WebSocket to specific client ${result.data.client_id}`);
  //           jobSent = true;
  //         } else {
  //           console.warn(`⚠️ Failed to send WebSocket message for job ${jobId}: ${wsResult.error}`);
  //         }
  //       } catch (wsError) {
  //         console.error(`❌ WebSocket sending error for job ${jobId}:`, wsError);
  //       }
  //     }

  //     // Record API usage
  //     await authService.recordApiUsage(userPrincipalId);

  //     // If waitForResult is false, return immediately with assignment confirmation
  //     if (!waitForResult || !jobSent) {
  //       const responseData = {
  //         function: 'Notification',
  //         message: 'Client found, sending job details',
  //         jobId,
  //         user_principal_id: result.data.user_principal_id,
  //         client_id: result.data.client_id,
  //         downloadSpeed: result.data.downloadSpeed.toString(),
  //         state: 'assigned',
  //         status: 'OK',
  //         jobAssigned: true
  //       };
  //       return ApiResponse.success(res, responseData, 'Job assigned to client successfully');
  //     }

  //     // Wait for job completion and return the scraped result
  //     try {
  //       console.log(`⏳ Waiting for job ${jobId} completion...`);
  //       const jobResult = await jobQueueManager.waitForJobCompletion(jobId, result.data.client_id, userPrincipalId, timeoutMs);
        
  //       // get content from job result first, then from stored file
  //       let finalResult = jobResult;
  //       let resultSource = 'job_result';
  //       let contentForAnalysis: string | null = null;
        
  //       if (jobResult && (jobResult.content || jobResult.result)) {
  //         finalResult = jobResult.content || jobResult.result;
  //         contentForAnalysis = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult);
  //         console.log(`✅ Using content from job result for job ${jobId}`);
  //       } else {
  //         const storedIdResult = await nodeService.getStoredIdFromJobId(jobId);
  //         if (storedIdResult.success && storedIdResult.data) {
  //           const fileContentResult = await fileService.getFileContentByStoredId(storedIdResult.data);
  //           if (fileContentResult.success) {
  //             contentForAnalysis = fileContentResult.data;
  //             try {
  //               finalResult = JSON.parse(fileContentResult.data);
  //               resultSource = 'stored_file';
  //               console.log(`✅ Retrieved content from stored file for job ${jobId}`);
  //             } catch (parseError) {
  //               finalResult = fileContentResult.data;
  //               resultSource = 'stored_file_raw';
  //               console.log(`✅ Retrieved raw content from stored file for job ${jobId}`);
  //             }
  //           }
  //         }
  //       }

  //       // Check for empty results and mark job as failed if necessary
  //       const isEmptyResult = checkIfResultIsEmpty(finalResult);
  //       if (isEmptyResult) {
  //         console.log(`❌ Job ${jobId} returned empty results - marking as failed`);
          
  //         // Mark job as failed
  //         try {
  //           const markFailedResult = await nodeService.markJobAsFailed(jobId, result.data.client_id, 'Empty results returned');
  //           if (markFailedResult.success) {
  //             console.log(`✅ Job ${jobId} successfully marked as failed due to empty results`);
  //           } else {
  //             console.warn(`⚠️ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
  //           }
  //         } catch (markFailedError) {
  //           console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
  //         }
          
  //         return ApiResponse.error(res, 'Scraping returned empty results', 422, {
  //           function: 'ScrapeEmpty',
  //           message: 'Scraping completed but returned empty results - no data found',
  //           jobId,
  //           user_principal_id: result.data.user_principal_id,
  //           client_id: result.data.client_id,
  //           state: 'failed',
  //           error: 'NO_DATA_FOUND',
  //           timestamp: Date.now()
  //         });
  //       }

  //       // Calculate pricing information if we have content
  //       let pricingInfo = null;
  //       if (contentForAnalysis) {
  //         try {
  //           // Get job details to determine scrape type
  //           const jobDetails = await nodeService.getJobWithId(jobId);
  //           const scrapeType = jobDetails.success ? jobDetails.data.jobType : 'unknown';
            
  //           console.log(`💰 Calculating pricing for job ${jobId} (scrapeType: ${scrapeType})`);
            
  //           // Get file size in KB
  //           const fileSizeKB = getContentSizeKB(contentForAnalysis);
  //           console.log(`📊 File size: ${fileSizeKB} KB`);
            
  //           // Analyze JSON content based on scrape type to get accurate object count
  //           const dataAnalysis = analyzeScrapedDataByType(contentForAnalysis, scrapeType);
  //           const objectsCount = dataAnalysis ? dataAnalysis.dataCount : 0;
  //           console.log(`📊 Objects count for ${scrapeType}: ${objectsCount}`);
            
  //           // Calculate price
  //           const pricing = calculateJobPrice({ fileSizeKB, objectsCount });
  //           console.log(`💰 Pricing calculation: ${pricing.breakdown}`);
            
  //           pricingInfo = {
  //             price: pricing.totalPrice,
  //             objectsCount,
  //             fileSizeKB,
  //             ...(dataAnalysis && { dataAnalysis })
  //           };
            
  //           // Update the job with pricing information
  //           await nodeService.updateJobPricingInfo(jobId, pricingInfo);
  //           console.log(`✅ Job ${jobId} updated with pricing information`);
            
  //         } catch (pricingError) {
  //           console.warn(`⚠️ Failed to calculate pricing for job ${jobId}:`, pricingError);
  //         }
  //       }

  //       // Automatically store purchase for the user who requested the job assignment to specific client
  //       try {
  //         const purchaseResult = await marketplaceService.storePurchase(userPrincipalId, jobId);
  //         if (purchaseResult.success) {
  //           console.log(`✅ Automatic purchase stored for user ${userPrincipalId} -> job ${jobId} (assignJobToClient)`);
  //         } else {
  //           console.warn(`⚠️ Failed to store automatic purchase for user ${userPrincipalId} -> job ${jobId} (assignJobToClient):`, purchaseResult.error);
  //         }
  //       } catch (purchaseError) {
  //         console.warn(`⚠️ Error storing automatic purchase for user ${userPrincipalId} -> job ${jobId} (assignJobToClient):`, purchaseError);
  //       }

  //       return ApiResponse.success(res, {
  //         function: 'JobCompleteWithResult',
  //         message: resultSource === 'job_result' ? 'Job completed successfully' : 
  //                  resultSource === 'stored_file' ? 'Job completed successfully (from stored file)' :
  //                  'Job completed but result content not available',
  //         jobId,
  //         result: finalResult,
  //         user_principal_id: result.data.user_principal_id,
  //         client_id: result.data.client_id,
  //         state: 'completed',
  //         status: 'OK',
  //         completedAt: Date.now(),
  //         resultSource,
  //         ...(pricingInfo && {
  //           pricing: {
  //             price: pricingInfo.price,
  //             objectsCount: pricingInfo.objectsCount,
  //             currency: 'USDT'
  //           }
  //         })
  //       }, 'Job assigned to client, completed and result retrieved successfully');

  //     } catch (waitError) {
  //       // Job timed out or failed
  //       console.error(`❌ Job ${jobId} wait failed:`, waitError);
  //       const errorMessage = waitError instanceof Error ? waitError.message : 'Unknown error occurred';
        
  //       // Mark job as failed and remove from client's active jobs
  //       try {
  //         const markFailedResult = await nodeService.markJobAsFailed(jobId, result.data.client_id, errorMessage);
  //         if (markFailedResult.success) {
  //           console.log(`✅ Job ${jobId} successfully marked as failed and removed from active jobs`);
  //         } else {
  //           console.warn(`⚠️ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
  //         }
  //       } catch (markFailedError) {
  //         console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
  //       }
        
  //       // Check if it's an empty results error
  //       if (errorMessage.includes('empty results') || errorMessage.includes('no data found')) {
  //         return ApiResponse.error(res, 'Scraping returned empty results', 422, {
  //           function: 'ScrapeEmpty',
  //           message: 'Scraping completed but returned empty results - no data found',
  //           jobId,
  //           user_principal_id: result.data.user_principal_id,
  //           client_id: result.data.client_id,
  //           state: 'failed',
  //           error: 'NO_DATA_FOUND',
  //           timestamp: Date.now()
  //         });
  //       }
        
  //       return ApiResponse.error(res, `Job execution failed: ${errorMessage}`, 408);
  //     }

  //   } catch (error) {
  //     console.error('Error assigning job to client:', error);
  //     return ApiResponse.internalError(res, 'Failed to assign job to client');
  //   }
  // });

  // // POST /resendJob - Resend failed job
  // router.post('/resendJob', apiKeyMiddleware, async (req: Request, res: Response) => {
  //   try {
  //     const userPrincipalId = (req as any).userPrincipalId;
  //     const { jobId } = req.body;

  //     if (!jobId) {
  //       return ApiResponse.validationError(res, 'Missing or invalid jobId in request body');
  //     }

  //     // Check rate limit
  //     const rateLimitCheck = await authService.checkRateLimit(userPrincipalId);
  //     if (!rateLimitCheck) {
  //       return ApiResponse.error(res, 'Rate limit exceeded', 429);
  //     }

  //     const jobResult = await nodeService.getJobWithId(jobId);
  //     if (!jobResult.success) {
  //       return ApiResponse.notFound(res, 'Job not found');
  //     }

  //     if (jobResult.data.clientUUID !== userPrincipalId) {
  //       return ApiResponse.forbidden(res, 'Access denied: Job does not belong to authenticated user');
  //     }

  //     const result = await nodeService.resendJob(jobId);
  //     if (!result.success) {
  //       return ApiResponse.error(res, 'Failed to resend job');
  //     }

  //     if (!result.data) {
  //       const responseData = {
  //         jobId,
  //         message: 'No optimal node found'
  //       };
  //       return ApiResponse.success(res, responseData, 'No optimal node available');
  //     }

  //     // Send WebSocket message to the assigned client for resend
  //     if (hybridServer) {
  //       try {
  //         const wsResult = await hybridServer.sendJobToClient(
  //           result.data.client_id,
  //           result.data.user_principal_id,
  //           result.data.target,
  //           result.data.jobType,
  //           jobId
  //         );
  //         if (wsResult.success) {
  //           console.log(`✅ Job ${jobId} resent via WebSocket to client ${result.data.client_id}`);
  //         } else {
  //           console.warn(`⚠️ Failed to resend WebSocket message for job ${jobId}: ${wsResult.error}`);
  //         }
  //       } catch (wsError) {
  //         console.error(`❌ WebSocket resend error for job ${jobId}:`, wsError);
  //       }
  //     }

  //     // Record API usage
  //     await authService.recordApiUsage(userPrincipalId);

  //     const responseData = {
  //       function: 'Notification',
  //       message: 'Client found, sending job details',
  //       jobId,
  //       user_principal_id: result.data.user_principal_id,
  //       client_id: result.data.client_id,
  //       downloadSpeed: result.data.downloadSpeed.toString(),
  //       state: 'assigned',
  //       status: 'OK',
  //       jobAssigned: true
  //     };

  //     return ApiResponse.success(res, responseData, 'Job resent successfully');
  //   } catch (error) {
  //     console.error('Error resending job:', error);
  //     return ApiResponse.internalError(res, 'Failed to resend job');
  //   }
  // });

  // ==================== MARKETPLACE ENDPOINTS ====================

  // GET /marketplace/list-jobs - List all completed jobs for marketplace
  router.get('/marketplace/list-jobs', async (req: Request, res: Response) => {
    try {
      const { limit = 50, offset = 0, search, sort = 'desc' } = req.query;
      
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      const searchTerm = search ? search as string : undefined;
      const sortDirection = sort === 'asc' ? 'asc' : 'desc';

      if (isNaN(limitNum) || isNaN(offsetNum) || limitNum < 1 || offsetNum < 0) {
        return ApiResponse.validationError(res, 'Invalid limit or offset parameters');
      }

      if (limitNum > 100) {
        return ApiResponse.validationError(res, 'Limit cannot exceed 100');
      }

      if (sortDirection !== 'asc' && sortDirection !== 'desc') {
        return ApiResponse.validationError(res, 'Sort direction must be either "asc" or "desc"');
      }

      const jobsResult = await marketplaceService.getCompletedJobs(limitNum, offsetNum, searchTerm, sortDirection);
      if (!jobsResult.success) {
        return ApiResponse.error(res, 'Failed to fetch marketplace jobs: ' + jobsResult.error.message);
      }

      return ApiResponse.success(res, jobsResult.data, 'Marketplace jobs retrieved successfully');
    } catch (error) {
      console.error('Error getting marketplace jobs:', error);
      return ApiResponse.internalError(res, 'Failed to get marketplace jobs');
    }
  });

  // GET /marketplace/job/:job_id/details - Get detailed information about a specific job (OPTIMIZED)
  router.get('/marketplace/job/:job_id/details', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const timeoutMs = 10000; // 10 second timeout
    
    try {
      const { job_id } = req.params;

      if (!job_id) {
        return ApiResponse.validationError(res, 'Missing job_id parameter');
      }

      console.log(`🔍 Getting job details for: ${job_id}`);

      // Set response timeout
      const timeoutId = setTimeout(() => {
        if (!res.headersSent) {
          console.error(`⏰ Timeout getting job details for ${job_id} after ${timeoutMs}ms`);
          ApiResponse.error(res, 'Request timeout - job details took too long to load', 408);
        }
      }, timeoutMs);

      try {
        // Get job details with optimized service call
        const jobDetailsResult = await Promise.race([
          marketplaceService.getJobDetailsOptimized(job_id),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Service timeout')), timeoutMs - 1000)
          )
        ]) as any;

        clearTimeout(timeoutId);

        if (!jobDetailsResult.success) {
          if (jobDetailsResult.error.type === 'NotFound') {
            return ApiResponse.notFound(res, 'Job not found');
          }
          if (jobDetailsResult.error.type === 'InvalidInput') {
            return ApiResponse.error(res, jobDetailsResult.error.message, 400);
          }
          return ApiResponse.error(res, 'Failed to get job details: ' + jobDetailsResult.error.message);
        }

        const jobDetails = jobDetailsResult.data;

        // Build response data efficiently
        const responseData = {
          job: {
            jobID: jobDetails.job.jobID,
            jobType: jobDetails.job.jobType,
            target: jobDetails.job.target,
            job_views: jobDetails.job.job_views,
            job_downloads: jobDetails.job.job_downloads,
            createdAt: jobDetails.job.assignedAt,
            // Include pricing information if available
            ...(jobDetails.pricing && { pricing: jobDetails.pricing })
          },
          file: jobDetails.fileMetadata ? {
            id: jobDetails.fileMetadata.id,
            name: jobDetails.fileMetadata.name,
            content_type: jobDetails.fileMetadata.content_type,
            size: jobDetails.fileMetadata.size,
            created_at: jobDetails.fileMetadata.created_at
          } : null,
          preview: jobDetails.filePreview || null,
          hasContent: jobDetails.hasContent || false,
          dataCount: jobDetails.dataCount || null,
          included: jobDetails.included || null
        };

        const duration = Date.now() - startTime;
        console.log(`✅ Job details retrieved for ${job_id} in ${duration}ms`);

        return ApiResponse.success(res, responseData, 'Job details retrieved successfully');
      } catch (serviceError) {
        clearTimeout(timeoutId);
        throw serviceError;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error getting job details for ${req.params.job_id} after ${duration}ms:`, error);
      return ApiResponse.internalError(res, 'Failed to get job details');
    }
  });

  // GET /marketplace/job/:job_id/download - Download job file
  router.get('/marketplace/job/:job_id/download', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const { job_id } = req.params;
      const userPrincipalId = (req as any).userPrincipalId;

      if (!job_id) {
        return ApiResponse.validationError(res, 'Missing job_id parameter');
      }

      console.log(`🔍 Getting job download for: ${job_id} by user: ${userPrincipalId}`);

      // First verify the user has purchase access to this job
      const accessResult = await marketplaceService.hasPurchaseAccess(userPrincipalId, job_id);
      if (!accessResult.success) {
        return ApiResponse.error(res, 'Failed to verify purchase access: ' + accessResult.error.message);
      }

      if (!accessResult.data) {
        return ApiResponse.forbidden(res, 'Access denied: User has not purchased this job');
      }

      console.log(`✅ Purchase access verified for user ${userPrincipalId} -> job ${job_id}`);

      const downloadResult = await marketplaceService.getJobDownload(job_id);
      if (!downloadResult.success) {
        if (downloadResult.error.type === 'NotFound') {
          return ApiResponse.notFound(res, 'Job or file not found');
        }
        if (downloadResult.error.type === 'InvalidInput') {
          return ApiResponse.error(res, downloadResult.error.message, 400);
        }
        return ApiResponse.error(res, 'Failed to get job download: ' + downloadResult.error.message);
      }

      const { filePath, metadata } = downloadResult.data;

      // Set appropriate headers for file download
      res.setHeader('Content-Type', metadata.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${metadata.name}"`);
      
      const fs = require('fs');
      
      // For dual storage, prefer local file (faster), fallback to canister
      if (filePath.startsWith('canister:') || !fs.existsSync(filePath)) {
        // File not available locally, get from file service (handles canister/dual storage)
        console.log(`📦 File not on local disk, fetching content via file service: ${metadata.id}`);
        const contentResult = await fileService.getFileContentByStoredId(metadata.id);
        
        if (!contentResult.success) {
          console.error(`❌ Failed to get file content for ${metadata.id}:`, contentResult.error);
          return ApiResponse.notFound(res, 'File content not available');
        }
        
        const contentBuffer = Buffer.from(contentResult.data, 'utf8');
        return res.send(contentBuffer);
      }
      
      // Stream the file directly from local disk (fastest option)
      console.log(`📁 Streaming from local disk: ${filePath}`);
      const fileStream = fs.createReadStream(filePath);
      
      fileStream.on('error', (streamError: any) => {
        console.error('Error streaming file:', streamError);
        if (!res.headersSent) {
          ApiResponse.internalError(res, 'Failed to stream file');
        }
      });

      return fileStream.pipe(res);
    } catch (error) {
      console.error('Error downloading job file:', error);
      return ApiResponse.internalError(res, 'Failed to download job file');
    }
  });

  // GET /marketplace/stats - Get marketplace statistics
  router.get('/marketplace/stats', async (req: Request, res: Response) => {
    try {
      console.log(`🔍 Getting marketplace statistics`);

      const statsResult = await marketplaceService.getMarketplaceStats();
      if (!statsResult.success) {
        return ApiResponse.error(res, 'Failed to get marketplace stats: ' + statsResult.error.message);
      }

      return ApiResponse.success(res, statsResult.data, 'Marketplace statistics retrieved successfully');
    } catch (error) {
      console.error('Error getting marketplace stats:', error);
      return ApiResponse.internalError(res, 'Failed to get marketplace stats');
    }
  });

  // POST /marketplace/calculate-retroactive-pricing - Calculate pricing for jobs without pricing data (Admin endpoint)
  router.post('/marketplace/calculate-retroactive-pricing', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const { limit = 10, dryRun = true } = req.body;
      
      console.log(`🔍 Starting retroactive pricing calculation (limit: ${limit}, dryRun: ${dryRun})`);
      
      // Get all completed jobs without pricing information via database service
      const allJobsResult = await dbService.getAllJobs();
      if (!allJobsResult.success) {
        return ApiResponse.error(res, 'Failed to fetch jobs for pricing calculation');
      }
      
      const jobsWithoutPricing = allJobsResult.data
        .filter(job => job.state === 'completed' && job.price === undefined)
        .slice(0, limit);
      
      console.log(`📊 Found ${jobsWithoutPricing.length} completed jobs without pricing information`);
      
      const results = [];
      let successCount = 0;
      let errorCount = 0;
      
      for (const job of jobsWithoutPricing) {
        try {
          console.log(`💰 Processing job ${job.jobID}...`);
          
          // Get file content for this job
          const storedIdResult = await nodeService.getStoredIdFromJobId(job.jobID);
          if (!storedIdResult.success || !storedIdResult.data) {
            console.log(`❌ No stored file found for job ${job.jobID}`);
            results.push({
              jobId: job.jobID,
              status: 'skipped',
              reason: 'No stored file found'
            });
            continue;
          }
          
          const fileContentResult = await fileService.getFileContentByStoredId(storedIdResult.data);
          if (!fileContentResult.success) {
            console.log(`❌ Failed to get file content for job ${job.jobID}`);
            results.push({
              jobId: job.jobID,
              status: 'error',
              reason: 'Failed to get file content'
            });
            errorCount++;
            continue;
          }
          
          // Calculate pricing
          const fileSizeKB = getContentSizeKB(fileContentResult.data);
          const dataAnalysis = analyzeScrapedDataByType(fileContentResult.data, job.jobType);
          const objectsCount = dataAnalysis ? dataAnalysis.dataCount : 0;
          const pricing = calculateJobPrice({ fileSizeKB, objectsCount });
          
          console.log(`📊 Job ${job.jobID}: ${fileSizeKB}KB, ${objectsCount} objects, ${pricing.totalPrice} USDT`);
          
          const pricingInfo = {
            price: pricing.totalPrice,
            objectsCount,
            fileSizeKB,
            ...(dataAnalysis && { dataAnalysis })
          };
          
          if (!dryRun) {
            // Actually update the job
            await nodeService.updateJobPricingInfo(job.jobID, pricingInfo);
            console.log(`✅ Updated job ${job.jobID} with pricing information`);
          }
          
          results.push({
            jobId: job.jobID,
            status: dryRun ? 'calculated' : 'updated',
            pricing: {
              price: pricing.totalPrice,
              objectsCount,
              fileSizeKB,
              breakdown: pricing.breakdown
            }
          });
          
          successCount++;
          
        } catch (error) {
          console.error(`❌ Error processing job ${job.jobID}:`, error);
          results.push({
            jobId: job.jobID,
            status: 'error',
            reason: error instanceof Error ? error.message : 'Unknown error'
          });
          errorCount++;
        }
      }
      
      const summary = {
        totalProcessed: results.length,
        successful: successCount,
        errors: errorCount,
        skipped: results.length - successCount - errorCount,
        dryRun
      };
      
      console.log(`📊 Retroactive pricing calculation completed:`, summary);
      
      return ApiResponse.success(res, {
        summary,
        results
      }, `Retroactive pricing calculation ${dryRun ? 'simulated' : 'completed'}`);
      
    } catch (error) {
      console.error('Error in retroactive pricing calculation:', error);
      return ApiResponse.internalError(res, 'Failed to calculate retroactive pricing');
    }
  });

  // POST /marketplace/store-purchase - Store a purchase record for a user and job
  router.post('/marketplace/store-purchase', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const userPrincipalId = (req as any).userPrincipalId;
      const { jobId } = req.body;

      if (!jobId) {
        return ApiResponse.validationError(res, 'Missing required parameter: jobId');
      }

      if (typeof jobId !== 'string') {
        return ApiResponse.validationError(res, 'jobId must be a string');
      }

      console.log(`🔍 Storing purchase: user ${userPrincipalId} -> job ${jobId}`);

      const storeResult = await marketplaceService.storePurchase(userPrincipalId, jobId);
      if (!storeResult.success) {
        if (storeResult.error.type === 'NotFound') {
          return ApiResponse.notFound(res, storeResult.error.message);
        }
        if (storeResult.error.type === 'InvalidInput') {
          return ApiResponse.error(res, storeResult.error.message, 400);
        }
        return ApiResponse.error(res, 'Failed to store purchase: ' + storeResult.error.message);
      }

      // Check if this was a new purchase or already existed
      const accessResult = await marketplaceService.hasPurchaseAccess(userPrincipalId, jobId);
      const isNewPurchase = accessResult.success && accessResult.data;

      return ApiResponse.success(res, {
        userPrincipalId,
        jobId,
        purchased_at: Date.now(),
        isNewPurchase: isNewPurchase
      }, isNewPurchase ? 'Purchase stored successfully' : 'Purchase already exists');
    } catch (error) {
      console.error('Error storing purchase:', error);
      return ApiResponse.internalError(res, 'Failed to store purchase');
    }
  });

  // ==================== JOB TIMEOUT MONITORING ENDPOINTS ====================

  // GET /system/job-timeout-monitor - Get job timeout monitor status
  router.get('/system/job-timeout-monitor', (req: Request, res: Response) => {
    try {
      if (!hybridServer || !hybridServer.getJobTimeoutMonitor) {
        return ApiResponse.error(res, 'Job timeout monitor not available', 503);
      }

      const monitorStatus = hybridServer.getJobTimeoutMonitor().getStatus();
      return ApiResponse.success(res, monitorStatus, 'Job timeout monitor status retrieved successfully');
    } catch (error) {
      console.error('Error getting job timeout monitor status:', error);
      return ApiResponse.internalError(res, 'Failed to get job timeout monitor status');
    }
  });

  // POST /system/job-timeout-monitor/trigger-check - Manually trigger timeout check
  router.post('/system/job-timeout-monitor/trigger-check', async (req: Request, res: Response) => {
    try {
      if (!hybridServer || !hybridServer.getJobTimeoutMonitor) {
        return ApiResponse.error(res, 'Job timeout monitor not available', 503);
      }

      console.log('🔍 Manual job timeout check triggered via API');
      await hybridServer.getJobTimeoutMonitor().triggerCheck();
      
      return ApiResponse.success(res, { 
        message: 'Timeout check triggered successfully',
        timestamp: new Date().toISOString()
      }, 'Manual timeout check completed');
    } catch (error) {
      console.error('Error triggering manual timeout check:', error);
      return ApiResponse.internalError(res, 'Failed to trigger timeout check');
    }
  });

  // ==================== SYSTEM MONITORING ENDPOINTS ====================

  // GET /system/capacity - Get system capacity and client utilization
  router.get('/system/capacity', async (req: Request, res: Response) => {
    try {
      const capacityStats = await dbService.getSystemCapacityStats();
      if (!capacityStats.success) {
        return ApiResponse.error(res, 'Failed to get capacity stats: ' + capacityStats.error.message);
      }

      const queueStatus = jobQueueManager.getSystemQueueStatus();
      
      const systemStatus = {
        capacity: capacityStats.data,
        jobQueue: queueStatus,
        timestamp: new Date().toISOString()
      };

      return ApiResponse.success(res, systemStatus, 'System capacity retrieved successfully');
    } catch (error) {
      console.error('Error getting system capacity:', error);
      return ApiResponse.internalError(res, 'Failed to get system capacity');
    }
  });

  // GET /system/clients - Get all clients with detailed capacity information
  router.get('/system/clients', async (req: Request, res: Response) => {
    try {
      const clientsResult = await dbService.getAllClientsWithCapacity();
      if (!clientsResult.success) {
        return ApiResponse.error(res, 'Failed to get clients: ' + clientsResult.error.message);
      }

      // Add queue information for each client
      const clientsWithQueue = clientsResult.data.map(client => ({
        ...client,
        queueStatus: jobQueueManager.getClientQueueStatus(client.client_id)
      }));

      return ApiResponse.success(res, {
        clients: clientsWithQueue,
        summary: {
          total: clientsWithQueue.length,
          online: clientsWithQueue.filter(c => c.isOnline).length,
          active: clientsWithQueue.filter(c => c.clientStatus === 'Active').length,
          atCapacity: clientsWithQueue.filter(c => c.availableCapacity === 0).length
        }
      }, 'Clients information retrieved successfully');
    } catch (error) {
      console.error('Error getting clients information:', error);
      return ApiResponse.internalError(res, 'Failed to get clients information');
    }
  });

  // GET /system/client/:clientId/status - Get specific client status
  router.get('/system/client/:clientId/status', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      
      if (!clientId) {
        return ApiResponse.validationError(res, 'Missing clientId parameter');
      }

      // Find client by client_id
      const allClientsResult = await dbService.getAllNodes();
      if (!allClientsResult.success) {
        return ApiResponse.error(res, 'Failed to get clients');
      }

      const client = allClientsResult.data.find(c => c.client_id === clientId);
      if (!client) {
        return ApiResponse.notFound(res, 'Client not found');
      }

      // Get capacity info
      const capacityInfo = await dbService.getClientCapacityInfo(client.user_principal_id);
      
      // Get queue status
      const queueStatus = jobQueueManager.getClientQueueStatus(clientId);

      const clientStatus = {
        client_id: clientId,
        user_principal_id: client.user_principal_id,
        capacity: capacityInfo,
        queue: queueStatus,
        performance: {
          downloadSpeed: client.downloadSpeed,
          ping: client.ping,
          lastSeen: client.pingTimestamp
        },
        timestamp: new Date().toISOString()
      };

      return ApiResponse.success(res, clientStatus, 'Client status retrieved successfully');
    } catch (error) {
      console.error('Error getting client status:', error);
      return ApiResponse.internalError(res, 'Failed to get client status');
    }
  });

  // POST /system/client/:clientId/capacity - Update client capacity
  router.post('/system/client/:clientId/capacity', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      const { maxConcurrentJobs } = req.body;
      
      if (!clientId) {
        return ApiResponse.validationError(res, 'Missing clientId parameter');
      }

      if (!maxConcurrentJobs || typeof maxConcurrentJobs !== 'number') {
        return ApiResponse.validationError(res, 'Missing or invalid maxConcurrentJobs');
      }

      // Find client by client_id
      const allClientsResult = await dbService.getAllNodes();
      if (!allClientsResult.success) {
        return ApiResponse.error(res, 'Failed to get clients');
      }

      const client = allClientsResult.data.find(c => c.client_id === clientId);
      if (!client) {
        return ApiResponse.notFound(res, 'Client not found');
      }

      // Update capacity
      const updateResult = await dbService.updateClientCapacity(client.user_principal_id, maxConcurrentJobs);
      if (!updateResult.success) {
        return ApiResponse.error(res, 'Failed to update capacity: ' + updateResult.error.message);
      }

      // Get updated capacity info
      const newCapacityInfo = await dbService.getClientCapacityInfo(client.user_principal_id);

      return ApiResponse.success(res, {
        client_id: clientId,
        user_principal_id: client.user_principal_id,
        oldCapacity: client.maxConcurrentJobs,
        newCapacity: maxConcurrentJobs,
        currentStatus: newCapacityInfo
      }, 'Client capacity updated successfully');
    } catch (error) {
      console.error('Error updating client capacity:', error);
      return ApiResponse.internalError(res, 'Failed to update client capacity');
    }
  });

  // GET /system/queue - Get detailed job queue information
  router.get('/system/queue', (req: Request, res: Response) => {
    try {
      const queueStatus = jobQueueManager.getSystemQueueStatus();
      
      return ApiResponse.success(res, {
        ...queueStatus,
        timestamp: new Date().toISOString()
      }, 'Job queue status retrieved successfully');
    } catch (error) {
      console.error('Error getting queue status:', error);
      return ApiResponse.internalError(res, 'Failed to get queue status');
    }
  });

  // DELETE /system/client/:clientId/queue - Clear client queue (emergency use)
  router.delete('/system/client/:clientId/queue', async (req: Request, res: Response) => {
    try {
      const { clientId } = req.params;
      
      if (!clientId) {
        return ApiResponse.validationError(res, 'Missing clientId parameter');
      }

      const clearResult = jobQueueManager.clearClientQueue(clientId);
      
      return ApiResponse.success(res, {
        clientId,
        clearedPending: clearResult.clearedPending,
        clearedWaiting: clearResult.clearedWaiting,
        timestamp: new Date().toISOString()
      }, 'Client queue cleared successfully');
    } catch (error) {
      console.error('Error clearing client queue:', error);
      return ApiResponse.internalError(res, 'Failed to clear client queue');
    }
  });

  // ==================== ADMIN ENDPOINTS ====================

  // POST /admin/cleanup-old-jobs - Clean up jobs created before a specified date
  router.post('/admin/cleanup-old-jobs', async (req: Request, res: Response) => {
    try {
      const { daysAgo = 1, dryRun = false, confirm = false } = req.body;

      // Validate input
      if (typeof daysAgo !== 'number' || daysAgo < 0) {
        return ApiResponse.validationError(res, 'daysAgo must be a non-negative number');
      }

      if (typeof dryRun !== 'boolean') {
        return ApiResponse.validationError(res, 'dryRun must be a boolean');
      }

      if (!dryRun && !confirm) {
        return ApiResponse.validationError(res, 'Set confirm=true to perform actual deletion (dryRun=false)');
      }

      // Calculate cutoff timestamp (jobs created before this will be deleted)
      const cutoffTimestamp = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
      const cutoffDate = new Date(cutoffTimestamp);

      console.log(`🧹 Admin cleanup request: ${dryRun ? 'DRY RUN' : 'LIVE'} - Jobs created before ${cutoffDate.toISOString()}`);

      if (dryRun) {
        // Just get the count of jobs that would be deleted
        const jobsResult = await dbService.getJobsCreatedBefore(cutoffTimestamp);
        if (!jobsResult.success) {
          return ApiResponse.error(res, 'Failed to get jobs for cleanup: ' + jobsResult.error.message);
        }

        const jobsToDelete = jobsResult.data;
        const jobsByState = jobsToDelete.reduce((acc, job) => {
          acc[job.state] = (acc[job.state] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        return ApiResponse.success(res, {
          dryRun: true,
          cutoffDate: cutoffDate.toISOString(),
          cutoffTimestamp,
          jobsToDelete: jobsToDelete.length,
          jobsByState,
          message: `Found ${jobsToDelete.length} jobs that would be deleted`
        }, 'Dry run completed - no jobs were actually deleted');
      } else {
        // Perform actual cleanup
        const cleanupResult = await dbService.cleanupOldJobs(cutoffTimestamp);
        if (!cleanupResult.success) {
          return ApiResponse.error(res, 'Failed to cleanup old jobs: ' + cleanupResult.error.message);
        }

        const { deletedCount, failedDeletions, errors } = cleanupResult.data;

        return ApiResponse.success(res, {
          dryRun: false,
          cutoffDate: cutoffDate.toISOString(),
          cutoffTimestamp,
          deletedCount,
          failedDeletions,
          errors,
          success: failedDeletions.length === 0
        }, `Cleanup completed: ${deletedCount} jobs deleted, ${failedDeletions.length} failed`);
      }
    } catch (error) {
      console.error('Error in admin job cleanup:', error);
      return ApiResponse.internalError(res, 'Failed to cleanup old jobs');
    }
  });

  // GET /admin/api-keys-created - Get API keys created from a specific date until today
  router.get('/admin/api-keys-created', async (req: Request, res: Response) => {
    try {
      const { date } = req.query;
      
      if (!date || typeof date !== 'string') {
        return ApiResponse.validationError(res, 'Missing or invalid date parameter. Expected format: YYYY-MM-DD');
      }

      // Parse the date string (YYYY-MM-DD format)
      const targetDate = new Date(date);
      if (isNaN(targetDate.getTime())) {
        return ApiResponse.validationError(res, 'Invalid date format. Expected: YYYY-MM-DD');
      }

      // Set time boundaries: from the specified date until now
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const now = new Date();

      console.log(`🔍 Searching for API keys created from ${startOfDay.toISOString()} until ${now.toISOString()}`);

      // Get all API key patterns from Redis
      const pattern = `${REDIS_KEYS.API_KEY}*`;
      const keys = await database.getRedisClient().keys(pattern);
      
      if (keys.length === 0) {
        return ApiResponse.success(res, {
          fromDate: date,
          startTime: startOfDay.toISOString(),
          endTime: now.toISOString(),
          apiKeys: [],
          count: 0,
          message: 'No API keys found from the specified date until today'
        }, 'No API keys found from the specified date until today');
      }

      const apiKeysCreatedFromDate = [];
      
      for (const key of keys) {
        try {
          const data = await database.getFileMetadata(key);
          if (data) {
            const apiKeyData = JSON.parse(data);
            
            // Check if the first usage log entry (creation time) falls within the date range
            if (apiKeyData.usageLog && apiKeyData.usageLog.length > 0) {
              const creationTime = new Date(apiKeyData.usageLog[0].timestamp);
              
              if (creationTime >= startOfDay && creationTime <= now) {
                // Extract userPrincipalId from the key (format: apikey:userPrincipalId)
                const userPrincipalId = key.replace(`${REDIS_KEYS.API_KEY}`, '');
                
                apiKeysCreatedFromDate.push({
                  userPrincipalId,
                  apiKey: apiKeyData.apiKey,
                  createdAt: creationTime.toISOString(),
                  createdAtTimestamp: apiKeyData.usageLog[0].timestamp,
                  usageCount: apiKeyData.usageCount,
                  usageLimit: apiKeyData.usageLimit,
                  totalUsageLogs: apiKeyData.usageLog.length
                });
              }
            }
          }
        } catch (parseError) {
          console.warn(`⚠️ Failed to parse API key data for key ${key}:`, parseError);
        }
      }

      // Sort by creation time (newest first)
      apiKeysCreatedFromDate.sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp);

      console.log(`📊 Found ${apiKeysCreatedFromDate.length} API keys created from ${date} until today`);

      return ApiResponse.success(res, {
        fromDate: date,
        startTime: startOfDay.toISOString(),
        endTime: now.toISOString(),
        apiKeys: apiKeysCreatedFromDate,
        count: apiKeysCreatedFromDate.length,
        message: `Found ${apiKeysCreatedFromDate.length} API keys created from ${date} until today`
      }, `API keys created from ${date} until today retrieved successfully`);

    } catch (error) {
      console.error('Error getting API keys created from date:', error);
      return ApiResponse.internalError(res, 'Failed to get API keys created from date');
    }
  });

  // GET /admin/jobs-stats - Get job statistics for admin monitoring
  router.get('/admin/jobs-stats', apiKeyMiddleware, async (req: Request, res: Response) => {
    try {
      const { daysAgo = 7 } = req.query;
      const days = parseInt(daysAgo as string) || 7;
      
      if (days < 0 || days > 365) {
        return ApiResponse.validationError(res, 'daysAgo must be between 0 and 365');
      }

      const cutoffTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);
      
      // Get all jobs
      const allJobsResult = await dbService.getAllJobs();
      if (!allJobsResult.success) {
        return ApiResponse.error(res, 'Failed to get jobs: ' + allJobsResult.error.message);
      }

      const allJobs = allJobsResult.data;
      const recentJobs = allJobs.filter(job => job.assignedAt >= cutoffTimestamp);
      const oldJobs = allJobs.filter(job => job.assignedAt < cutoffTimestamp);

      // Group by state
      const jobsByState = allJobs.reduce((acc, job) => {
        acc[job.state] = (acc[job.state] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const recentJobsByState = recentJobs.reduce((acc, job) => {
        acc[job.state] = (acc[job.state] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const oldJobsByState = oldJobs.reduce((acc, job) => {
        acc[job.state] = (acc[job.state] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Calculate some additional stats
      const completedJobs = allJobs.filter(job => job.state === 'completed');
      const totalRewards = completedJobs.reduce((sum, job) => sum + (job.reward || 0), 0);
      const avgReward = completedJobs.length > 0 ? totalRewards / completedJobs.length : 0;

      const stats = {
        totalJobs: allJobs.length,
        recentJobs: recentJobs.length,
        oldJobs: oldJobs.length,
        jobsByState,
        recentJobsByState,
        oldJobsByState,
        completedJobs: completedJobs.length,
        totalRewards,
        avgReward: Math.round(avgReward * 10000) / 10000, // Round to 4 decimal places
        cutoffDate: new Date(cutoffTimestamp).toISOString(),
        daysAnalyzed: days
      };

      return ApiResponse.success(res, stats, 'Job statistics retrieved successfully');
    } catch (error) {
      console.error('Error getting job stats:', error);
      return ApiResponse.internalError(res, 'Failed to get job statistics');
    }
  });

  return router;
}
