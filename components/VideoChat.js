import { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
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
  const onTranscriptRef = useRef(onTranscript);

  const speechSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // Keep ref in sync so the effect doesn't restart on every parent re-render
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // Speech recognition — auto-starts once connected and video elements are mounted.
  // Mic permission is granted by the upfront getUserMedia call in the connect effect.
  useEffect(() => {
    if (!connected || !onTranscriptRef.current || !speechSupported || connecting) {
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

    let fatal = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text && onTranscriptRef.current) onTranscriptRef.current(text);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        fatal = true;
        recognition.onend = null;
        recognitionRef.current = null;
        setTranscribing(false);
      }
    };

    recognition.onend = () => {
      if (fatal) return;
      try {
        recognition.start();
      } catch (e) {
        // ignore
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setTranscribing(true);
    } catch (e) {
      // Speech recognition unavailable
    }

    return () => {
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
      setTranscribing(false);
    };
  }, [connected, connecting, speechSupported]);

  // Connect to LiveKit room
  useEffect(() => {
    let cancelled = false;

    async function connect() {
      try {
        const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
        if (!livekitUrl) {
          throw new Error("LiveKit URL not configured");
        }

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

        // Attach local camera whenever it's published (handles timing
        // where the <video> element doesn't exist yet during connect)
        newRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
          if (publication.source === Track.Source.Camera && localVideoRef.current) {
            publication.track.attach(localVideoRef.current);
          }
        });

        // Request camera + mic permission upfront with a single getUserMedia
        // call so Chrome shows one combined prompt. Release streams immediately;
        // LiveKit will re-acquire them. Falls back to video-only if no mic.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch (permErr) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach((t) => t.stop());
          } catch (e) {
            // continue anyway
          }
        }

        // Connect with a 15s timeout so it never hangs
        await Promise.race([
          newRoom.connect(livekitUrl, data.token),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Connection timed out")), 15000)
          ),
        ]);

        if (cancelled) {
          newRoom.disconnect();
          return;
        }

        // Enable camera and mic via LiveKit — permissions already granted above
        try {
          await newRoom.localParticipant.setCameraEnabled(true);
        } catch (camErr) {
          setCamEnabled(false);
        }
        try {
          await newRoom.localParticipant.setMicrophoneEnabled(true);
        } catch (micErr) {
          setMicEnabled(false);
        }

        // Try to attach local video now (may succeed if ref is ready)
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

  // Safety: re-attach tracks when video elements appear in the DOM.
  // In React 16, async setState calls are NOT batched — setRoom, setConnected,
  // and setConnecting each trigger separate re-renders. The <video> elements
  // only mount once `connecting` becomes false, so we must include it as a dep.
  useEffect(() => {
    if (!room || !connected || connecting) return;
    const localPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (localPub?.track && localVideoRef.current) {
      localPub.track.attach(localVideoRef.current);
    }
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((pub) => {
        if (pub.track && pub.track.kind === Track.Kind.Video && remoteVideoRef.current) {
          pub.track.attach(remoteVideoRef.current);
        }
      });
    });
  }, [room, connected, connecting]);

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
      <div style={{ background: 'var(--bg-secondary)', padding: 16, textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#fca5a5', fontSize: 13 }}>Video error: {error}</p>
      </div>
    );
  }

  if (connecting) {
    return (
      <div style={{ background: 'var(--bg-secondary)', padding: 32, textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner spinner-blue spinner-md" style={{ marginBottom: 10 }}></div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Connecting to video...</p>
      </div>
    );
  }

  return (
    <>
      {/* Remote video panel */}
      <div className="video-panel video-panel--remote">
        <span className="video-panel__label">Opponent</span>
        {remoteConnected ? (
          <video ref={remoteVideoRef} autoPlay playsInline />
        ) : (
          <div className="video-panel__waiting">
            <p>Waiting for opponent...</p>
            <p>Their video will appear here</p>
          </div>
        )}
      </div>

      {/* Local video panel */}
      <div className="video-panel video-panel--local">
        <span className="video-panel__label">You</span>
        <video ref={localVideoRef} autoPlay playsInline muted />
      </div>

      {/* Controls bar */}
      <div className="video-controls-bar">
        <button
          onClick={toggleMic}
          className={`btn btn-sm ${micEnabled ? 'btn-secondary' : 'btn-danger'}`}
        >
          {micEnabled ? "Mute" : "Unmute"}
        </button>
        <button
          onClick={toggleCam}
          className={`btn btn-sm ${camEnabled ? 'btn-secondary' : 'btn-danger'}`}
        >
          {camEnabled ? "Cam Off" : "Cam On"}
        </button>
        {onTranscript && (
          transcribing ? (
            <span className="badge badge-green" style={{ marginLeft: 4 }}>Transcribing</span>
          ) : !speechSupported ? (
            <span className="badge badge-yellow" style={{ marginLeft: 4 }}>No transcription</span>
          ) : null
        )}
      </div>
    </>
  );
}
