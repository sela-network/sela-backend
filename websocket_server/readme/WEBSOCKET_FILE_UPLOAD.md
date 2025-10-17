# WebSocket File Upload

This document describes the WebSocket file upload functionality implemented in the Sela Network WebSocket server.

## Overview

The WebSocket server now supports file uploads via WebSocket messages, allowing clients to upload files directly through the WebSocket connection instead of using REST API endpoints.

## Message Format

### File Upload Request

```json
{
  "type": "file_upload",
  "name": "filename.txt",
  "content_type": "text/plain",
  "job_id": "job_123",
  "content": "base64_encoded_file_content"
}
```

**Fields:**
- `type`: Must be "file_upload"
- `name`: The filename
- `content_type`: MIME type of the file
- `job_id`: Associated job identifier
- `content`: Base64 encoded file content

### File Upload Response

```json
{
  "type": "file_upload_response",
  "success": true,
  "file_id": "file_1234567890_1234",
  "message": "File uploaded successfully",
  "timestamp": 1234567890
}
```

**Fields:**
- `type`: Always "file_upload_response"
- `success`: Boolean indicating success/failure
- `file_id`: Generated file ID (on success)
- `message`: Success/error message
- `error`: Error details (on failure)
- `timestamp`: Response timestamp

## Implementation Details

### Server Components

1. **WebSocketFileHandler**: Handles file upload WebSocket messages
2. **FileService**: Manages file operations and storage
3. **Database**: Stores file metadata and indexes

### File Storage

Files are stored in the following structure:
```
data/redis/{user_principal_id}/{job_id}/{filename}
```

### Security

- User authentication is required via WebSocket session
- Files are isolated by user principal ID
- File access is restricted to the uploading user

## Usage Example

```javascript
const ws = new WebSocket('ws://localhost:8082');

ws.on('open', () => {
  const fileContent = 'Hello, World!';
  const fileData = Buffer.from(fileContent).toString('base64');
  
  const uploadMessage = {
    type: 'file_upload',
    name: 'hello.txt',
    content_type: 'text/plain',
    job_id: 'test_job',
    content: fileData
  };
  
  ws.send(JSON.stringify(uploadMessage));
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  if (response.type === 'file_upload_response') {
    console.log('Upload result:', response);
  }
});
```

## Testing

Use the provided test client:

```bash
node test_websocket_file_upload.js
```

Make sure to:
1. Start the WebSocket server
2. Have a test.txt file in the websocket_server directory
3. Install the ws package: `npm install ws`

## Error Handling

The server handles various error conditions:
- Missing required fields
- Invalid file content
- Authentication failures
- File system errors
- Database errors

All errors are returned with appropriate error messages and error types.
