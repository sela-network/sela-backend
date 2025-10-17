# Job Timeout Monitor

## Overview

The Job Timeout Monitor is a cron service that automatically monitors active jobs and marks them as failed if they have been running for more than 10 minutes. This prevents jobs from getting stuck in the "ongoing" state indefinitely.

## Features

- **Automatic Monitoring**: Checks for timed-out jobs every 2 minutes
- **Configurable Timeout**: Default 10-minute timeout (configurable)
- **Clean Job Cleanup**: Removes timed-out jobs from client's active jobs array
- **Event Emission**: Emits events when jobs are timed out for monitoring
- **API Integration**: Provides REST endpoints for monitoring and manual triggering

## How It Works

1. **Periodic Checks**: The monitor runs every 2 minutes
2. **Job Validation**: For each client's active jobs, it:
   - Verifies the job exists in the database
   - Checks if the job is in "ongoing" state
   - Calculates how long the job has been running
   - Identifies jobs that exceed the 10-minute threshold
3. **Job Cleanup**: For timed-out jobs, it:
   - Marks the job as "failed" in the database
   - Removes the job from the client's active jobs array
   - Sets an appropriate error message
   - Emits a "jobTimedOut" event

## Configuration

The monitor can be configured by modifying the constants in `JobTimeoutMonitor`:

```typescript
private readonly TIMEOUT_MINUTES = 10; // 10 minutes timeout
private readonly CHECK_INTERVAL_MS = 120000; // Check every 2 minutes
```

## API Endpoints

### GET /api/rpc/system/job-timeout-monitor
Get the current status of the job timeout monitor.

**Response:**
```json
{
  "success": true,
  "data": {
    "isRunning": true,
    "timeoutMinutes": 10,
    "checkIntervalMs": 120000
  },
  "message": "Job timeout monitor status retrieved successfully"
}
```

### POST /api/rpc/system/job-timeout-monitor/trigger-check
Manually trigger a timeout check (useful for testing).

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Timeout check triggered successfully",
    "timestamp": "2024-01-01T12:00:00.000Z"
  },
  "message": "Manual timeout check completed"
}
```

### GET /api/rpc/status
Get overall server status including job timeout monitor information.

## Integration

The Job Timeout Monitor is automatically started when the HybridServer starts and stopped when the server shuts down. It's integrated into the server's lifecycle management.

## Events

The monitor emits the following events:

### jobTimedOut
Emitted when a job is marked as failed due to timeout.

**Event Data:**
```typescript
{
  jobId: string;
  clientId: string;
  userPrincipalId: string;
  duration: number; // Duration in milliseconds
}
```

## Testing

A test script is available at `src/test/job_timeout_test.ts` that:
1. Creates a test client and job
2. Simulates a job that was assigned 11 minutes ago
3. Triggers the timeout monitor
4. Verifies the job is marked as failed and removed from active jobs

To run the test:
```bash
npm run test:job-timeout
# or
npx ts-node src/test/job_timeout_test.ts
```

## Monitoring

The monitor provides detailed logging for:
- When checks are performed
- How many jobs are checked per client
- Which jobs are marked as failed
- Any errors encountered during the process

## Error Handling

The monitor is designed to be resilient:
- Individual job errors don't stop the entire check process
- Database errors are logged but don't crash the monitor
- Missing jobs are automatically removed from client active jobs
- Invalid job states are handled gracefully

## Performance

- Checks run every 2 minutes with minimal performance impact
- Only processes clients that have active jobs
- Uses efficient database queries
- Memory usage is minimal (no job data is stored in memory)

## Troubleshooting

### Monitor Not Running
- Check server logs for startup messages
- Verify the monitor is started in the HybridServer
- Check the `/api/rpc/system/job-timeout-monitor` endpoint

### Jobs Not Being Timed Out
- Verify the job is in "ongoing" state
- Check the job's `assignedAt` timestamp
- Ensure the monitor is running (check logs)
- Manually trigger a check using the API endpoint

### Performance Issues
- Monitor logs for excessive job counts
- Check if clients have too many active jobs
- Verify database performance
- Consider adjusting the check interval if needed
