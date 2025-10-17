import { Response } from 'express';
import { WebSocket } from 'ws';
import * as cbor from 'cbor';
import { RPCErrorType, RPCStatus } from '../config/rpc_config';
import { ApiResponse } from '../api/utils/response';

export interface RPCError {
  type: RPCErrorType;
  message: string;
  details?: any;
  timestamp: number;
  requestId?: string;
}

export interface WebSocketErrorResponse {
  success: false;
  error: RPCError;
  status: RPCStatus;
}

export interface WebSocketSuccessResponse<T = any> {
  success: true;
  data: T;
  status: RPCStatus;
  timestamp: number;
}

export type WebSocketResponse<T = any> = WebSocketSuccessResponse<T> | WebSocketErrorResponse;

export class RPCErrorHandler {
  
  
  static createError(
    type: RPCErrorType,
    message: string,
    details?: any,
    requestId?: string
  ): RPCError {
    return {
      type,
      message,
      details,
      timestamp: Date.now(),
      requestId
    };
  }

  
  static createWebSocketSuccess<T>(data: T, status: RPCStatus = RPCStatus.OK): WebSocketSuccessResponse<T> {
    return {
      success: true,
      data,
      status,
      timestamp: Date.now()
    };
  }

  
  static createWebSocketErrorResponse(error: RPCError, status: RPCStatus = RPCStatus.ERROR): WebSocketErrorResponse {
    return {
      success: false,
      error,
      status
    };
  }

  
  static handleAuthErrorHttp(res: Response, message: string = 'Authentication failed', details?: any): Response {
    return ApiResponse.unauthorized(res, message, details);
  }

  
  static handleAuthErrorWS(message: string = 'Authentication failed', details?: any): WebSocketErrorResponse {
    const error = this.createError(RPCErrorType.AUTHENTICATION_FAILED, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleValidationErrorHttp(res: Response, message: string, details?: any): Response {
    return ApiResponse.validationError(res, message, details);
  }

  
  static handleValidationErrorWS(message: string, details?: any): WebSocketErrorResponse {
    const error = this.createError(RPCErrorType.VALIDATION_ERROR, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleNotFoundErrorHttp(res: Response, resource: string, details?: any): Response {
    return ApiResponse.notFound(res, `${resource} not found`, details);
  }

  
  static handleNotFoundErrorWS(resource: string, details?: any): WebSocketErrorResponse {
    const error = this.createError(
      RPCErrorType.JOB_NOT_FOUND, 
      `${resource} not found`, 
      details
    );
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleRateLimitErrorHttp(res: Response, limit: number, window: number): Response {
    return ApiResponse.error(res, `Rate limit exceeded: ${limit} requests per ${window}ms`, 429, { limit, window });
  }

  
  static handleRateLimitErrorWS(limit: number, window: number): WebSocketErrorResponse {
    const error = this.createError(
      RPCErrorType.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded: ${limit} requests per ${window}ms`,
      { limit, window }
    );
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleDatabaseErrorHttp(res: Response, message: string, details?: any): Response {
    return ApiResponse.internalError(res, message, details);
  }

  
  static handleDatabaseErrorWS(message: string, details?: any): WebSocketErrorResponse {
    const error = this.createError(RPCErrorType.DATABASE_ERROR, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

 
  static handleFileErrorHttp(res: Response, operation: string, message: string, details?: any): Response {
    switch (operation) {
      case 'upload':
        return ApiResponse.error(res, message, 400, details);
      case 'notfound':
        return ApiResponse.notFound(res, message, details);
      case 'toolarge':
        return ApiResponse.error(res, message, 413, details);
      default:
        return ApiResponse.internalError(res, message, details);
    }
  }

  
  static handleFileErrorWS(operation: string, message: string, details?: any): WebSocketErrorResponse {
    let errorType: RPCErrorType;
    
    switch (operation) {
      case 'upload':
        errorType = RPCErrorType.FILE_UPLOAD_FAILED;
        break;
      case 'notfound':
        errorType = RPCErrorType.FILE_NOT_FOUND;
        break;
      case 'toolarge':
        errorType = RPCErrorType.FILE_TOO_LARGE;
        break;
      default:
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
    }

    const error = this.createError(errorType, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleWebSocketError(message: string, details?: any): WebSocketErrorResponse {
    const error = this.createError(RPCErrorType.WEBSOCKET_ERROR, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleJobErrorHttp(res: Response, operation: string, message: string, details?: any): Response {
    switch (operation) {
      case 'notfound':
        return ApiResponse.notFound(res, message, details);
      case 'creation':
        return ApiResponse.error(res, message, 400, details);
      case 'assigned':
        return ApiResponse.error(res, message, 409, details); // Conflict
      case 'invalid_type':
        return ApiResponse.validationError(res, message, details);
      default:
        return ApiResponse.internalError(res, message, details);
    }
  }

  
  static handleJobErrorWS(operation: string, message: string, details?: any): WebSocketErrorResponse {
    let errorType: RPCErrorType;
    
    switch (operation) {
      case 'notfound':
        errorType = RPCErrorType.JOB_NOT_FOUND;
        break;
      case 'creation':
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
        break;
      case 'assigned':
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
        break;
      case 'invalid_type':
        errorType = RPCErrorType.VALIDATION_ERROR;
        break;
      default:
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
    }

    const error = this.createError(errorType, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleClientErrorHttp(res: Response, operation: string, message: string, details?: any): Response {
    switch (operation) {
      case 'notfound':
        return ApiResponse.notFound(res, message, details);
      case 'unavailable':
        return ApiResponse.error(res, message, 503, details); // Service Unavailable
      case 'disconnected':
        return ApiResponse.error(res, message, 410, details); // Gone
      default:
        return ApiResponse.internalError(res, message, details);
    }
  }

 
  static handleClientErrorWS(operation: string, message: string, details?: any): WebSocketErrorResponse {
    let errorType: RPCErrorType;
    
    switch (operation) {
      case 'notfound':
        errorType = RPCErrorType.CLIENT_NOT_FOUND;
        break;
      case 'unavailable':
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
        break;
      case 'disconnected':
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
        break;
      default:
        errorType = RPCErrorType.INTERNAL_SERVER_ERROR;
    }

    const error = this.createError(errorType, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }


  static handleInternalErrorHttp(res: Response, message: string = 'Internal server error', details?: any): Response {
    return ApiResponse.internalError(res, message, details);
  }

  
  static handleInternalErrorWS(message: string = 'Internal server error', details?: any): WebSocketErrorResponse {
    const error = this.createError(RPCErrorType.INTERNAL_SERVER_ERROR, message, details);
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static handleTimeoutErrorHttp(res: Response, operation: string, timeout: number): Response {
    return ApiResponse.error(res, `Operation ${operation} timed out after ${timeout}ms`, 408, { operation, timeout });
  }

  
  static handleTimeoutErrorWS(operation: string, timeout: number): WebSocketErrorResponse {
    const error = this.createError(
      RPCErrorType.INTERNAL_SERVER_ERROR,
      `Operation ${operation} timed out after ${timeout}ms`,
      { operation, timeout }
    );
    return this.createWebSocketErrorResponse(error, RPCStatus.ERROR);
  }

  
  static sendWebSocketError(ws: WebSocket, errorResponse: WebSocketErrorResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const encodedError = cbor.encode({
          type: 'error_response',
          ...errorResponse,
          timestamp: Date.now()
        });
        ws.send(encodedError);
      } catch (error) {
        console.error('❌ Failed to send WebSocket error:', error);
      }
    }
  }

  
  static sendWebSocketSuccess<T>(ws: WebSocket, data: T, type: string = 'success_response'): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const encodedSuccess = cbor.encode({
          type,
          success: true,
          data,
          status: RPCStatus.OK,
          timestamp: Date.now()
        });
        ws.send(encodedSuccess);
      } catch (error) {
        console.error('❌ Failed to send WebSocket success:', error);
      }
    }
  }

  
  static logError(error: RPCError, context?: string): void {
    const logMessage = `❌ RPC Error [${error.type}]: ${error.message}`;
    const logDetails = {
      type: error.type,
      message: error.message,
      details: error.details,
      timestamp: new Date(error.timestamp).toISOString(),
      requestId: error.requestId,
      context
    };

    console.error(logMessage, logDetails);
  }

  
  static fromDatabaseErrorWS(dbError: any): WebSocketErrorResponse {
    if (dbError.error) {
      switch (dbError.error.type) {
        case 'NotFound':
          return this.handleNotFoundErrorWS(dbError.error.message);
        case 'AlreadyExists':
          return this.handleValidationErrorWS(`Resource already exists: ${dbError.error.message}`);
        case 'UpdateFailed':
          return this.handleDatabaseErrorWS(`Update failed: ${dbError.error.message}`);
        case 'InvalidInput':
          return this.handleValidationErrorWS(dbError.error.message);
        default:
          return this.handleDatabaseErrorWS(dbError.error.message);
      }
    }
    
    return this.handleInternalErrorWS('Unknown database error', dbError);
  }

  
  static fromDatabaseErrorHttp(res: Response, dbError: any): Response {
    if (dbError.error) {
      switch (dbError.error.type) {
        case 'NotFound':
          return ApiResponse.notFound(res, dbError.error.message);
        case 'AlreadyExists':
          return ApiResponse.error(res, `Resource already exists: ${dbError.error.message}`, 409);
        case 'UpdateFailed':
          return ApiResponse.internalError(res, `Update failed: ${dbError.error.message}`);
        case 'InvalidInput':
          return ApiResponse.validationError(res, dbError.error.message);
        default:
          return ApiResponse.internalError(res, dbError.error.message);
      }
    }
    
    return ApiResponse.internalError(res, 'Unknown database error', dbError);
  }

  
  static async wrapAsyncWS<T>(
    operation: () => Promise<T>,
    errorContext: string
  ): Promise<WebSocketResponse<T>> {
    try {
      const result = await operation();
      return this.createWebSocketSuccess(result);
    } catch (error) {
      console.error(`❌ Error in ${errorContext}:`, error);
      const rpcError = this.createError(
        RPCErrorType.INTERNAL_SERVER_ERROR,
        `${errorContext} failed: ${(error as Error).message}`,
        { originalError: error }
      );
      return this.createWebSocketErrorResponse(rpcError);
    }
  }
}


export const errorMiddleware = (error: any, req: any, res: Response, next: any) => {
  console.error('Express error middleware:', error);
  
  return ApiResponse.internalError(res, 'Request processing failed', { 
    url: req.url, 
    method: req.method 
  });
};


export const asyncHandler = (fn: Function) => (req: any, res: Response, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
