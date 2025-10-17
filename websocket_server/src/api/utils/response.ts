import { Response } from 'express';

/**
 * Generic response utility for consistent API responses
 */
export class ApiResponse {
  /**
   * Send a successful response
   */
  static success(res: Response, data: any = null, message: string = 'Operation completed successfully', statusCode: number = 200): Response {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  /**
   * Send an error response
   */
  static error(res: Response, message: string = 'Operation failed', statusCode: number = 400, data: any = null): Response {
    return res.status(statusCode).json({
      success: false,
      message,
      data
    });
  }

  /**
   * Send a created response (201)
   */
  static created(res: Response, data: any = null, message: string = 'Resource created successfully'): Response {
    return this.success(res, data, message, 201);
  }

  /**
   * Send a not found response (404)
   */
  static notFound(res: Response, message: string = 'Resource not found', data: any = null): Response {
    return this.error(res, message, 404, data);
  }

  /**
   * Send an unauthorized response (401)
   */
  static unauthorized(res: Response, message: string = 'Unauthorized access', data: any = null): Response {
    return this.error(res, message, 401, data);
  }

  /**
   * Send a forbidden response (403)
   */
  static forbidden(res: Response, message: string = 'Access forbidden', data: any = null): Response {
    return this.error(res, message, 403, data);
  }

  /**
   * Send a validation error response (400)
   */
  static validationError(res: Response, message: string = 'Validation failed', data: any = null): Response {
    return this.error(res, message, 400, data);
  }

  /**
   * Send an internal server error response (500)
   */
  static internalError(res: Response, message: string = 'Internal server error', data: any = null): Response {
    return this.error(res, message, 500, data);
  }

  /**
   * Send a conflict response (409)
   */
  static conflict(res: Response, message: string = 'Resource conflict', data: any = null): Response {
    return this.error(res, message, 409, data);
  }

  /**
   * Send a no content response (204)
   */
  static noContent(res: Response): Response {
    return res.status(204).send();
  }

}
