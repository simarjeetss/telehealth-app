/**
 * Simple LiveKit Token & Recording Server
 * 
 * This server generates JWT tokens for users to join LiveKit rooms
 * and handles audio recording to Azure Blob Storage
 * 
 * Usage: node token-server.js
 * 
 * Make sure to set your LiveKit and Azure credentials in .env!
 */

import http from 'http';
import url from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { 
  EgressClient, 
  EncodedFileOutput, 
  EncodedFileType,
  AudioCodec,
  EncodingOptionsPreset,
  AzureBlobUpload
} from 'livekit-server-sdk';

dotenv.config();


// ============================================
// LIVEKIT CREDENTIALS
// ============================================
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'https://livekit.simarjeet.dev';

// ============================================
// AZURE BLOB STORAGE CREDENTIALS
// ============================================
const AZURE_ACCOUNT_NAME = process.env.AZURE_ACCOUNT_NAME;
const AZURE_ACCOUNT_KEY = process.env.AZURE_ACCOUNT_KEY;
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME;

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

//LiveKit Egress Client
const egressClient = new EgressClient(
  LIVEKIT_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

// ============================================
// ACTIVE RECORDINGS TRACKER
// Track which rooms have active recordings (prevents multiple recordings per room)
// ============================================
const activeRecordings = new Map(); // roomName -> { egressId, startedBy, startedAt }

// Helper function to parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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
      console.log(`Token generated for user: ${identity}, room: ${room}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token }));
    } catch (error) {
      console.error('Error generating token:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate token' }));
    }
    return;
  }

  // ============================================
  // START RECORDING ENDPOINT
  // ============================================
  if (parsedUrl.pathname === '/start-recording' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { room, identity } = body;

      if (!room) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing room parameter' }));
        return;
      }

      // Check if recording is already active for this room
      if (activeRecordings.has(room)) {
        const existing = activeRecordings.get(room);
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Recording already in progress',
          startedBy: existing.startedBy,
          egressId: existing.egressId
        }));
        return;
      }

      // Create timestamp for unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filepath = `recordings/${room}/${timestamp}.ogg`;

      // Configure Azure Blob output for audio-only recording
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: filepath,
        output: {
          case: 'azure',
          value: {
            accountName: AZURE_ACCOUNT_NAME,
            accountKey: AZURE_ACCOUNT_KEY,
            containerName: AZURE_CONTAINER_NAME
          }
        }
      });

      // Start room composite egress (audio only)
      const egressInfo = await egressClient.startRoomCompositeEgress(
        room,
        output,
        {
          layout: 'single-speaker',
          audioOnly: true,
          encodingOptions: EncodingOptionsPreset.H264_720P_30
        }
      );

      // Track this recording
      activeRecordings.set(room, {
        egressId: egressInfo.egressId,
        startedBy: identity || 'unknown',
        startedAt: new Date().toISOString(),
        filepath: filepath
      });

      console.log(`Recording started for room: ${room}, egressId: ${egressInfo.egressId}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        egressId: egressInfo.egressId,
        filepath: filepath,
        message: 'Recording started'
      }));
    } catch (error) {
      console.error('Error starting recording:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to start recording', details: error.message }));
    }
    return;
  }

  // ============================================
  // STOP RECORDING ENDPOINT
  // ============================================
  if (parsedUrl.pathname === '/stop-recording' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const { room, egressId } = body;

      if (!room && !egressId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing room or egressId parameter' }));
        return;
      }

      // Find the egress ID from room name or use provided egressId
      let targetEgressId = egressId;
      let recordingInfo = null;

      if (room && activeRecordings.has(room)) {
        recordingInfo = activeRecordings.get(room);
        targetEgressId = recordingInfo.egressId;
      }

      if (!targetEgressId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active recording found for this room' }));
        return;
      }

      // Stop the egress
      const egressInfo = await egressClient.stopEgress(targetEgressId);

      // Remove from active recordings
      if (room) {
        activeRecordings.delete(room);
      }

      console.log(`Recording stopped for egressId: ${targetEgressId}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true,
        egressId: targetEgressId,
        filepath: recordingInfo?.filepath,
        message: 'Recording stopped'
      }));
    } catch (error) {
      console.error('Error stopping recording:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to stop recording', details: error.message }));
    }
    return;
  }

  // ============================================
  // GET RECORDING STATUS ENDPOINT
  // ============================================
  if (parsedUrl.pathname === '/recording-status' && req.method === 'GET') {
    const { room } = parsedUrl.query;

    if (!room) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room parameter' }));
      return;
    }

    const recordingInfo = activeRecordings.get(room);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      isRecording: !!recordingInfo,
      ...(recordingInfo && {
        egressId: recordingInfo.egressId,
        startedBy: recordingInfo.startedBy,
        startedAt: recordingInfo.startedAt
      })
    }));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('LiveKit Token & Recording Server');
  console.log('====================================');
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`   Token:            GET  http://localhost:${PORT}/token?identity=NAME&room=ROOM`);
  console.log(`   Start Recording:  POST http://localhost:${PORT}/start-recording`);
  console.log(`   Stop Recording:   POST http://localhost:${PORT}/stop-recording`);
  console.log(`   Recording Status: GET  http://localhost:${PORT}/recording-status?room=ROOM`);

  console.log('');
  
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.log('WARNING: LiveKit credentials not configured!');
    console.log('   Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env');
    console.log('');
  }
  
  if (!AZURE_ACCOUNT_NAME || !AZURE_ACCOUNT_KEY) {
    console.log('WARNING: Azure Blob Storage not configured!');
    console.log('   Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in .env');
    console.log('');
  }
});
