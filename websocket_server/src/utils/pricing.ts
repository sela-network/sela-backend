export interface PricingConstants {
  baseFee: number; // Base fee in USDT
  fileSizeUnitPrice: number; // Price per KB in USDT
  objectUnitPrice: number; // Price per object in USDT
}

export interface PricingInput {
  fileSizeKB: number;
  objectsCount: number;
}

export interface PricingResult {
  baseFee: number;
  fileSizeCost: number;
  objectsCost: number;
  totalPrice: number;
  breakdown: string;
}

// Default pricing constants
export const DEFAULT_PRICING: PricingConstants = {
  baseFee: 1.0, // 1 USDT base fee
  fileSizeUnitPrice: 0.2, // 0.2 USDT per KB
  objectUnitPrice: 0.1 // 0.1 USDT per object
};


export function calculateJobPrice(
  input: PricingInput, 
  constants: PricingConstants = DEFAULT_PRICING
): PricingResult {
  const { fileSizeKB, objectsCount } = input;
  const { baseFee, fileSizeUnitPrice, objectUnitPrice } = constants;

  // Calculate individual components
  const fileSizeCost = fileSizeUnitPrice * fileSizeKB;
  const objectsCost = objectUnitPrice * objectsCount;
  const totalPrice = baseFee + fileSizeCost + objectsCost;

  // Create breakdown string for logging/debugging
  const breakdown = `${baseFee} + (${fileSizeUnitPrice} × ${fileSizeKB}) + (${objectUnitPrice} × ${objectsCount}) = ${totalPrice} USDT`;

  return {
    baseFee,
    fileSizeCost,
    objectsCost,
    totalPrice: Math.round(totalPrice * 100) / 100, // Round to 2 decimal places
    breakdown
  };
}


export function analyzeJsonContent(content: string): { dataCount: number; included: string[] } | null {
  try {
    console.log(`🔍 Analyzing JSON content with length: ${content.length}`);
    
    const parsed = JSON.parse(content);
    console.log(`✅ JSON parsed successfully, type: ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
    
    // Check if it's an array
    if (Array.isArray(parsed)) {
      const dataCount = parsed.length;
      const included: string[] = [];
      
      console.log(`📊 Array has ${dataCount} items`);
      
      // Extract unique keys from all objects in the array
      if (dataCount > 0) {
        const allKeys = new Set<string>();
        
        parsed.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            const itemKeys = Object.keys(item);
            console.log(`   Item ${index}: keys = ${itemKeys.join(', ')}`);
            itemKeys.forEach(key => allKeys.add(key));
          } else {
            console.log(`   Item ${index}: not an object (${typeof item})`);
          }
        });
        
        // Convert Set to Array and sort for consistency
        included.push(...Array.from(allKeys).sort());
      }
      
      console.log(`📊 Analyzed JSON data: ${dataCount} items, keys: ${included.join(', ')}`);
      return { dataCount, included };
    }
    
    // If it's not an array, return null
    console.log(`⚠️ JSON content is not an array, skipping analysis`);
    return null;
  } catch (error) {
    console.error(`❌ Error analyzing JSON content:`, error);
    return null;
  }
}

export function analyzeScrapedDataByType(content: string, scrapeType: string): { dataCount: number; included: string[] } | null {
  try {
    console.log(`🔍 Analyzing scraped data for type: ${scrapeType} with length: ${content.length}`);
    
    const parsed = JSON.parse(content);
    console.log(`✅ JSON parsed successfully, type: ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
    
    let dataCount = 0;
    let included: string[] = [];
    
    switch (scrapeType.toUpperCase()) {
      case 'TWITTER_POST':
        // For Twitter posts, we have a structure with "post" and "reply" array
        if (typeof parsed === 'object' && parsed !== null) {
          if (parsed.post && parsed.reply && Array.isArray(parsed.reply)) {
            // Count the main post + all replies
            dataCount = 1 + parsed.reply.length;
            console.log(`📊 Twitter Post: 1 main post + ${parsed.reply.length} replies = ${dataCount} total items`);
            
            // Extract keys from both post and replies
            const allKeys = new Set<string>();
            
            // Add keys from main post
            if (typeof parsed.post === 'object' && parsed.post !== null) {
              Object.keys(parsed.post).forEach(key => allKeys.add(key));
            }
            
            // Add keys from replies
            parsed.reply.forEach((reply: any, index: number) => {
              if (typeof reply === 'object' && reply !== null) {
                Object.keys(reply).forEach(key => allKeys.add(key));
              }
            });
            
            included = Array.from(allKeys).sort();
            console.log(`📊 Twitter Post keys: ${included.join(', ')}`);
          } else {
            // Fallback to standard array analysis if structure is different
            console.log(`⚠️ Twitter Post structure unexpected, falling back to standard analysis`);
            return analyzeJsonContent(content);
          }
        }
        break;
        
      case 'TWITTER_PROFILE':
        // For Twitter profiles, it's typically an array of tweets
        if (Array.isArray(parsed)) {
          dataCount = parsed.length;
          console.log(`📊 Twitter Profile: ${dataCount} tweets`);
          
          // Extract unique keys from all tweets
          if (dataCount > 0) {
            const allKeys = new Set<string>();
            
            parsed.forEach((tweet, index) => {
              if (typeof tweet === 'object' && tweet !== null) {
                const tweetKeys = Object.keys(tweet);
                console.log(`   Tweet ${index}: keys = ${tweetKeys.join(', ')}`);
                tweetKeys.forEach(key => allKeys.add(key));
              }
            });
            
            included = Array.from(allKeys).sort();
          }
        }
        break;
        
      default:
        // For all other types, use standard analysis
        console.log(`📊 Using standard analysis for scrape type: ${scrapeType}`);
        return analyzeJsonContent(content);
    }
    
    console.log(`📊 Final analysis for ${scrapeType}: ${dataCount} items, keys: ${included.join(', ')}`);
    return { dataCount, included };
    
  } catch (error) {
    console.error(`❌ Error analyzing scraped data for type ${scrapeType}:`, error);
    return null;
  }
}


export function bytesToKB(sizeInBytes: number): number {
  return Math.ceil(sizeInBytes / 1024);
}


export function getContentSizeKB(content: string): number {
  // Calculate size in bytes (UTF-8 encoding)
  const sizeInBytes = Buffer.byteLength(content, 'utf8');
  return bytesToKB(sizeInBytes);
}


export function validateContentStructure(content: string): {
  isValidJson: boolean;
  contentType: 'json' | 'text' | 'unknown';
  isAnalyzable: boolean;
  objectsCount: number;
  dataStructure: any;
  validation: {
    isValidJson: boolean;
    isCountable: boolean;
    hasStructuredData: boolean;
    isPriceable: boolean;
  };
  error?: string;
} {
  try {
    // Check if content is valid JSON
    let isValidJson = false;
    let parsed: any = null;
    
    try {
      parsed = JSON.parse(content);
      isValidJson = true;
    } catch {
      isValidJson = false;
    }

    let objectsCount = 0;
    let dataStructure: any = null;
    let isAnalyzable = false;

    if (isValidJson && parsed !== null) {
      if (Array.isArray(parsed)) {
        // JSON Array - most common case for scraped data
        const analysis = analyzeJsonContent(content);
        if (analysis) {
          objectsCount = analysis.dataCount;
          isAnalyzable = true;
          dataStructure = {
            type: 'array',
            itemCount: analysis.dataCount,
            fields: analysis.included,
            fieldCount: analysis.included.length
          };
        }
      } else if (typeof parsed === 'object') {
        // JSON Object
        objectsCount = 1; // Single object
        isAnalyzable = true;
        dataStructure = {
          type: 'object',
          itemCount: 1,
          fields: Object.keys(parsed),
          fieldCount: Object.keys(parsed).length
        };
      } else {
        // JSON primitive (string, number, boolean, null)
        objectsCount = 0;
        dataStructure = {
          type: typeof parsed,
          itemCount: 0,
          fields: [],
          fieldCount: 0
        };
      }
    }

    return {
      isValidJson,
      contentType: isValidJson ? 'json' : 'text',
      isAnalyzable,
      objectsCount,
      dataStructure,
      validation: {
        isValidJson,
        isCountable: objectsCount > 0,
        hasStructuredData: dataStructure !== null,
        isPriceable: isValidJson && objectsCount >= 0
      }
    };

  } catch (error) {
    return {
      isValidJson: false,
      contentType: 'unknown',
      isAnalyzable: false,
      objectsCount: 0,
      dataStructure: null,
      validation: {
        isValidJson: false,
        isCountable: false,
        hasStructuredData: false,
        isPriceable: false
      },
      error: error instanceof Error ? error.message : 'Unknown validation error'
    };
  }
}
