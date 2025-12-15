import React, { useState, useCallback, useEffect } from 'react';
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

// Helper function to get API base URL
const getApiBaseUrl = () => {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocalhost ? 'http://localhost:7881' : '';
};

// Custom video conference component with end call and recording buttons
function CustomVideoConference({ onEndCall, roomName, username }) {
  const room = useRoomContext();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [egressId, setEgressId] = useState(null);
  const [recordingStartedBy, setRecordingStartedBy] = useState(null);
  const [recordingError, setRecordingError] = useState('');
  const [recordingStartTime, setRecordingStartTime] = useState(null);
  const [canStopRecording, setCanStopRecording] = useState(false);

  // Minimum time before allowing stop (to let egress initialize)
  const MIN_RECORDING_TIME_MS = 10000; // 10 seconds

  // Enable stop button after minimum time
  useEffect(() => {
    if (isRecording && recordingStartTime) {
      const elapsed = Date.now() - recordingStartTime;
      if (elapsed >= MIN_RECORDING_TIME_MS) {
        setCanStopRecording(true);
      } else {
        const timer = setTimeout(() => {
          setCanStopRecording(true);
        }, MIN_RECORDING_TIME_MS - elapsed);
        return () => clearTimeout(timer);
      }
    } else {
      setCanStopRecording(false);
    }
  }, [isRecording, recordingStartTime]);

  // Check recording status on mount and periodically
  useEffect(() => {
    const checkRecordingStatus = async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const isLocalhost = baseUrl.includes('localhost');
        const url = isLocalhost 
          ? `${baseUrl}/recording-status?room=${encodeURIComponent(roomName)}`
          : `/api/recording?action=status&room=${encodeURIComponent(roomName)}`;
        
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setIsRecording(data.isRecording);
          if (data.isRecording) {
            setEgressId(data.egressId);
            setRecordingStartedBy(data.startedBy);
          }
        }
      } catch (error) {
        console.error('Error checking recording status:', error);
      }
    };

    checkRecordingStatus();
    const interval = setInterval(checkRecordingStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, [roomName]);

  const handleEndCall = useCallback(() => {
    room.disconnect();
    onEndCall();
  }, [room, onEndCall]);

  const handleStartRecording = async () => {
    // Check if there are participants with audio tracks
    const participants = Array.from(room.remoteParticipants.values());
    const localParticipant = room.localParticipant;
    
    // Check if local participant has audio enabled
    const hasLocalAudio = localParticipant?.isMicrophoneEnabled;
    const hasRemoteAudio = participants.some(p => 
      Array.from(p.audioTrackPublications.values()).some(pub => pub.isSubscribed)
    );
    
    if (!hasLocalAudio && !hasRemoteAudio && participants.length === 0) {
      setRecordingError('Cannot start recording: No audio tracks available. Make sure your microphone is enabled.');
      return;
    }
    
    setRecordingLoading(true);
    setRecordingError('');
    
    try {
      const baseUrl = getApiBaseUrl();
      const isLocalhost = baseUrl.includes('localhost');
      const url = isLocalhost 
        ? `${baseUrl}/start-recording`
        : `/api/recording?action=start`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomName, identity: username })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setIsRecording(true);
        setEgressId(data.egressId);
        setRecordingStartedBy(username);
        console.log('Recording started:', data);
      } else {
        if (response.status === 409) {
          // Recording already in progress
          setIsRecording(true);
          setEgressId(data.egressId);
          setRecordingStartedBy(data.startedBy);
          setRecordingError(`Recording already started by ${data.startedBy}`);
        } else {
          setRecordingError(data.error || 'Failed to start recording');
        }
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      setRecordingError('Failed to start recording');
    } finally {
      setRecordingLoading(false);
    }
  };

  const handleStopRecording = async () => {
    setRecordingLoading(true);
    setRecordingError('');
    
    try {
      const baseUrl = getApiBaseUrl();
      const isLocalhost = baseUrl.includes('localhost');
      const url = isLocalhost 
        ? `${baseUrl}/stop-recording`
        : `/api/recording?action=stop`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomName, egressId })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setIsRecording(false);
        setEgressId(null);
        setRecordingStartedBy(null);
        console.log('Recording stopped:', data);
      } else {
        setRecordingError(data.error || 'Failed to stop recording');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      setRecordingError('Failed to stop recording');
    } finally {
      setRecordingLoading(false);
    }
  };

  return (
    <div className="custom-video-conference">
      <VideoConference />
      
      {/* Recording indicator */}
      {isRecording && (
        <div className="recording-indicator">
          <span className="recording-dot"></span>
          <span>Recording{recordingStartedBy ? ` (by ${recordingStartedBy})` : ''}</span>
        </div>
      )}
      
      {/* Recording error message */}
      {recordingError && (
        <div className="recording-error">
          {recordingError}
        </div>
      )}
      
      <div className="end-call-container">
        {/* Recording button */}
        <button 
          className={`recording-button ${isRecording ? 'stop' : 'start'}`}
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          disabled={recordingLoading}
        >
          {recordingLoading ? (
            'Loading...'
          ) : isRecording ? (
            <>
              <span className="recording-icon stop"></span>
              Stop Recording
            </>
          ) : (
            <>
              <span className="recording-icon start"></span>
              Start Recording
            </>
          )}
        </button>
        
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
          <CustomVideoConference 
            onEndCall={handleDisconnect} 
            roomName={roomName}
            username={username}
          />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </div>
  );
}

export default App;
