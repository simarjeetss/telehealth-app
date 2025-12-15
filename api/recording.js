/**
 * Vercel Serverless Function for LiveKit Recording
 * 
 * Endpoints:
 *   POST /api/recording?action=start  - Start recording
 *   POST /api/recording?action=stop   - Stop recording
 *   GET  /api/recording?action=status - Get recording status
 */

const { 
  EgressClient, 
  EncodedFileOutput, 
  EncodedFileType,
  EncodingOptionsPreset
} = require('livekit-server-sdk');

// In-memory storage for active recordings
// Note: This will reset on cold starts. For production, use Redis/database
const activeRecordings = new Map();

// Get environment variables
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'https://livekit.simarjeet.dev';
const AZURE_ACCOUNT_NAME = process.env.AZURE_ACCOUNT_NAME;
const AZURE_ACCOUNT_KEY = process.env.AZURE_ACCOUNT_KEY;
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME;

// Create EgressClient
function getEgressClient() {
  return new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// Start recording handler
async function startRecording(room, identity) {
  // Check if recording is already active for this room
  if (activeRecordings.has(room)) {
    const existing = activeRecordings.get(room);
    return {
      status: 409,
      body: { 
        error: 'Recording already in progress',
        startedBy: existing.startedBy,
        egressId: existing.egressId
      }
    };
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
  const egressClient = getEgressClient();
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
  
  return {
    status: 200,
    body: { 
      success: true,
      egressId: egressInfo.egressId,
      filepath: filepath,
      message: 'Recording started'
    }
  };
}

// Stop recording handler
async function stopRecording(room, egressId) {
  // Find the egress ID from room name or use provided egressId
  let targetEgressId = egressId;
  let recordingInfo = null;

  if (room && activeRecordings.has(room)) {
    recordingInfo = activeRecordings.get(room);
    targetEgressId = recordingInfo.egressId;
  }

  if (!targetEgressId) {
    return {
      status: 404,
      body: { error: 'No active recording found for this room' }
    };
  }

  // Stop the egress
  const egressClient = getEgressClient();
  await egressClient.stopEgress(targetEgressId);

  // Remove from active recordings
  if (room) {
    activeRecordings.delete(room);
  }

  console.log(`Recording stopped for egressId: ${targetEgressId}`);
  
  return {
    status: 200,
    body: { 
      success: true,
      egressId: targetEgressId,
      filepath: recordingInfo?.filepath,
      message: 'Recording stopped'
    }
  };
}

// Get recording status handler
function getRecordingStatus(room) {
  const recordingInfo = activeRecordings.get(room);
  
  return {
    status: 200,
    body: { 
      isRecording: !!recordingInfo,
      ...(recordingInfo && {
        egressId: recordingInfo.egressId,
        startedBy: recordingInfo.startedBy,
        startedAt: recordingInfo.startedAt
      })
    }
  };
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, room, egressId, identity } = { ...req.query, ...req.body };

  // Validate credentials
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(500).json({ 
      error: 'Server not configured. Missing LiveKit credentials.' 
    });
  }

  if (!AZURE_ACCOUNT_NAME || !AZURE_ACCOUNT_KEY || !AZURE_CONTAINER_NAME) {
    return res.status(500).json({ 
      error: 'Server not configured. Missing Azure Blob Storage credentials.' 
    });
  }

  try {
    let result;

    switch (action) {
      case 'start':
        if (!room) {
          return res.status(400).json({ error: 'Missing room parameter' });
        }
        result = await startRecording(room, identity);
        break;

      case 'stop':
        if (!room && !egressId) {
          return res.status(400).json({ error: 'Missing room or egressId parameter' });
        }
        result = await stopRecording(room, egressId);
        break;

      case 'status':
        if (!room) {
          return res.status(400).json({ error: 'Missing room parameter' });
        }
        result = getRecordingStatus(room);
        break;

      default:
        return res.status(400).json({ 
          error: 'Invalid action. Use: start, stop, or status' 
        });
    }

    return res.status(result.status).json(result.body);

  } catch (error) {
    console.error('Recording error:', error);
    return res.status(500).json({ 
      error: 'Recording operation failed', 
      details: error.message 
    });
  }
};
