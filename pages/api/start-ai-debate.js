import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUPABOT_ID = "8d0fd2b3-9ca7-4d9e-a95f-9e13dded323e";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { user_id, topic } = req.body;

  if (!user_id || !topic) {
    return res.status(400).json({ error: "Missing user_id or topic" });
  }

  try {
    // 1. Create the debate
    const { data: debate, error: debateErr } = await supabase
      .from("debates")
      .insert([
        {
          topic,
          status: "active",
          user1_id: user_id,
          is_ai_opponent: true,
          started_at: new Date().toISOString(),
        },
      ])
      .single();

    if (debateErr) throw debateErr;

    // 2. Create a channel
    const { data: channel, error: chanErr } = await supabase
      .from("channels")
      .insert([
        {
          slug: `ai-debate-${debate.id.substring(0, 8)}`,
          created_by: user_id,
          debate_id: debate.id,
        },
      ])
      .single();

    if (chanErr) throw chanErr;

    // 3. Link channel to debate
    const { error: linkErr } = await supabase
      .from("debates")
      .update({ channel_id: channel.id })
      .eq("id", debate.id);

    if (linkErr) throw linkErr;

    // 4. Generate AI opening message
    const aiResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `You are a debate opponent arguing AGAINST the following topic: "${topic}".
Write a brief opening statement (2-3 paragraphs) presenting your case against this topic.
Be articulate, use clear reasoning, and be respectful but firm in your position.
Do not mention that you are an AI.`,
      messages: [
        {
          role: "user",
          content:
            "Please present your opening argument against this topic.",
        },
      ],
    });

    const openingMessage = aiResponse.content[0].text;

    // 5. Insert opening message from supabot
    const { error: msgErr } = await supabase.from("messages").insert([
      {
        message: openingMessage,
        channel_id: channel.id,
        user_id: SUPABOT_ID,
      },
    ]);

    if (msgErr) throw msgErr;

    return res.status(200).json({
      debate_id: debate.id,
      channel_id: channel.id,
      topic,
    });
  } catch (err) {
    console.error("Start AI debate error:", err);
    return res.status(500).json({ error: "Failed to start AI debate" });
  }
}
