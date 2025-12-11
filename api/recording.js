/**
 * Vercel Serverless Function for LiveKit Recording (Egress)
 * 
 * Endpoints:
 * - POST /api/recording?action=start&room=ROOM_NAME - Start recording
 * - POST /api/recording?action=stop&egressId=EGRESS_ID - Stop recording
 * - GET /api/recording?action=status&egressId=EGRESS_ID - Get recording status
 * - GET /api/recording?action=list&room=ROOM_NAME - List active recordings
 */

const crypto = require('crypto');

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'https://livekit.simarjeet.dev';

// Azure Blob Storage config
const AZURE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const AZURE_ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const AZURE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME || 'recordings';

// Base64URL encode for JWT
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Create a signed JWT for LiveKit API calls
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

// Get egress info
async function getEgressInfo(egressId) {
  return await livekitApiCall('/twirp/livekit.Egress/ListEgress', 'POST', {
    egress_id: egressId,
  });
}

// List active egresses for a room
async function listEgresses(roomName) {
  const body = roomName ? { room_name: roomName } : {};
  return await livekitApiCall('/twirp/livekit.Egress/ListEgress', 'POST', body);
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate environment variables
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(500).json({ 
      error: 'Server not configured. Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET.' 
    });
  }

  if (!AZURE_ACCOUNT_NAME || !AZURE_ACCOUNT_KEY) {
    return res.status(500).json({ 
      error: 'Server not configured. Missing Azure Blob Storage credentials.' 
    });
  }

  const { action, room, egressId, layout } = req.query;

  try {
    switch (action) {
      case 'start':
        if (!room) {
          return res.status(400).json({ error: 'Missing room parameter' });
        }
        const startResult = await startRecording(room, layout || 'grid');
        console.log(`Recording started for room: ${room}, egressId: ${startResult.egress_id}`);
        return res.status(200).json({ 
          success: true, 
          egressId: startResult.egress_id,
          status: startResult.status,
          message: 'Recording started'
        });

      case 'stop':
        if (!egressId) {
          return res.status(400).json({ error: 'Missing egressId parameter' });
        }
        const stopResult = await stopRecording(egressId);
        console.log(`Recording stopped: ${egressId}`);
        return res.status(200).json({ 
          success: true, 
          egressId: egressId,
          status: stopResult.status,
          message: 'Recording stopped'
        });

      case 'status':
        if (!egressId) {
          return res.status(400).json({ error: 'Missing egressId parameter' });
        }
        const statusResult = await getEgressInfo(egressId);
        return res.status(200).json({ 
          success: true, 
          egresses: statusResult.items || []
        });

      case 'list':
        const listResult = await listEgresses(room);
        return res.status(200).json({ 
          success: true, 
          egresses: listResult.items || []
        });

      default:
        return res.status(400).json({ 
          error: 'Invalid action. Use: start, stop, status, or list' 
        });
    }
  } catch (error) {
    console.error('Recording API error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to process recording request' 
    });
  }
};
