import React, { useState, useCallback } from 'react';
import {
  LiveKitRoom,
  VideoConference,
  GridLayout,
  ParticipantTile,
  useTracks,
  RoomAudioRenderer,
  ControlBar,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import './App.css';

// Custom video conference component with end call button
function CustomVideoConference({ onEndCall }) {
  const room = useRoomContext();

  const handleEndCall = useCallback(() => {
    room.disconnect();
    onEndCall();
  }, [room, onEndCall]);

  return (
    <div className="custom-video-conference">
      <VideoConference />
      <div className="end-call-container">
        <button className="end-call-button" onClick={handleEndCall}>
          End Call
        </button>
      </div>
    </div>
  );
}

function App() {
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const wsUrl = 'wss://livekit.simarjeet.dev';
  const roomName = 'test-room';

  // Generate a token for the user (you'll need a token server in production)
  // For testing, we'll use a simple approach with pre-generated tokens
  const generateToken = async (identity) => {
    // In production, you would call your backend API to generate a token
    // For now, we'll use the LiveKit CLI or a simple token server
    
    // Option 1: If you have a token server running locally
    try {
      const response = await fetch(`http://localhost:7881/token?identity=${encodeURIComponent(identity)}&room=${roomName}`);
      if (response.ok) {
        const data = await response.json();
        return data.token;
      }
    } catch (e) {
      console.log('Token server not available, using fallback');
    }

    // Option 2: Fallback - For testing only, use the existing token
    // Note: This won't work for multiple users as each user needs a unique token
    // You'll need to generate tokens using: livekit-cli create-token --api-key <key> --api-secret <secret> --identity <username> --room my-first-room --join
    return null;
  };

  const handleJoin = async () => {
    if (!username.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const generatedToken = await generateToken(username.trim());
      
      if (generatedToken) {
        setToken(generatedToken);
        setConnected(true);
      } else {
        // Fallback: Show instructions for generating tokens
        setError('Token server not running. Please generate a token using LiveKit CLI:\n\nlivekit-cli create-token --api-key YOUR_API_KEY --api-secret YOUR_API_SECRET --identity "' + username + '" --room ' + roomName + ' --join');
      }
    } catch (err) {
      setError('Failed to get token. Please check the console for details.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    setToken('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleJoin();
    }
  };

  return (
    <div className="app-container">
      {!connected ? (
        <div className="join-screen">
          <div className="join-card">
            <div className="logo-section">
              <div className="logo-icon"></div>
              <h1>livekit test app</h1>
            </div>
            
            <div className="input-section">
              <label className="input-label">Your Name</label>
              <input
                type="text"
                className="username-input"
                placeholder="Enter your name..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                // onKeyPress={handleKeyPress}
                disabled={isLoading}
              />
            </div>

            <div className="room-info">
              <div className="info-item">
                <span className="label">Room:</span>
                <span className="value">{roomName}</span>
              </div>
              <div className="info-item">
                <span className="label">Server:</span>
                <span className="value">livekit.simarjeet.dev</span>
              </div>
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <button 
              className="join-button" 
              onClick={handleJoin}
              disabled={isLoading || !username.trim()}
            >
              {isLoading ? (
                <>
                  <span className="button-icon"></span>
                  Connecting...
                </>
              ) : (
                <>
                  <span className="button-icon"></span>
                  Join Room
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <LiveKitRoom
          serverUrl={wsUrl}
          token={token}
          connect={true}
          audio={true}
          video={true}
          onDisconnected={handleDisconnect}
          className="livekit-room"
        >
          <CustomVideoConference onEndCall={handleDisconnect} />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </div>
  );
}

export default App;
