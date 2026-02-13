import { createClient } from "@supabase/supabase-js";
import { Glicko2 } from "glicko2";
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

  const { debate_id, user_id, vote } = req.body;

  if (
    !debate_id ||
    !user_id ||
    !["self", "opponent", "draw", "ai_debate"].includes(vote)
  ) {
    return res.status(400).json({ error: "Invalid request" });
  }

  // Fetch the debate
  const { data: debate, error: fetchErr } = await supabase
    .from("debates")
    .select("*")
    .eq("id", debate_id)
    .single();

  if (fetchErr || !debate) {
    return res.status(404).json({ error: "Debate not found" });
  }

  // --- AI Debate: skip voting, go straight to AI judge ---
  if (vote === "ai_debate") {
    if (!debate.is_ai_opponent) {
      return res.status(400).json({ error: "Not an AI debate" });
    }

    if (debate.status !== "active") {
      return res.status(400).json({ error: "Debate is not active" });
    }

    try {
      const aiResult = await getAIDebateJudgment(debate);

      // Determine winner_id respecting FK constraint
      // winner_id FK references auth.users — supabot is NOT there
      let winnerId = null;
      let outcome = "draw";
      if (aiResult.winner === "user1") {
        winnerId = debate.user1_id;
        outcome = "user1_wins";
      } else if (aiResult.winner === "user2") {
        winnerId = null; // Can't store AI ID in winner_id FK
        outcome = "ai_wins";
      }

      // Finalize debate — no rating changes
      await supabase
        .from("debates")
        .update({
          status: "completed",
          winner_id: winnerId,
          outcome,
          ended_at: new Date().toISOString(),
        })
        .eq("id", debate_id);

      return res.status(200).json({
        status: "completed",
        winner_id: winnerId,
        outcome,
        ai_judgment: aiResult,
      });
    } catch (err) {
      console.error("AI debate judgment failed:", err);
      return res.status(500).json({ error: "AI judgment failed" });
    }
  }

  // --- Human Debate: existing voting flow ---
  if (debate.status !== "active" && debate.status !== "voting") {
    return res.status(400).json({ error: "Debate is not active" });
  }

  // Determine which user is voting
  const isUser1 = user_id === debate.user1_id;
  const isUser2 = user_id === debate.user2_id;
  if (!isUser1 && !isUser2) {
    return res.status(403).json({ error: "Not a participant" });
  }

  // Save the vote and set status to voting
  const voteColumn = isUser1 ? "user1_vote" : "user2_vote";
  const { error: voteErr } = await supabase
    .from("debates")
    .update({ [voteColumn]: vote, status: "voting" })
    .eq("id", debate_id);

  if (voteErr) {
    return res.status(500).json({ error: "Failed to save vote" });
  }

  // Re-fetch to see if both votes are in
  const { data: updated } = await supabase
    .from("debates")
    .select("*")
    .eq("id", debate_id)
    .single();

  if (!updated.user1_vote || !updated.user2_vote) {
    return res.status(200).json({ status: "waiting_for_opponent" });
  }

  // Both votes are in — resolve the winner
  const result = await resolveWinner(updated);

  // Run Glicko-2 and update ratings
  const ratingChanges = await updateRatings(
    updated.user1_id,
    updated.user2_id,
    result.score1
  );

  // Finalize the debate
  await supabase
    .from("debates")
    .update({
      status: "completed",
      winner_id: result.winnerId,
      outcome: result.outcome,
      ended_at: new Date().toISOString(),
    })
    .eq("id", debate_id);

  return res.status(200).json({
    status: "completed",
    winner_id: result.winnerId,
    outcome: result.outcome,
    ratings: ratingChanges,
    ai_judgment: result.aiJudgment || null,
  });
}

async function resolveWinner(debate) {
  const v1 = debate.user1_vote;
  const v2 = debate.user2_vote;

  // Check for agreement
  if (v1 === "self" && v2 === "opponent") {
    return { winnerId: debate.user1_id, outcome: "user1_wins", score1: 1 };
  }
  if (v1 === "opponent" && v2 === "self") {
    return { winnerId: debate.user2_id, outcome: "user2_wins", score1: 0 };
  }
  if (v1 === "draw" && v2 === "draw") {
    return { winnerId: null, outcome: "draw", score1: 0.5 };
  }

  // Disagreement — AI decides
  try {
    const aiResult = await getAIJudgment(debate);
    if (aiResult.winner === "user1") {
      return {
        winnerId: debate.user1_id,
        outcome: "user1_wins_ai",
        score1: 1,
        aiJudgment: aiResult,
      };
    }
    if (aiResult.winner === "user2") {
      return {
        winnerId: debate.user2_id,
        outcome: "user2_wins_ai",
        score1: 0,
        aiJudgment: aiResult,
      };
    }
    return {
      winnerId: null,
      outcome: "draw_ai",
      score1: 0.5,
      aiJudgment: aiResult,
    };
  } catch (err) {
    console.error("AI judging failed, defaulting to draw:", err);
    return { winnerId: null, outcome: "draw", score1: 0.5 };
  }
}

async function getAIJudgment(debate) {
  const { data: users } = await supabase
    .from("users")
    .select("id, username")
    .in("id", [debate.user1_id, debate.user2_id]);

  const user1 = users.find((u) => u.id === debate.user1_id);
  const user2 = users.find((u) => u.id === debate.user2_id);

  const { data: messages } = await supabase
    .from("messages")
    .select("message, user_id")
    .eq("channel_id", debate.channel_id)
    .order("inserted_at", { ascending: true });

  if (!messages || messages.length === 0) {
    return { winner: "draw", reasoning: "No messages exchanged." };
  }

  const transcript = messages
    .map((m) => {
      const name = m.user_id === debate.user1_id ? user1?.username : user2?.username;
      return `${name}: ${m.message}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `You are an impartial debate judge. Evaluate based on: argument strength, evidence use, rebuttal quality, logical consistency, and persuasiveness.

Respond in this exact JSON format only:
{"winner": "user1" | "user2" | "draw", "reasoning": "2-3 sentence explanation", "scores": {"user1": X, "user2": Y}}

Scores 1-10. If within 1 point, declare draw. No text outside JSON.`,
    messages: [
      {
        role: "user",
        content: `Topic: "${debate.topic}"\nUser1: ${user1?.username}\nUser2: ${user2?.username}\n\n${transcript}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { winner: "draw", reasoning: text };
  }
}

async function getAIDebateJudgment(debate) {
  const { data: user1 } = await supabase
    .from("users")
    .select("id, username")
    .eq("id", debate.user1_id)
    .single();

  const { data: messages } = await supabase
    .from("messages")
    .select("message, user_id")
    .eq("channel_id", debate.channel_id)
    .order("inserted_at", { ascending: true });

  if (!messages || messages.length === 0) {
    return { winner: "draw", reasoning: "No messages exchanged." };
  }

  const transcript = messages
    .map((m) => {
      const name =
        m.user_id === SUPABOT_ID
          ? "AI Opponent"
          : user1?.username || "User";
      return `${name}: ${m.message}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: `You are an impartial debate judge. Evaluate based on: argument strength, evidence use, rebuttal quality, logical consistency, and persuasiveness.

Respond in this exact JSON format only:
{"winner": "user1" | "user2" | "draw", "reasoning": "2-3 sentence explanation", "scores": {"user1": X, "user2": Y}}

user1 is ${user1?.username || "User"}, user2 is AI Opponent.
Scores 1-10. If within 1 point, declare draw. No text outside JSON.`,
    messages: [
      {
        role: "user",
        content: `Topic: "${debate.topic}"\nUser1: ${user1?.username || "User"}\nUser2: AI Opponent\n\n${transcript}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { winner: "draw", reasoning: text };
  }
}

async function updateRatings(user1Id, user2Id, score1) {
  // Fetch both users
  const { data: users } = await supabase
    .from("users")
    .select("id, rating, rating_deviation, volatility, total_debates, wins, losses")
    .in("id", [user1Id, user2Id]);

  const u1 = users.find((u) => u.id === user1Id);
  const u2 = users.find((u) => u.id === user2Id);

  // Run Glicko-2
  const ranking = new Glicko2({ tau: 0.5, rating: 1500, rd: 350, vol: 0.06 });
  const p1 = ranking.makePlayer(u1.rating, u1.rating_deviation, u1.volatility);
  const p2 = ranking.makePlayer(u2.rating, u2.rating_deviation, u2.volatility);

  ranking.updateRatings([[p1, p2, score1]]);

  const newR1 = {
    rating: p1.getRating(),
    rating_deviation: p1.getRd(),
    volatility: p1.getVol(),
  };
  const newR2 = {
    rating: p2.getRating(),
    rating_deviation: p2.getRd(),
    volatility: p2.getVol(),
  };

  // Update user 1
  await supabase
    .from("users")
    .update({
      ...newR1,
      total_debates: u1.total_debates + 1,
      wins: u1.wins + (score1 === 1 ? 1 : 0),
      losses: u1.losses + (score1 === 0 ? 1 : 0),
    })
    .eq("id", user1Id);

  // Update user 2
  await supabase
    .from("users")
    .update({
      ...newR2,
      total_debates: u2.total_debates + 1,
      wins: u2.wins + (score1 === 0 ? 1 : 0),
      losses: u2.losses + (score1 === 1 ? 1 : 0),
    })
    .eq("id", user2Id);

  return {
    [user1Id]: {
      oldRating: Math.round(u1.rating),
      newRating: Math.round(newR1.rating),
      change: Math.round(newR1.rating - u1.rating),
    },
    [user2Id]: {
      oldRating: Math.round(u2.rating),
      newRating: Math.round(newR2.rating),
      change: Math.round(newR2.rating - u2.rating),
    },
  };
}
