# Swagger API Documentation

This directory contains Swagger/OpenAPI documentation for the Sela Network WebSocket Server API, specifically focusing on the `scrapeUrl` and `registerClient` endpoints.

## Files

- `swagger.yaml` - OpenAPI 3.0 specification file
- `swagger-ui.html` - Interactive Swagger UI for testing and documentation
- `SWAGGER_README.md` - This documentation file

## How to Use

### Option 1: Access via the running server (Recommended)
1. Start your Sela Network server: `npm run dev:hybrid`
2. Open your browser and go to: **http://localhost:8082/api/docs**
3. The Swagger UI will automatically load the API documentation
4. You can test the endpoints directly from the interface

### Option 2: Open the HTML file directly
1. Open `swagger-ui.html` in your web browser
2. The Swagger UI will load the API documentation from `swagger.yaml`
3. You can test the endpoints directly from the interface

### Option 3: Use with a local server
```bash
# Serve the files using Python (if you have Python installed)
python -m http.server 8000

# Or using Node.js (if you have http-server installed)
npx http-server -p 8000

# Then open http://localhost:8000/api/docs
```

### Option 4: Use with online Swagger Editor
1. Go to https://editor.swagger.io/
2. Copy the contents of `swagger.yaml`
3. Paste it into the editor
4. Use the "Try it out" feature to test endpoints

## API Endpoints Documented

### 1. Register Client (`POST /api/rpc/registerClient`)
- **Purpose**: Register a new client and obtain an API key
- **Authentication**: None required
- **Request Body**: 
  ```json
  {
    "uuid": "user-principal-id-12345"
  }
  ```
- **Response**: Returns an API key for authentication

### 2. Scrape URL (`POST /api/rpc/scrapeUrl`)
- **Purpose**: One-stop URL scraping with real-time processing
- **Authentication**: API key required (obtained from registerClient)
- **Request Body**:
  ```json
  {
    "url": "https://twitter.com/elonmusk",
    "scrapeType": "TWITTER_PROFILE",
    "timeoutMs": 60000,
    "principalId": "optional-specific-client-id"
  }
  ```
- **Response**: Returns scraped content with pricing and analysis information

## Supported Scrape Types

- `TWITTER_PROFILE` - Scrape Twitter user profiles
- `TWITTER_TWEETS` - Scrape Twitter user tweets
- `INSTAGRAM_PROFILE` - Scrape Instagram user profiles
- `INSTAGRAM_POSTS` - Scrape Instagram user posts
- `LINKEDIN_PROFILE` - Scrape LinkedIn profiles
- `GENERIC_WEB` - Generic web page scraping

## Authentication

Most endpoints require API key authentication. Include your API key in the `Authorization` header:

```
Authorization: your-api-key
```

Or with Bearer prefix:
```
Authorization: Bearer your-api-key
```

## Testing the API

1. **Register a client** using the `registerClient` endpoint
2. **Copy the API key** from the response
3. **Click "Authorize"** in the Swagger UI and enter your API key
4. **Test the `scrapeUrl` endpoint** with different URLs and scrape types

## Example Usage

### Step 1: Register Client
```bash
curl -X POST http://localhost:8082/api/rpc/registerClient \
  -H "Content-Type: application/json" \
  -d '{"uuid": "test-user-123"}'
```

### Step 2: Use API Key to Scrape
```bash
curl -X POST http://localhost:8082/api/rpc/scrapeUrl \
  -H "Content-Type: application/json" \
  -H "Authorization: your-api-key-here" \
  -d '{
    "url": "https://twitter.com/elonmusk",
    "scrapeType": "TWITTER_PROFILE",
    "timeoutMs": 60000
  }'
```

## Error Handling

The API returns structured error responses with appropriate HTTP status codes:

- `200` - Success
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid API key)
- `408` - Request Timeout (job execution failed)
- `422` - Unprocessable Entity (empty results)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## Rate Limiting

API requests are subject to rate limiting based on your usage plan. If you exceed the rate limit, you'll receive a `429` status code.

## WebSocket Support

This server also supports WebSocket connections for real-time communication:
- WebSocket URL: `ws://localhost:8082`
- See the main API documentation for WebSocket message formats

## Support

For questions or issues with the API, contact:
- Email: contact@sela.network
- Website: https://sela.network
