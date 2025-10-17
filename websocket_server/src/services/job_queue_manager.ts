import { EventEmitter } from 'events';
import { ClientJobQueue, JobWaitingPromise } from '../db/types';
import { ScrapeLogger } from '../utils/scrape_logger';

/**
 * JobQueueManager handles WebSocket job delivery to prevent race conditions
 * and manages concurrent job delivery to clients with proper queuing
 */
export class JobQueueManager extends EventEmitter {
  private clientQueues = new Map<string, ClientJobQueue>();
  private processingLocks = new Set<string>();
  private waitingJobs = new Map<string, JobWaitingPromise>();
  private clientJobCounts = new Map<string, number>();
  
  // Configuration
  private readonly JOB_DELIVERY_DELAY = 100; // ms between jobs to same client
  private readonly MAX_QUEUE_SIZE = 50; // Maximum pending jobs per client
  private readonly JOB_TIMEOUT_DEFAULT = 300000; // 5 minutes default timeout

  constructor() {
    super();
    this.startQueueCleanup();
  }

  /**
   * Add a job to the delivery queue for a specific client
   */
  async queueJobForClient(
    clientId: string,
    userPrincipalId: string,
    url: string,
    scrapeType: string,
    jobId: string,
    priority: number = 0,
    post_count: number = 0,
    replies_count: number = 0,
    scrollPauseTime: number = 0
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      // Initialize queue if it doesn't exist
      if (!this.clientQueues.has(clientId)) {
        this.clientQueues.set(clientId, {
          clientId,
          pendingJobs: [],
          isProcessing: false,
          lastProcessedAt: 0
        });
      }

      const queue = this.clientQueues.get(clientId)!;

      // Check queue size limit
      if (queue.pendingJobs.length >= this.MAX_QUEUE_SIZE) {
        return {
          success: false,
          error: `Client ${clientId} queue is full (${this.MAX_QUEUE_SIZE} jobs)`
        };
      }

      // Add job to queue
      const queuedJob = {
        jobId,
        userPrincipalId,
        url,
        scrapeType,
        timestamp: Date.now(),
        priority,
        post_count,
        replies_count,
        scrollPauseTime
      };

      // Insert job based on priority (higher priority first)
      const insertIndex = queue.pendingJobs.findIndex(job => job.priority! < priority);
      if (insertIndex === -1) {
        queue.pendingJobs.push(queuedJob);
      } else {
        queue.pendingJobs.splice(insertIndex, 0, queuedJob);
      }

      console.log(`📬 Queued job ${jobId} for client ${clientId} (queue size: ${queue.pendingJobs.length}, priority: ${priority})`);

      // Start processing queue
      this.processClientQueue(clientId);

      return {
        success: true,
        message: `Job queued for delivery (position: ${queue.pendingJobs.length})`
      };
    } catch (error) {
      console.error(`❌ Failed to queue job ${jobId} for client ${clientId}:`, error);
      return {
        success: false,
        error: `Failed to queue job: ${error}`
      };
    }
  }

  /**
   * Process jobs in a client's queue sequentially
   */
  private async processClientQueue(clientId: string): Promise<void> {
    // Prevent concurrent processing of the same client's queue
    if (this.processingLocks.has(clientId)) {
      return;
    }

    this.processingLocks.add(clientId);

    try {
      const queue = this.clientQueues.get(clientId);
      if (!queue || queue.pendingJobs.length === 0) {
        return;
      }

      queue.isProcessing = true;
      console.log(`🔄 Processing queue for client ${clientId} (${queue.pendingJobs.length} jobs)`);

      while (queue.pendingJobs.length > 0) {
        const job = queue.pendingJobs.shift()!;

        try {
          // Emit job delivery event
          console.log(`📤 Delivering job ${job.jobId} to client ${clientId}`);
          
          const deliveryResult = await this.deliverJobToClient(job);
          
          if (deliveryResult.success) {
            console.log(`✅ Job ${job.jobId} delivered to client ${clientId}`);
            queue.lastProcessedAt = Date.now();
          } else {
            console.error(`❌ Failed to deliver job ${job.jobId} to client ${clientId}:`, deliveryResult.error);
            
            // Re-queue job with lower priority if delivery failed
            if (job.priority! > -5) { // Prevent infinite retries
              job.priority = (job.priority || 0) - 1;
              queue.pendingJobs.unshift(job);
              console.log(`🔄 Re-queued job ${job.jobId} with lower priority: ${job.priority}`);
            } else {
              console.error(`❌ Dropping job ${job.jobId} after too many retry attempts`);
              this.emit('jobDeliveryFailed', { jobId: job.jobId, clientId, reason: 'Max retries exceeded' });
            }
          }

          // Add delay between job deliveries to prevent client flooding
          if (queue.pendingJobs.length > 0) {
            await new Promise(resolve => setTimeout(resolve, this.JOB_DELIVERY_DELAY));
          }

        } catch (error) {
          console.error(`❌ Error processing job ${job.jobId} for client ${clientId}:`, error);
          this.emit('jobDeliveryFailed', { jobId: job.jobId, clientId, error });
        }
      }

      queue.isProcessing = false;
      console.log(`✅ Completed processing queue for client ${clientId}`);

    } catch (error) {
      console.error(`❌ Error processing queue for client ${clientId}:`, error);
    } finally {
      this.processingLocks.delete(clientId);
    }
  }

  /**
   * Deliver a job to a client via WebSocket
   * This method emits an event that the WebSocket handler should listen to
   */
  private async deliverJobToClient(job: {
    jobId: string;
    userPrincipalId: string;
    url: string;
    scrapeType: string;
    timestamp: number;
    post_count: number;
    replies_count: number;
    scrollPauseTime: number;
  }): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Delivery timeout' });
      }, 5000); // 5 second delivery timeout

      // Emit delivery event with callback
      this.emit('deliverJob', job, (result: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        resolve(result);
      });
    });
  }

  /**
   * Wait for a job to complete with enhanced tracking
   */
  async waitForJobCompletion(
    jobId: string,
    clientId: string,
    userPrincipalId: string,
    timeoutMs: number = this.JOB_TIMEOUT_DEFAULT
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Check if job is already being waited for
      if (this.waitingJobs.has(jobId)) {
        console.warn(`⚠️ Job ${jobId} is already being waited for, rejecting duplicate wait`);
        reject(new Error(`Job ${jobId} is already being processed`));
        return;
      }

      const timeout = setTimeout(() => {
        this.waitingJobs.delete(jobId);
        
        // Decrement client job count on timeout
        const currentCount = this.clientJobCounts.get(clientId) || 0;
        if (currentCount > 0) {
          this.clientJobCounts.set(clientId, currentCount - 1);
        }
        
        console.error(`⏰ Job ${jobId} timed out after ${timeoutMs}ms`);
        reject(new Error(`Job ${jobId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Track client job count
      const currentCount = this.clientJobCounts.get(clientId) || 0;
      this.clientJobCounts.set(clientId, currentCount + 1);

      this.waitingJobs.set(jobId, {
        resolve,
        reject,
        timeout,
        startTime: Date.now(),
        clientId,
        userPrincipalId,
        jobId,
        timeoutMs // ⚠️ CRITICAL: Store the timeout so orphan cleanup respects it
      });

      console.log(`⏳ Waiting for job completion: ${jobId} (client: ${clientId}, timeout: ${timeoutMs}ms = ${Math.round(timeoutMs/60000)} minutes)`);
      console.log(`📊 Client ${clientId} now has ${this.clientJobCounts.get(clientId)} active jobs being waited for`);
    });
  }

  /**
   * Resolve a completed job
   */
  resolveJobCompletion(jobId: string, result: any): void {
    const waitingPromise = this.waitingJobs.get(jobId);
    if (waitingPromise) {
      try {
        clearTimeout(waitingPromise.timeout);
        this.waitingJobs.delete(jobId);
        
        // Decrement client job count on completion
        const currentCount = this.clientJobCounts.get(waitingPromise.clientId) || 0;
        if (currentCount > 0) {
          this.clientJobCounts.set(waitingPromise.clientId, currentCount - 1);
        }
        
        const duration = Date.now() - waitingPromise.startTime;
        console.log(`✅ Job ${jobId} completed in ${duration}ms`);
        console.log(`📊 Client ${waitingPromise.clientId} now has ${this.clientJobCounts.get(waitingPromise.clientId)} active jobs being waited for`);
        
        // Log completion duration to scrape logger
        ScrapeLogger.logJobCompletionDuration(jobId, duration);
        
        // Resolve the promise
        waitingPromise.resolve(result);
        
        // Emit completion event (for monitoring)
        this.emit('jobCompleted', { jobId, result, clientId: waitingPromise.clientId });
      } catch (error) {
        console.error(`❌ Error resolving job completion for ${jobId}:`, error);
        try {
          waitingPromise.reject(error);
        } catch (rejectError) {
          console.error(`❌ Error rejecting job ${jobId}:`, rejectError);
        }
      }
    } else {
      console.warn(`⚠️ Job ${jobId} completed but no waiting promise found - may have timed out`);
    }
  }

  /**
   * Reject a failed job
   */
  rejectJobCompletion(jobId: string, error: any): void {
    const waitingPromise = this.waitingJobs.get(jobId);
    if (waitingPromise) {
      try {
        clearTimeout(waitingPromise.timeout);
        this.waitingJobs.delete(jobId);
        
        // Decrement client job count on failure
        const currentCount = this.clientJobCounts.get(waitingPromise.clientId) || 0;
        if (currentCount > 0) {
          this.clientJobCounts.set(waitingPromise.clientId, currentCount - 1);
        }
        
        console.log(`❌ Job ${jobId} failed:`, error);
        console.log(`📊 Client ${waitingPromise.clientId} now has ${this.clientJobCounts.get(waitingPromise.clientId)} active jobs being waited for`);
        
        // Reject the promise
        waitingPromise.reject(error);
        
        // Emit failure event (for monitoring)
        this.emit('jobFailed', { jobId, error, clientId: waitingPromise.clientId });
      } catch (rejectionError) {
        console.error(`❌ Error rejecting job completion for ${jobId}:`, rejectionError);
      }
    } else {
      console.warn(`⚠️ Job ${jobId} failed but no waiting promise found - may have timed out`);
    }
  }

  /**
   * Get queue status for a specific client
   */
  getClientQueueStatus(clientId: string): {
    exists: boolean;
    pendingJobs: number;
    isProcessing: boolean;
    lastProcessedAt: number;
    waitingJobs: number;
  } {
    const queue = this.clientQueues.get(clientId);
    const waitingJobsCount = this.clientJobCounts.get(clientId) || 0;

    if (!queue) {
      return {
        exists: false,
        pendingJobs: 0,
        isProcessing: false,
        lastProcessedAt: 0,
        waitingJobs: waitingJobsCount
      };
    }

    return {
      exists: true,
      pendingJobs: queue.pendingJobs.length,
      isProcessing: queue.isProcessing,
      lastProcessedAt: queue.lastProcessedAt,
      waitingJobs: waitingJobsCount
    };
  }

  /**
   * Get overall system queue status
   */
  getSystemQueueStatus(): {
    totalClients: number;
    activeQueues: number;
    totalPendingJobs: number;
    totalWaitingJobs: number;
    clientQueues: Array<{
      clientId: string;
      pendingJobs: number;
      isProcessing: boolean;
      waitingJobs: number;
    }>;
  } {
    const clientQueues: Array<{
      clientId: string;
      pendingJobs: number;
      isProcessing: boolean;
      waitingJobs: number;
    }> = [];

    let totalPendingJobs = 0;
    let activeQueues = 0;

    for (const [clientId, queue] of this.clientQueues) {
      const waitingJobs = this.clientJobCounts.get(clientId) || 0;
      
      clientQueues.push({
        clientId,
        pendingJobs: queue.pendingJobs.length,
        isProcessing: queue.isProcessing,
        waitingJobs
      });

      totalPendingJobs += queue.pendingJobs.length;
      if (queue.isProcessing || queue.pendingJobs.length > 0) {
        activeQueues++;
      }
    }

    const totalWaitingJobs = Array.from(this.clientJobCounts.values()).reduce((sum, count) => sum + count, 0);

    return {
      totalClients: this.clientQueues.size,
      activeQueues,
      totalPendingJobs,
      totalWaitingJobs,
      clientQueues
    };
  }

  /**
   * Clear all jobs for a specific client (e.g., when client disconnects)
   */
  clearClientQueue(clientId: string): {
    clearedPending: number;
    clearedWaiting: number;
  } {
    let clearedPending = 0;
    let clearedWaiting = 0;

    // Clear pending jobs
    const queue = this.clientQueues.get(clientId);
    if (queue) {
      clearedPending = queue.pendingJobs.length;
      queue.pendingJobs = [];
      queue.isProcessing = false;
      this.clientQueues.delete(clientId);
    }

    // Clear and reject waiting jobs
    const waitingJobsToReject: string[] = [];
    for (const [jobId, waitingPromise] of this.waitingJobs) {
      if (waitingPromise.clientId === clientId) {
        waitingJobsToReject.push(jobId);
      }
    }

    for (const jobId of waitingJobsToReject) {
      this.rejectJobCompletion(jobId, new Error(`Client ${clientId} disconnected`));
      clearedWaiting++;
    }

    // Reset client job count
    this.clientJobCounts.delete(clientId);

    if (clearedPending > 0 || clearedWaiting > 0) {
      console.log(`🧹 Cleared ${clearedPending} pending and ${clearedWaiting} waiting jobs for client ${clientId}`);
    }

    return { clearedPending, clearedWaiting };
  }

  /**
   * Periodic cleanup of orphaned jobs and stale queues
   */
  private startQueueCleanup(): void {
    setInterval(() => {
      this.cleanupOrphanedJobs();
      this.cleanupStaleQueues();
    }, 300000); // Run every 5 minutes
  }

  /**
   * Clean up jobs that have been waiting too long (exceeded their individual timeout + grace period)
   */
  private cleanupOrphanedJobs(): void {
    const now = Date.now();
    const orphanedJobs: string[] = [];
    const GRACE_PERIOD = 300000; // 5 minutes grace period after timeout

    for (const [jobId, waitingPromise] of this.waitingJobs) {
      const elapsed = now - waitingPromise.startTime;
      // Use the job's specific timeout if available, otherwise use default (5 minutes)
      const jobTimeout = (waitingPromise as any).timeoutMs || this.JOB_TIMEOUT_DEFAULT;
      const maxAllowedTime = jobTimeout + GRACE_PERIOD;
      
      // Only consider it orphaned if it exceeded its own timeout + grace period
      if (elapsed > maxAllowedTime) {
        orphanedJobs.push(jobId);
        console.warn(`🧹 Job ${jobId} is orphaned: elapsed ${Math.round(elapsed/60000)}min > allowed ${Math.round(maxAllowedTime/60000)}min (timeout: ${Math.round(jobTimeout/60000)}min + ${Math.round(GRACE_PERIOD/60000)}min grace)`);
      }
    }

    if (orphanedJobs.length > 0) {
      console.warn(`🧹 Cleaning up ${orphanedJobs.length} orphaned jobs that exceeded their timeouts`);
      for (const jobId of orphanedJobs) {
        this.rejectJobCompletion(jobId, new Error(`Job ${jobId} was orphaned and cleaned up (exceeded timeout + grace period)`));
      }
    }
  }

  /**
   * Clean up stale queues that haven't been processed recently
   */
  private cleanupStaleQueues(): void {
    const now = Date.now();
    const staleThreshold = 3600000; // 60 minutes
    const stalQueues: string[] = [];

    for (const [clientId, queue] of this.clientQueues) {
      if (queue.pendingJobs.length === 0 && 
          !queue.isProcessing && 
          now - queue.lastProcessedAt > staleThreshold) {
        stalQueues.push(clientId);
      }
    }

    for (const clientId of stalQueues) {
      this.clientQueues.delete(clientId);
    }

    if (stalQueues.length > 0) {
      console.log(`🧹 Cleaned up ${stalQueues.length} stale client queues`);
    }
  }
}

// Singleton instance
export const jobQueueManager = new JobQueueManager();
