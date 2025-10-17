import * as fs from 'fs/promises';
import * as path from 'path';
import { FileMetadata, REDIS_KEYS } from '../db/types';
import { Database } from '../db/database';

export interface FileResolutionResult {
  success: boolean;
  filePath?: string;
  updatedMetadata?: FileMetadata;
  error?: string;
}

/**
 * Resolves file path with fallback mechanism for cases where the expected file doesn't exist
 * but a file with different extension might exist in the same directory
 */
export async function resolveFilePathWithFallback(
  expectedFilePath: string,
  fileMetadata: FileMetadata,
  fileId: string,
  db: Database
): Promise<FileResolutionResult> {
  try {
    // First, try the expected file path
    try {
      await fs.access(expectedFilePath);
      console.log(`✅ File found at expected path: ${expectedFilePath}`);
      return {
        success: true,
        filePath: expectedFilePath,
        updatedMetadata: fileMetadata
      };
    } catch (accessError) {
      console.log(`⚠️ File not found at expected path: ${expectedFilePath}, attempting fallback...`);
      
      // Try to find the actual file with different extensions
      const parsedPath = path.parse(expectedFilePath);
      const directory = parsedPath.dir;
      const nameWithoutExt = parsedPath.name;
      
      try {
        // Read directory to find files with similar names
        const files = await fs.readdir(directory);
        const matchingFiles = files.filter(file => file.startsWith(nameWithoutExt));
        
        if (matchingFiles.length === 0) {
          return {
            success: false,
            error: 'No matching files found in directory'
          };
        }
        
        // Use the first matching file
        const foundFileName = matchingFiles[0];
        const actualFilePath = path.join(directory, foundFileName);
        
        // Verify this file exists
        await fs.access(actualFilePath);
        console.log(`✅ Found alternative file: ${actualFilePath}`);
        
        // Update metadata with correct file path and content type
        const foundExtension = path.extname(foundFileName).toLowerCase();
        let updatedContentType = fileMetadata.content_type;
        
        if (foundExtension === '.html') {
          updatedContentType = 'text/html';
        } else if (foundExtension === '.json') {
          updatedContentType = 'application/json';
        }
        
        // Create updated metadata
        const updatedMetadata = { 
          ...fileMetadata, 
          file_path: actualFilePath,
          name: foundFileName,
          content_type: updatedContentType,
          updated_at: Date.now()
        };
        
        // Update the metadata in Redis with the correct file path and content type
        const key = `${REDIS_KEYS.FILE}${fileId}`;
        await db.setFileMetadata(key, JSON.stringify(updatedMetadata));
        console.log(`🔄 Updated file metadata with correct path: ${actualFilePath}`);
        
        return {
          success: true,
          filePath: actualFilePath,
          updatedMetadata
        };
        
      } catch (dirError) {
        console.error(`❌ Failed to read directory or find alternative files:`, dirError);
        return {
          success: false,
          error: 'Failed to read directory or find alternative files'
        };
      }
    }
  } catch (error) {
    console.error(`❌ Error in file path resolution:`, error);
    return {
      success: false,
      error: `File path resolution failed: ${error}`
    };
  }
}

/**
 * Validates that a file exists at the given path
 */
export async function validateFilePath(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets content type based on file extension
 */
export function getContentTypeFromExtension(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  
  switch (extension) {
    case '.html':
    case '.htm':
      return 'text/html';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    case '.xml':
      return 'application/xml';
    case '.csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}
