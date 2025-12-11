/**
 * Simple LiveKit Token & Recording Server
 * 
 * This server generates JWT tokens for users to join LiveKit rooms
 * and handles recording (egress) operations.
 * 
 * Usage: node token-server.js
 * 
 * Make sure to set your LiveKit and Azure credentials in .env!
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
require('dotenv').config();

// ============================================
// LIVEKIT CREDENTIALS
// ============================================
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'https://livekit.simarjeet.dev';

// ============================================
// AZURE BLOB STORAGE CREDENTIALS
// ============================================
const AZURE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const AZURE_ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const AZURE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME || 'recordings';

const PORT = 7881;

// Base64URL encode
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Create JWT token for LiveKit room join
function createToken(identity, roomName) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (24 * 60 * 60); // 24 hours from now
  
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const payload = {
    exp: exp,
    iss: LIVEKIT_API_KEY,
    name: identity,
    nbf: now,
    sub: identity,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  
  const signature = crypto
    .createHmac('sha256', LIVEKIT_API_SECRET)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

// Create API token for egress operations
function createApiToken() {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 600; // 10 minutes

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: LIVEKIT_API_KEY,
    nbf: now,
    exp: exp,
    video: {
      roomRecord: true
    }
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));

  const signature = crypto
    .createHmac('sha256', LIVEKIT_API_SECRET)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

// Make API call to LiveKit
async function livekitApiCall(endpoint, method = 'POST', body = null) {
  const token = createApiToken();
  const baseUrl = LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${endpoint}`, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LiveKit API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Start room composite recording
async function startRecording(roomName, layout = 'grid') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = `${roomName}/${roomName}-${timestamp}.mp4`;

  const requestBody = {
    room_name: roomName,
    layout: layout,
    file: {
      file_type: 'MP4',
      filepath: filepath,
      azure: {
        account_name: AZURE_ACCOUNT_NAME,
        account_key: AZURE_ACCOUNT_KEY,
        container_name: AZURE_CONTAINER_NAME,
      },
    },
  };

  return await livekitApiCall('/twirp/livekit.Egress/StartRoomCompositeEgress', 'POST', requestBody);
}

// Stop recording
async function stopRecording(egressId) {
  return await livekitApiCall('/twirp/livekit.Egress/StopEgress', 'POST', {
    egress_id: egressId,
  });
}

// List active egresses
async function listEgresses(roomName) {
  const body = roomName ? { room_name: roomName } : {};
  return await livekitApiCall('/twirp/livekit.Egress/ListEgress', 'POST', body);
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  // Token endpoint
  if (parsedUrl.pathname === '/token' && req.method === 'GET') {
    const { identity, room } = parsedUrl.query;

    if (!identity || !room) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing identity or room parameter' }));
      return;
    }

    try {
      const token = createToken(identity, room);
      console.log(`✅ Token generated for user: ${identity}, room: ${room}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token }));
    } catch (error) {
      console.error('Error generating token:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate token' }));
    }
    return;
  }

  // Recording endpoint
  if (parsedUrl.pathname === '/api/recording') {
    const { action, room, egressId, layout } = parsedUrl.query;

    // Check Azure credentials
    if (!AZURE_ACCOUNT_NAME || !AZURE_ACCOUNT_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Azure Blob Storage not configured. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in .env' 
      }));
      return;
    }

    try {
      switch (action) {
        case 'start':
          if (!room) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing room parameter' }));
            return;
          }
          const startResult = await startRecording(room, layout || 'grid');
          console.log(`🔴 Recording started for room: ${room}, egressId: ${startResult.egress_id}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            egressId: startResult.egress_id,
            status: startResult.status,
            message: 'Recording started'
          }));
          return;

        case 'stop':
          if (!egressId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing egressId parameter' }));
            return;
          }
          const stopResult = await stopRecording(egressId);
          console.log(`⏹️ Recording stopped: ${egressId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            egressId: egressId,
            status: stopResult.status,
            message: 'Recording stopped'
          }));
          return;

        case 'list':
          const listResult = await listEgresses(room);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            egresses: listResult.items || []
          }));
          return;

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid action. Use: start, stop, or list' }));
          return;
      }
    } catch (error) {
      console.error('Recording API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'Failed to process recording request' }));
    }
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('🎥 LiveKit Token & Recording Server');
  console.log('====================================');
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log('');
  console.log('📍 Endpoints:');
  console.log(`   Token:     GET  http://localhost:${PORT}/token?identity=NAME&room=ROOM`);
  console.log(`   Start Rec: POST http://localhost:${PORT}/api/recording?action=start&room=ROOM`);
  console.log(`   Stop Rec:  POST http://localhost:${PORT}/api/recording?action=stop&egressId=ID`);
  console.log(`   List Rec:  GET  http://localhost:${PORT}/api/recording?action=list&room=ROOM`);
  console.log('');
  
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.log('⚠️  WARNING: LiveKit credentials not configured!');
    console.log('   Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env');
    console.log('');
  }
  
  if (!AZURE_ACCOUNT_NAME || !AZURE_ACCOUNT_KEY) {
    console.log('⚠️  WARNING: Azure Blob Storage not configured!');
    console.log('   Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in .env');
    console.log('');
  }
});
