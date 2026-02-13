// Generates a LiveKit token for the test opponent and serves a minimal video page
// Usage: node scripts/fake-opponent.js

const { createClient } = require("@supabase/supabase-js");
const { AccessToken } = require("livekit-server-sdk");
const http = require("http");
const fs = require("fs");

// Load .env.local
const envFile = fs.readFileSync(".env.local", "utf8");
envFile.split("\n").forEach((line) => {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Find the most recent active video debate
  const { data: debates } = await supabase
    .from("debates")
    .select("*")
    .eq("status", "active")
    .eq("is_video", true)
    .order("started_at", { ascending: false })
    .limit(1);

  if (!debates || debates.length === 0) {
    console.error("No active video debate found. Start one first.");
    process.exit(1);
  }

  const debate = debates[0];
  const roomName = `debate-${debate.id}`;
  const testUserId = debate.user1_id === "0024c4d4-b772-43fd-96c0-ce73d878d0a7"
    ? debate.user1_id
    : debate.user2_id || debate.user1_id;

  console.log("Debate:", debate.id);
  console.log("Room:", roomName);
  console.log("Joining as user:", testUserId);

  // Generate token
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: testUserId, name: "TestOpponent" }
  );
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const jwt = await token.toJwt();
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  const html = `<!DOCTYPE html>
<html><head><title>Fake Opponent</title>
<script src="https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.js"></script>
</head><body style="margin:0;background:#111;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;height:100vh">
<div style="padding:10px;background:#222">
  <strong>Fake Opponent</strong> — Room: ${roomName}
  <span id="status" style="margin-left:10px;color:#888">connecting...</span>
</div>
<div style="flex:1;display:flex;position:relative">
  <video id="remote" autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>
  <video id="local" autoplay playsinline muted style="position:absolute;bottom:10px;right:10px;width:160px;height:120px;object-fit:cover;border:2px solid #444;border-radius:4px;transform:scaleX(-1)"></video>
</div>
<div style="padding:10px;background:#222;text-align:center">
  <button onclick="toggleMic()" id="micBtn" style="padding:8px 16px;margin:0 4px;cursor:pointer">Mute</button>
  <button onclick="toggleCam()" id="camBtn" style="padding:8px 16px;margin:0 4px;cursor:pointer">Cam Off</button>
</div>
<script>
const LivekitClient = window.LivekitClient;
const room = new LivekitClient.Room();
let micOn = true, camOn = true;

room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
  if (track.kind === 'video') track.attach(document.getElementById('remote'));
  else { const el = track.attach(); document.body.appendChild(el); }
});
room.on(LivekitClient.RoomEvent.ParticipantConnected, () => {
  document.getElementById('status').textContent = 'opponent connected';
  document.getElementById('status').style.color = '#4f4';
});
room.on(LivekitClient.RoomEvent.ParticipantDisconnected, () => {
  document.getElementById('status').textContent = 'opponent left';
  document.getElementById('status').style.color = '#f44';
  document.getElementById('remote').srcObject = null;
});

async function start() {
  await room.connect('${livekitUrl}', '${jwt}');
  document.getElementById('status').textContent = 'connected, waiting for opponent...';
  document.getElementById('status').style.color = '#4f4';
  await room.localParticipant.enableCameraAndMicrophone();
  const camPub = room.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
  if (camPub?.track) camPub.track.attach(document.getElementById('local'));
  room.remoteParticipants.forEach(p => {
    p.trackPublications.forEach(pub => {
      if (pub.track?.kind === 'video') pub.track.attach(document.getElementById('remote'));
    });
  });
}

function toggleMic() {
  micOn = !micOn;
  room.localParticipant.setMicrophoneEnabled(micOn);
  document.getElementById('micBtn').textContent = micOn ? 'Mute' : 'Unmute';
}
function toggleCam() {
  camOn = !camOn;
  room.localParticipant.setCameraEnabled(camOn);
  document.getElementById('camBtn').textContent = camOn ? 'Cam Off' : 'Cam On';
}

start().catch(e => {
  document.getElementById('status').textContent = 'error: ' + e.message;
  document.getElementById('status').style.color = '#f44';
});
</script></body></html>`;

  // Serve on port 3333
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  server.listen(3333, () => {
    console.log("\nOpen http://localhost:3333 in another browser tab to join as the fake opponent.");
    console.log("Press Ctrl+C to stop.\n");
  });
}

main().catch(console.error);
