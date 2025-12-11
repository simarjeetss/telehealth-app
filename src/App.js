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

// Custom video conference component with end call and recording buttons
function CustomVideoConference({ onEndCall, roomName }) {
  const room = useRoomContext();
  const [isRecording, setIsRecording] = useState(false);
  const [egressId, setEgressId] = useState(null);
  const [recordingError, setRecordingError] = useState('');
  const [recordingLoading, setRecordingLoading] = useState(false);

  const getApiUrl = (action, params = {}) => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocalhost ? 'http://localhost:7881' : '';
    const queryParams = new URLSearchParams({ action, ...params }).toString();
    return `${baseUrl}/api/recording?${queryParams}`;
  };

  const handleStartRecording = useCallback(async () => {
    setRecordingLoading(true);
    setRecordingError('');
    
    try {
      const response = await fetch(getApiUrl('start', { room: roomName }), {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        setEgressId(data.egressId);
        setIsRecording(true);
        console.log('Recording started:', data.egressId);
      } else {
        throw new Error(data.error || 'Failed to start recording');
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecordingError(error.message);
    } finally {
      setRecordingLoading(false);
    }
  }, [roomName]);

  const handleStopRecording = useCallback(async () => {
    if (!egressId) return;
    
    setRecordingLoading(true);
    setRecordingError('');
    
    try {
      const response = await fetch(getApiUrl('stop', { egressId }), {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        setIsRecording(false);
        setEgressId(null);
        console.log('Recording stopped');
      } else {
        throw new Error(data.error || 'Failed to stop recording');
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setRecordingError(error.message);
    } finally {
      setRecordingLoading(false);
    }
  }, [egressId]);

  const handleEndCall = useCallback(() => {
    // Stop recording if active before ending call
    if (isRecording && egressId) {
      handleStopRecording();
    }
    room.disconnect();
    onEndCall();
  }, [room, onEndCall, isRecording, egressId, handleStopRecording]);

  return (
    <div className="custom-video-conference">
      <VideoConference />
      
      {/* Recording indicator */}
      {isRecording && (
        <div className="recording-indicator">
          <span className="recording-dot"></span>
          REC
        </div>
      )}
      
      {/* Recording error toast */}
      {recordingError && (
        <div className="recording-error">
          {recordingError}
          <button onClick={() => setRecordingError('')}>×</button>
        </div>
      )}
      
      <div className="call-controls-container">
        {/* Recording button */}
        <button 
          className={`recording-button ${isRecording ? 'recording-active' : ''}`}
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          disabled={recordingLoading}
        >
          {recordingLoading ? (
            <span className="recording-button-text">...</span>
          ) : isRecording ? (
            <>
              <span className="stop-icon">■</span>
              <span className="recording-button-text">Stop Recording</span>
            </>
          ) : (
            <>
              <span className="record-icon">●</span>
              <span className="recording-button-text">Start Recording</span>
            </>
          )}
        </button>
        
        {/* End call button */}
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
          audio={false}
          video={false}
          onDisconnected={handleDisconnect}
          className="livekit-room"
        >
          <CustomVideoConference onEndCall={handleDisconnect} roomName={roomName} />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </div>
  );
}

export default App;
