import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    // Fetch both usernames
    const { data: users } = await supabase
      .from("users")
      .select("id, username")
      .in("id", [debate.user1_id, debate.user2_id]);

    const user1 = users.find((u) => u.id === debate.user1_id);
    const user2 = users.find((u) => u.id === debate.user2_id);

    // Fetch messages
    const { data: messages } = await supabase
      .from("messages")
      .select("message, user_id, inserted_at")
      .eq("channel_id", debate.channel_id)
      .order("inserted_at", { ascending: true });

    if (!messages || messages.length === 0) {
      return res.status(200).json({
        winner: null,
        reasoning: "No messages were exchanged. Declared a draw.",
      });
    }

    const transcript = messages
      .map((m) => {
        const name =
          m.user_id === debate.user1_id
            ? user1?.username
            : user2?.username;
        return `${name}: ${m.message}`;
      })
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are an impartial debate judge. You will be given a debate transcript between two participants on a specific topic.

Evaluate the debate based on:
1. Strength of arguments and reasoning
2. Use of evidence and facts
3. Addressing opponent's points (rebuttal quality)
4. Logical consistency
5. Persuasiveness

You MUST respond in this exact JSON format:
{"winner": "user1" | "user2" | "draw", "reasoning": "2-3 sentence explanation", "scores": {"user1": X, "user2": Y}}

Scores should be 1-10 for each participant. If scores are within 1 point, declare a draw.
Do NOT include any text outside the JSON object.`,
      messages: [
        {
          role: "user",
          content: `Topic: "${debate.topic}"\n\nParticipant 1 (user1): ${user1?.username}\nParticipant 2 (user2): ${user2?.username}\n\nTranscript:\n${transcript}`,
        },
      ],
    });

    const text = response.content[0].text.trim();
    let judgment;
    try {
      judgment = JSON.parse(text);
    } catch {
      judgment = { winner: "draw", reasoning: text, scores: {} };
    }

    // Map winner back to user IDs
    let winnerId = null;
    if (judgment.winner === "user1") winnerId = debate.user1_id;
    else if (judgment.winner === "user2") winnerId = debate.user2_id;

    return res.status(200).json({
      winner_id: winnerId,
      winner: judgment.winner,
      reasoning: judgment.reasoning,
      scores: judgment.scores,
      user1_name: user1?.username,
      user2_name: user2?.username,
    });
  } catch (err) {
    console.error("Judge error:", err);
    return res.status(500).json({ error: "AI judging failed" });
  }
}
