/**
 * Vercel Serverless Function for LiveKit Token Generation
 * 
 * This will be available at: /api/token?identity=USERNAME&room=ROOM_NAME
 */

const crypto = require('crypto');

// Base64URL encode
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Create JWT token for LiveKit
function createToken(identity, roomName) {
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

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

module.exports = (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { identity, room } = req.query;

  if (!identity || !room) {
    return res.status(400).json({ error: 'Missing identity or room parameter' });
  }

  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return res.status(500).json({ 
      error: 'Server not configured. Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET environment variables.' 
    });
  }

  try {
    const token = createToken(identity, room);
    console.log(`Token generated for user: ${identity}, room: ${room}`);
    
    return res.status(200).json({ token });
  } catch (error) {
    console.error('Error generating token:', error);
    return res.status(500).json({ error: 'Failed to generate token' });
  }
};
