import { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalVideoTrack,
  createLocalAudioTrack,
} from "livekit-client";

export default function VideoChat({ debateId, userId, onTranscript }) {
  const [room, setRoom] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);
  const recognitionRef = useRef(null);

  const speechSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // Speech recognition lifecycle
  useEffect(() => {
    if (!connected || !micEnabled || !onTranscript || !speechSupported) {
      // Stop recognition when disconnected, muted, or unsupported
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
        recognitionRef.current = null;
        setTranscribing(false);
      }
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) onTranscript(text);
        }
      }
    };

    recognition.onend = () => {
      // Auto-restart — recognition stops after pauses
      try {
        recognition.start();
      } catch (e) {
        // Already started, ignore
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setTranscribing(false);
      }
      // Other errors (no-speech, network) are transient — onend will restart
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setTranscribing(true);
    } catch (e) {
      console.error("Speech recognition failed to start:", e);
    }

    return () => {
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
      setTranscribing(false);
    };
  }, [connected, micEnabled, onTranscript, speechSupported]);

  // Connect to LiveKit room
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        const res = await fetch("/api/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ debate_id: debateId, user_id: userId }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to get token");
        }

        if (cancelled) return;

        const newRoom = new Room();
        roomRef.current = newRoom;

        // Handle remote tracks
        newRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          if (track.kind === Track.Kind.Video) {
            const el = remoteVideoRef.current;
            if (el) {
              track.attach(el);
            }
            setRemoteConnected(true);
          } else if (track.kind === Track.Kind.Audio) {
            const audioEl = track.attach();
            document.body.appendChild(audioEl);
          }
        });

        newRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
        });

        newRoom.on(RoomEvent.ParticipantConnected, () => {
          setRemoteConnected(true);
        });

        newRoom.on(RoomEvent.ParticipantDisconnected, () => {
          setRemoteConnected(false);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
        });

        newRoom.on(RoomEvent.Disconnected, () => {
          setConnected(false);
        });

        const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        await newRoom.connect(livekitUrl, data.token);

        if (cancelled) {
          newRoom.disconnect();
          return;
        }

        // Enable camera and mic
        await newRoom.localParticipant.enableCameraAndMicrophone();

        // Attach local video
        const localVideoTrack = newRoom.localParticipant.getTrackPublication(
          Track.Source.Camera
        );
        if (localVideoTrack?.track && localVideoRef.current) {
          localVideoTrack.track.attach(localVideoRef.current);
        }

        // Check if remote participant is already connected
        if (newRoom.remoteParticipants.size > 0) {
          setRemoteConnected(true);
          // Attach any existing remote video tracks
          newRoom.remoteParticipants.forEach((participant) => {
            participant.trackPublications.forEach((pub) => {
              if (pub.track && pub.track.kind === Track.Kind.Video) {
                const el = remoteVideoRef.current;
                if (el) {
                  pub.track.attach(el);
                }
              }
            });
          });
        }

        setRoom(newRoom);
        setConnected(true);
        setConnecting(false);
      } catch (err) {
        console.error("LiveKit connection error:", err);
        if (!cancelled) {
          setError(err.message || "Failed to connect to video");
          setConnecting(false);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, [debateId, userId]);

  const toggleMic = useCallback(async () => {
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micEnabled);
    setMicEnabled(!micEnabled);
  }, [room, micEnabled]);

  const toggleCam = useCallback(async () => {
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!camEnabled);
    setCamEnabled(!camEnabled);
  }, [room, camEnabled]);

  if (error) {
    return (
      <div className="bg-gray-900 border-b border-gray-700 p-4 text-center">
        <p className="text-red-400 text-sm">Video error: {error}</p>
      </div>
    );
  }

  if (connecting) {
    return (
      <div className="bg-gray-900 border-b border-gray-700 p-8 text-center">
        <div className="inline-block w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
        <p className="text-gray-400 text-sm">Connecting to video...</p>
      </div>
    );
  }

  return (
    <div className="bg-black border-b border-gray-700 relative overflow-hidden" style={{ height: "40vh" }}>
      {/* Remote video (main area) */}
      <div className="w-full h-full flex items-center justify-center">
        {remoteConnected ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-gray-500 text-center">
            <p className="text-lg mb-1">Waiting for opponent...</p>
            <p className="text-sm">Their video will appear here</p>
          </div>
        )}
      </div>

      {/* Local video (PiP, bottom-right) */}
      <div className="absolute bottom-12 right-3 w-32 h-24 bg-gray-800 rounded overflow-hidden border border-gray-600 shadow-lg">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover mirror"
          style={{ transform: "scaleX(-1)" }}
        />
      </div>

      {/* Controls bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gray-900 bg-opacity-80 p-2 flex items-center justify-center space-x-3">
        <button
          onClick={toggleMic}
          className={`py-1 px-4 rounded text-sm transition duration-150 ${
            micEnabled
              ? "bg-gray-700 hover:bg-gray-600 text-white"
              : "bg-red-700 hover:bg-red-600 text-white"
          }`}
        >
          {micEnabled ? "Mute" : "Unmute"}
        </button>
        <button
          onClick={toggleCam}
          className={`py-1 px-4 rounded text-sm transition duration-150 ${
            camEnabled
              ? "bg-gray-700 hover:bg-gray-600 text-white"
              : "bg-red-700 hover:bg-red-600 text-white"
          }`}
        >
          {camEnabled ? "Cam Off" : "Cam On"}
        </button>
        {onTranscript && (
          transcribing ? (
            <span className="text-green-400 text-xs ml-2">Transcribing...</span>
          ) : !speechSupported ? (
            <span className="text-yellow-400 text-xs ml-2">Transcription unavailable</span>
          ) : null
        )}
      </div>
    </div>
  );
}
