import { WebSocket } from 'ws';
import * as cbor from 'cbor';
import { FileService } from '../services/file_service';
import { FileUploadWebSocketMessage, FileUploadResponse, ClientSession } from '../types';

export class WebSocketFileHandler {
  private fileService: FileService;

  constructor(fileService: FileService) {
    this.fileService = fileService;
  }

  async handleFileUpload(clientSession: ClientSession, message: FileUploadWebSocketMessage): Promise<void> {
    try {
      if (!clientSession.userPrincipalId) {
        this.sendFileUploadResponse(clientSession.ws, false, 'User not authenticated', 'Authentication required');
        return;
      }

      const { name, content_type, job_id, content } = message;

      if (!name || !content_type || !job_id || !content) {
        this.sendFileUploadResponse(clientSession.ws, false, 'Missing required fields: name, content_type, job_id, content', 'Validation failed');
        return;
      }

      const fileData = Buffer.from(content, 'base64');
      if (fileData.length === 0) {
        this.sendFileUploadResponse(clientSession.ws, false, 'Invalid file content', 'Content conversion failed');
        return;
      }

      const createFileResult = await this.fileService.createFile({
        name,
        content_type: content_type,
        size: fileData.length,
        user_principal_id: clientSession.userPrincipalId,
        job_id
      });

      if (!createFileResult.success) {
        this.sendFileUploadResponse(clientSession.ws, false, 'Failed to create file', createFileResult.error?.message || 'Unknown error');
        return;
      }

      const file = createFileResult.data;
      const filePath = file.file_path;

      try {
        await this.fileService.writeFileData(filePath, fileData);
        
        this.sendFileUploadResponse(clientSession.ws, true, 'File uploaded successfully', undefined, file.id);
      } catch (writeError) {
        this.sendFileUploadResponse(clientSession.ws, false, 'Failed to write file data', 'File write error');
      }

    } catch (error) {
      console.error('File upload error:', error);
      this.sendFileUploadResponse(clientSession.ws, false, 'Internal server error', 'Server error');
    }
  }

  private sendFileUploadResponse(ws: WebSocket, success: boolean, message: string, error?: string, fileId?: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const response: FileUploadResponse = {
          success,
          message,
          error,
          file_id: fileId
        };

        const encodedResponse = cbor.encode({
          type: 'file_upload_response',
          ...response,
          timestamp: Date.now()
        });

        ws.send(encodedResponse);
      } catch (error) {
        console.error('Failed to send file upload response:', error);
      }
    }
  }
}
