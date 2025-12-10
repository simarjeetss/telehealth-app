/**
 * Simple LiveKit Token Server
 * 
 * This server generates JWT tokens for users to join LiveKit rooms.
 * Run this server alongside your React app to enable multi-user functionality.
 * 
 * Usage: node token-server.js
 * 
 * Make sure to set your LiveKit API credentials below!
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
require('dotenv').config();

// ============================================
// CONFIGURE YOUR LIVEKIT CREDENTIALS HERE
// ============================================
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

const PORT = 7881;

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

// Create HTTP server
const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/token' && req.method === 'GET') {
    const { identity, room } = parsedUrl.query;

    if (!identity || !room) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing identity or room parameter' }));
      return;
    }

    if (LIVEKIT_API_SECRET === 'YOUR_API_SECRET_HERE') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Token server not configured. Please set LIVEKIT_API_SECRET in token-server.js' 
      }));
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
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('LiveKit Token Server');
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Token endpoint: http://localhost:${PORT}/token?identity=USERNAME&room=ROOM_NAME`);
  console.log('');
  
  if (LIVEKIT_API_SECRET === 'YOUR_API_SECRET_HERE') {
    console.log('WARNING: API secret not configured!');
    console.log('   Please edit token-server.js and set your LIVEKIT_API_SECRET');
    console.log('');
    
  }
});
