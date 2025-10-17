import fs from 'fs';
import path from 'path';

/**
 * Scrape Logger - Dedicated logger for tracking scrape job timing and flow
 * Logs are written to logs/scrape/ directory with daily rotation
 */
export class ScrapeLogger {
  private static logsDir = path.join(process.cwd(), 'logs', 'scrape');
  private static currentLogFile: string | null = null;
  private static writeStream: fs.WriteStream | null = null;

  /**
   * Initialize the logger (create directories if they don't exist)
   */
  static initialize(): void {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
        console.log(`✅ Created scrape logs directory: ${this.logsDir}`);
      }
    } catch (error) {
      console.error('❌ Failed to create scrape logs directory:', error);
    }
  }

  /**
   * Get current log file path (creates new file daily)
   */
  private static getCurrentLogFile(): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFileName = `scrape-${dateStr}.log`;
    const logFilePath = path.join(this.logsDir, logFileName);

    // If log file changed (new day), close old stream and open new one
    if (this.currentLogFile !== logFilePath) {
      if (this.writeStream) {
        this.writeStream.end();
      }
      this.currentLogFile = logFilePath;
      this.writeStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    }

    return logFilePath;
  }

  /**
   * Write log entry
   */
  private static writeLog(level: string, message: string, data?: any): void {
    try {
      this.getCurrentLogFile();
      
      const timestamp = new Date().toISOString();
      let logEntry = `[${timestamp}] [${level}] ${message}`;
      
      if (data) {
        logEntry += ` ${JSON.stringify(data)}`;
      }
      
      logEntry += '\n';

      if (this.writeStream) {
        this.writeStream.write(logEntry);
      }

      // Also log to console for visibility
      console.log(logEntry.trim());
    } catch (error) {
      console.error('❌ Failed to write scrape log:', error);
    }
  }

  /**
   * Log when WebSocket message arrives at server
   */
  static logMessageArrival(jobId: string, messageType: string): void {
    this.writeLog('ARRIVAL', `WebSocket message ARRIVED at server for job ${jobId}, type: ${messageType}`);
  }

  /**
   * Log when scrape result message is received by handler
   */
  static logMessageReceived(jobId: string, clientId: string): void {
    this.writeLog('RECEIVED', `TWITTER_SCRAPE_RESULT message RECEIVED from client ${clientId} for job ${jobId}`);
  }

  /**
   * Log message parsing
   */
  static logMessageParsed(jobId: string): void {
    this.writeLog('PARSED', `Message parsed for job ${jobId}`);
  }

  /**
   * Log file storage start
   */
  static logFileStorageStart(jobId: string): void {
    this.writeLog('FILE_STORAGE', `Starting file storage for job ${jobId}`);
  }

  /**
   * Log file storage duration
   */
  static logFileStorageDuration(jobId: string, durationMs: number): void {
    this.writeLog('FILE_STORAGE', `File storage took ${durationMs}ms for job ${jobId}`, { jobId, durationMs });
  }

  /**
   * Log job update start
   */
  static logJobUpdateStart(jobId: string, clientId: string, storedId: string | null): void {
    this.writeLog('JOB_UPDATE', `Updating job completion: jobId=${jobId}, clientId=${clientId}, storedId=${storedId}`);
  }

  /**
   * Log job update duration
   */
  static logJobUpdateDuration(jobId: string, durationMs: number): void {
    this.writeLog('JOB_UPDATE', `Job update took ${durationMs}ms for job ${jobId}`, { jobId, durationMs });
  }

  /**
   * Log event emission
   */
  static logEventEmission(jobId: string): void {
    this.writeLog('EVENT_EMIT', `Emitting jobCompleted event for jobId: ${jobId}`);
  }

  /**
   * Log job completion event emitted
   */
  static logEventEmitted(jobId: string): void {
    this.writeLog('EVENT_EMIT', `Job completion event emitted for jobId: ${jobId}`);
  }

  /**
   * Log total processing time
   */
  static logTotalProcessingTime(jobId: string, totalMs: number): void {
    this.writeLog('TIMING', `Total TWITTER_SCRAPE_RESULT processing time for job ${jobId}: ${totalMs}ms`, { 
      jobId, 
      totalProcessingTimeMs: totalMs 
    });
  }

  /**
   * Log when JobQueue receives jobCompleted event
   */
  static logJobQueueEventReceived(jobId: string, hasError: boolean): void {
    const status = hasError ? 'with error' : 'successfully';
    this.writeLog('JOBQUEUE', `JobQueue received jobCompleted event for job ${jobId} ${status}`);
  }

  /**
   * Log when JobQueue resolves/rejects job
   */
  static logJobQueueResolution(jobId: string, success: boolean, error?: any): void {
    if (success) {
      this.writeLog('JOBQUEUE', `Resolving job ${jobId} successfully`);
    } else {
      this.writeLog('JOBQUEUE', `Rejecting job ${jobId} with error`, { error: error?.message || error });
    }
  }

  /**
   * Log job completion duration (from job sent to completion)
   */
  static logJobCompletionDuration(jobId: string, durationMs: number): void {
    this.writeLog('COMPLETION', `Job ${jobId} completed in ${durationMs}ms`, { 
      jobId, 
      completionTimeMs: durationMs 
    });
  }

  /**
   * Log scrapeUrl request start
   */
  static logScrapeUrlStart(jobId: string, url: string, scrapeType: string, timeoutMs: number, params: any): void {
    this.writeLog('SCRAPE_START', `Starting scrapeUrl: jobId=${jobId}, url=${url}, scrapeType=${scrapeType}, timeoutMs=${timeoutMs}`, {
      jobId,
      url,
      scrapeType,
      timeoutMs,
      timeoutMinutes: Math.round(timeoutMs / 60000),
      ...params
    });
  }

  /**
   * Log waiting for job completion
   */
  static logWaitingForCompletion(jobId: string, clientId: string, timeoutMs: number): void {
    this.writeLog('WAITING', `Waiting for job ${jobId} completion (client: ${clientId}, timeout: ${timeoutMs}ms = ${Math.round(timeoutMs / 60000)} minutes)`);
  }

  /**
   * Log job timeout
   */
  static logJobTimeout(jobId: string, timeoutMs: number, elapsedMs: number): void {
    this.writeLog('TIMEOUT', `Job ${jobId} timed out after ${elapsedMs}ms (timeout was ${timeoutMs}ms = ${Math.round(timeoutMs / 60000)} minutes)`, {
      jobId,
      timeoutMs,
      elapsedMs,
      timeoutMinutes: Math.round(timeoutMs / 60000),
      elapsedMinutes: Math.round(elapsedMs / 60000)
    });
  }

  /**
   * Log HTTP timeout configuration
   */
  static logHttpTimeout(route: string, requestTimeoutMs: number, serverTimeoutMs: number): void {
    this.writeLog('HTTP_TIMEOUT', `HTTP timeout configured for ${route}: request=${requestTimeoutMs}ms (${Math.round(requestTimeoutMs / 60000)}min), server=${serverTimeoutMs}ms (${Math.round(serverTimeoutMs / 60000)}min)`);
  }

  /**
   * Close the logger (cleanup)
   */
  static close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

// Initialize logger on module load
ScrapeLogger.initialize();


