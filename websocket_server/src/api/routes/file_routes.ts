import { Router, Request, Response } from 'express';
import multer from 'multer';
import { FileService } from '../../services/file_service';
import { Database } from '../../db/database';
import { authMiddleware } from '../middleware';
import { ApiResponse } from '../utils';

export function createFileRoutes(fileService: FileService): Router {
  const router = Router();

  router.use(authMiddleware);

  router.post('/', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;

      const { name, content_type, size, job_id } = req.body;

      if (!name || !content_type || !size || !job_id) {
        return ApiResponse.validationError(res, 'Missing required fields: name, content_type, size, job_id');
      }

      const result = await fileService.createFile({
        name,
        content_type,
        size: parseInt(size),
        user_principal_id: userPrincipalId,
        job_id
      });

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400, result.error);
      }

      return ApiResponse.created(res, {
        file_id: result.data.id,
        message: 'File created successfully. Upload chunks to complete.'
      }, 'File created successfully. Upload chunks to complete.');
    } catch (error) {
      console.error('Error creating file:', error);
      return ApiResponse.internalError(res, 'Failed to create file');
    }
  });

  router.post('/:fileId/chunks', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { fileId } = req.params;
      const { chunk_index } = req.body;

      if (!chunk_index) {
        return ApiResponse.validationError(res, 'chunk_index is required');
      }

      const chunkData = Buffer.from(req.body.chunk_data || '', 'base64');

      if (chunkData.length === 0) {
        return ApiResponse.validationError(res, 'chunk_data is required');
      }

      const result = await fileService.uploadChunk({
        file_id: fileId,
        chunk_index: parseInt(chunk_index),
        chunk_data: chunkData,
        user_principal_id: userPrincipalId
      });

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400, result.error);
      }

      return ApiResponse.success(res, {
        message: 'Chunk uploaded successfully'
      }, 'Chunk uploaded successfully');
    } catch (error) {
      console.error('Error uploading chunk:', error);
      return ApiResponse.internalError(res, 'Failed to upload chunk');
    }
  });

  router.post('/:fileId/complete', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { fileId } = req.params;

      const result = await fileService.completeFileUpload(fileId, userPrincipalId);

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400, result.error);
      }

      return ApiResponse.success(res, {
        message: 'File upload completed successfully'
      }, 'File upload completed successfully');
    } catch (error) {
      console.error('Error completing file upload:', error);
      return ApiResponse.internalError(res, 'Failed to complete file upload');
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { job_id, start_id, limit } = req.query;

      const result = await fileService.listFiles({
        user_principal_id: userPrincipalId,
        job_id: job_id as string,
        start_id: start_id as string,
        limit: limit ? parseInt(limit as string) : undefined
      });

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400, result.error);
      }

      return ApiResponse.success(res, result.data, 'Files retrieved successfully');
    } catch (error) {
      console.error('Error listing files:', error);
      return ApiResponse.internalError(res, 'Failed to list files');
    }
  });

  router.get('/:fileId', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { fileId } = req.params;

      const result = await fileService.getFile(fileId);

      if (!result.success) {
        return ApiResponse.notFound(res, 'File not found');
      }

      if (result.data.user_principal_id !== userPrincipalId) {
        return ApiResponse.forbidden(res, 'Unauthorized access to file');
      }

      return ApiResponse.success(res, result.data, 'File metadata retrieved successfully');
    } catch (error) {
      console.error('Error getting file:', error);
      return ApiResponse.internalError(res, 'Failed to get file');
    }
  });

  router.get('/:fileId/download', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { fileId } = req.params;

      const result = await fileService.getFileContent(fileId, userPrincipalId);

      if (!result.success) {
        return ApiResponse.notFound(res, 'File not found or access denied');
      }

      const fileResult = await fileService.getFile(fileId);
      if (fileResult.success) {
        const file = fileResult.data;
        res.setHeader('Content-Type', file.content_type);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.setHeader('Content-Length', file.size.toString());
      }

      return res.send(result.data);
    } catch (error) {
      console.error('Error downloading file:', error);
      return ApiResponse.internalError(res, 'Failed to download file');
    }
  });

  router.delete('/:fileId', async (req: Request, res: Response) => {
    try {
      const userPrincipalId = req.userPrincipalId!;
      const { fileId } = req.params;

      const result = await fileService.deleteFile(fileId, userPrincipalId);

      if (!result.success) {
        return ApiResponse.error(res, result.error.message, 400, result.error);
      }

      return ApiResponse.success(res, {
        message: 'File deleted successfully'
      }, 'File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      return ApiResponse.internalError(res, 'Failed to delete file');
    }
  });

  return router;
}
