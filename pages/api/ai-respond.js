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

  const { debate_id } = req.body;

  if (!debate_id) {
    return res.status(400).json({ error: "Missing debate_id" });
  }

  try {
    // Fetch debate
    const { data: debate, error: debateErr } = await supabase
      .from("debates")
      .select("*")
      .eq("id", debate_id)
      .single();

    if (debateErr || !debate) {
      return res.status(404).json({ error: "Debate not found" });
    }

    if (!debate.is_ai_opponent) {
      return res.status(400).json({ error: "Not an AI debate" });
    }

    // Fetch user1 name
    const { data: user1 } = await supabase
      .from("users")
      .select("username")
      .eq("id", debate.user1_id)
      .single();

    // Fetch messages
    const { data: messages } = await supabase
      .from("messages")
      .select("message, user_id")
      .eq("channel_id", debate.channel_id)
      .order("inserted_at", { ascending: true });

    // Build conversation for Claude
    const transcript = (messages || [])
      .map((m) => {
        const name =
          m.user_id === SUPABOT_ID
            ? "You"
            : user1?.username || "Opponent";
        return `${name}: ${m.message}`;
      })
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `You are a debate opponent arguing AGAINST the topic: "${debate.topic}".
You are in an ongoing debate. Respond to your opponent's latest point with a clear, well-reasoned counterargument.
Keep your response to 1-2 paragraphs. Be articulate and respectful but firm.
Do not mention that you are an AI. Address the arguments directly.`,
      messages: [
        {
          role: "user",
          content: `Here is the debate so far:\n\n${transcript}\n\nProvide your next response in the debate.`,
        },
      ],
    });

    const aiMessage = response.content[0].text;

    // Insert AI message
    const { error: msgErr } = await supabase.from("messages").insert([
      {
        message: aiMessage,
        channel_id: debate.channel_id,
        user_id: SUPABOT_ID,
      },
    ]);

    if (msgErr) throw msgErr;

    return res.status(200).json({ message: aiMessage });
  } catch (err) {
    console.error("AI respond error:", err);
    return res.status(500).json({ error: "AI response failed" });
  }
}
