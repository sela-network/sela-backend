import { EventEmitter } from 'events';
import { DatabaseService } from '../db/service';
import { Database } from '../db/database';
import { JobState } from '../db/types';

/**
 * Job Timeout Monitor Service
 * Monitors active jobs and marks them as failed if they've been running for too long
 */
export class JobTimeoutMonitor extends EventEmitter {
  private databaseService: DatabaseService;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly TIMEOUT_MINUTES = 60; // 60 minutes timeout
  private readonly CHECK_INTERVAL_MS = 120000; // Check every 2 minutes
  private isRunning = false;

  constructor(database: Database) {
    super();
    this.databaseService = new DatabaseService(database);
  }

  /**
   * Start the job timeout monitor
   */
  start(): void {
    if (this.isRunning) {
      console.log('⚠️ Job timeout monitor is already running');
      return;
    }

    console.log(`🕐 Starting job timeout monitor (checking every ${this.CHECK_INTERVAL_MS / 1000 / 60}min, timeout: ${this.TIMEOUT_MINUTES}min)`);
    
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.checkForTimedOutJobs().catch(error => {
        console.error('❌ Error in job timeout check:', error);
      });
    }, this.CHECK_INTERVAL_MS);

    // Run initial check after 2 minutes
    setTimeout(() => {
      this.checkForTimedOutJobs().catch(error => {
        console.error('❌ Error in initial job timeout check:', error);
      });
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the job timeout monitor
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('🛑 Job timeout monitor stopped');
  }

  /**
   * Check for jobs that have been active for too long
   */
  private async checkForTimedOutJobs(): Promise<void> {
    try {
      console.log('🔍 Checking for timed out jobs...');
      
      // Get all clients with their active jobs
      const allClientsResult = await this.databaseService.getAllNodes();
      if (!allClientsResult.success) {
        console.error('❌ Failed to get clients for timeout check:', allClientsResult.error);
        return;
      }

      const clients = allClientsResult.data;
      const now = Date.now();
      const timeoutThreshold = this.TIMEOUT_MINUTES * 60 * 1000; // Convert to milliseconds
      let totalTimedOutJobs = 0;
      let totalClientsChecked = 0;

      for (const client of clients) {
        if (!client.activeJobs || client.activeJobs.length === 0) {
          continue;
        }

        totalClientsChecked++;
        const jobsToMarkAsFailed: string[] = []; // Jobs that actually timed out and need to be marked as failed
        const jobsToCleanup: string[] = []; // Jobs that are already completed/failed, just need cleanup

        // Check each active job for this client
        for (const jobId of client.activeJobs) {
          try {
            const jobResult = await this.databaseService.getJobWithID(jobId);
            if (!jobResult.success) {
              console.log(`⚠️ Job ${jobId} not found in database, removing from client's active jobs`);
              jobsToCleanup.push(jobId);
              continue;
            }

            const job = jobResult.data;
            
            // If job is already completed or failed, just clean it up without changing state
            if (job.state === JobState.COMPLETED || job.state === JobState.FAILED) {
              console.log(`✅ Job ${jobId} is already in terminal state (${job.state}), removing from client's active jobs`);
              jobsToCleanup.push(jobId);
              continue;
            }
            
            // If job is in pending state, skip it (not actively being processed yet)
            if (job.state === JobState.PENDING) {
              console.log(`⏳ Job ${jobId} is still pending, not checking for timeout yet`);
              continue;
            }

            // Only check jobs that are in ONGOING state
            if (job.state !== JobState.ONGOING) {
              console.log(`⚠️ Job ${jobId} is in unexpected state (${job.state}), removing from client's active jobs`);
              jobsToCleanup.push(jobId);
              continue;
            }

            // Check if job has been running for too long
            const jobDuration = now - job.assignedAt;
            if (jobDuration > timeoutThreshold) {
              console.log(`⏰ Job ${jobId} has been running for ${Math.round(jobDuration / 1000 / 60)} minutes (timeout: ${this.TIMEOUT_MINUTES}min) - marking as failed`);
              jobsToMarkAsFailed.push(jobId);
              totalTimedOutJobs++;
            }
          } catch (jobError) {
            console.error(`❌ Error checking job ${jobId}:`, jobError);
            // Remove problematic job from active jobs
            jobsToCleanup.push(jobId);
          }
        }

        // First, cleanup jobs that are already in terminal states (don't change their state)
        if (jobsToCleanup.length > 0) {
          console.log(`🧹 Client ${client.client_id} has ${jobsToCleanup.length} jobs to cleanup: ${jobsToCleanup.join(', ')}`);
          
          // Remove from activeJobs array
          const updatedActiveJobs = client.activeJobs.filter(jobId => !jobsToCleanup.includes(jobId));
          const updateResult = await this.databaseService.updateClient(client.user_principal_id, {
            activeJobs: updatedActiveJobs
          });
          
          if (updateResult.success) {
            console.log(`✅ Cleaned up ${jobsToCleanup.length} terminal jobs from client ${client.client_id}'s active jobs`);
          } else {
            console.error(`❌ Failed to cleanup jobs for client ${client.client_id}:`, updateResult.error);
          }
        }

        // Then, mark timed out jobs as failed
        if (jobsToMarkAsFailed.length > 0) {
          console.log(`⏰ Client ${client.client_id} has ${jobsToMarkAsFailed.length} jobs that timed out: ${jobsToMarkAsFailed.join(', ')}`);
          
          for (const jobId of jobsToMarkAsFailed) {
            try {
              const markFailedResult = await this.databaseService.markJobAsFailed(
                jobId, 
                client.client_id, 
                `Job timed out after ${this.TIMEOUT_MINUTES} minutes`
              );
              
              if (markFailedResult.success) {
                console.log(`✅ Job ${jobId} marked as failed due to timeout`);
                // Get job details for duration calculation
                const jobDetailsResult = await this.databaseService.getJobWithID(jobId);
                const jobDuration = jobDetailsResult.success ? now - jobDetailsResult.data.assignedAt : 0;
                
                this.emit('jobTimedOut', {
                  jobId,
                  clientId: client.client_id,
                  userPrincipalId: client.user_principal_id,
                  duration: jobDuration
                });
              } else {
                console.error(`❌ Failed to mark job ${jobId} as failed:`, markFailedResult.error);
              }
            } catch (markFailedError) {
              console.error(`❌ Error marking job ${jobId} as failed:`, markFailedError);
            }
          }
        }
      }

      if (totalTimedOutJobs > 0) {
        console.log(`🕐 Timeout check completed: ${totalTimedOutJobs} jobs marked as failed across ${totalClientsChecked} clients`);
      } else {
        console.log(`✅ Timeout check completed: No timed out jobs found (checked ${totalClientsChecked} clients)`);
      }

    } catch (error) {
      console.error('❌ Error in checkForTimedOutJobs:', error);
    }
  }

  /**
   * Get monitor status
   */
  getStatus(): {
    isRunning: boolean;
    timeoutMinutes: number;
    checkIntervalMs: number;
  } {
    return {
      isRunning: this.isRunning,
      timeoutMinutes: this.TIMEOUT_MINUTES,
      checkIntervalMs: this.CHECK_INTERVAL_MS
    };
  }

  /**
   * Manually trigger a timeout check (for testing)
   */
  async triggerCheck(): Promise<void> {
    console.log('🔍 Manual timeout check triggered');
    await this.checkForTimedOutJobs();
  }
}
