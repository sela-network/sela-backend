import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils';

declare global {
  namespace Express {
    interface Request {
      userPrincipalId?: string;
    }
  }
}

/**
 * Authentication middleware that extracts user principal ID
 * Supports multiple ways to provide the ID:
 * 1. Header: x-user-principal-id
 * 2. Query parameter: user_principal_id
 * 3. Request body: user_principal_id
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const userPrincipalId = 
      req.headers['x-user-principal-id'] as string ||
      req.query.user_principal_id as string ||
      req.body.user_principal_id as string;

    if (!userPrincipalId) {
      ApiResponse.unauthorized(res, 'User principal ID is required. Provide it via header "x-user-principal-id", query parameter "user_principal_id", or request body "user_principal_id"');
      return;
    }

    if (typeof userPrincipalId !== 'string' || userPrincipalId.trim().length === 0) {
      ApiResponse.validationError(res, 'Invalid user principal ID format');
      return;
    }

    req.userPrincipalId = userPrincipalId.trim();
    
    console.log(`🔐 Authenticated request: ${req.method} ${req.path} - User: ${userPrincipalId}`);
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    ApiResponse.internalError(res, 'Authentication failed');
    return;
  }
}

/**
 * Reward routes authentication middleware
 * Checks for specific bearer token in Authorization header
 */
export function rewardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.status(401).json({
        success: false,
        error: { type: 'Unauthorized', message: 'Authorization header is required' }
      });
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: { type: 'Unauthorized', message: 'Authorization header must start with "Bearer "' }
      });
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    
    // Hardcoded token for now
    const expectedToken = '9e3d2c44-1a4a-4b52-9dcb-1d15cb4fdf0b';
    
    if (token !== expectedToken) {
      res.status(401).json({
        success: false,
        error: { type: 'Unauthorized', message: 'Invalid authorization token' }
      });
      return;
    }

    console.log(`🔐 Reward API authenticated: ${req.method} ${req.path}`);
    
    next();
  } catch (error) {
    console.error('Reward auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: { type: 'ServerError', message: 'Authentication failed' }
    });
    return;
  }
}
