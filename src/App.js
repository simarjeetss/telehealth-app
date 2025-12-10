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

  // Generate a token for the user
  const generateToken = async (identity) => {
    // Determine the API URL based on environment
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const tokenUrl = isLocalhost 
      ? `http://localhost:7881/token?identity=${encodeURIComponent(identity)}&room=${roomName}`
      : `/api/token?identity=${encodeURIComponent(identity)}&room=${roomName}`;
    
    try {
      const response = await fetch(tokenUrl);
      if (response.ok) {
        const data = await response.json();
        return data.token;
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get token');
      }
    } catch (e) {
      console.error('Token generation error:', e);
      throw e;
    }
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
      setToken(generatedToken);
      setConnected(true);
    } catch (err) {
      setError(err.message || 'Failed to connect. Please try again.');
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
