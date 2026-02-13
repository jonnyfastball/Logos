import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { debate_id, user_id } = req.body;

  if (!debate_id || !user_id) {
    return res.status(400).json({ error: "Missing debate_id or user_id" });
  }

  try {
    // Verify user is a participant and debate is a video debate
    const { data: debate, error: debateErr } = await supabase
      .from("debates")
      .select("*")
      .eq("id", debate_id)
      .single();

    if (debateErr || !debate) {
      return res.status(404).json({ error: "Debate not found" });
    }

    if (!debate.is_video) {
      return res.status(400).json({ error: "This is not a video debate" });
    }

    if (debate.user1_id !== user_id && debate.user2_id !== user_id) {
      return res.status(403).json({ error: "Not a participant in this debate" });
    }

    // Fetch username for participant identity
    const { data: userData } = await supabase
      .from("users")
      .select("username")
      .eq("id", user_id)
      .single();

    const username = userData?.username || "User";
    const roomName = `debate-${debate_id}`;

    // Generate access token
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: user_id,
        name: username,
      }
    );

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    return res.status(200).json({
      token: await token.toJwt(),
      room_name: roomName,
    });
  } catch (err) {
    console.error("LiveKit token error:", err);
    return res.status(500).json({ error: "Failed to generate token" });
  }
}
