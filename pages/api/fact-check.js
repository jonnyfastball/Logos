import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, topic, recentMessages } = req.body;

  if (!message || !topic) {
    return res.status(400).json({ error: "Missing message or topic" });
  }

  try {
    const context = (recentMessages || [])
      .map((m) => `${m.author}: ${m.message}`)
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: `You are a fact-checker for a live debate on the topic: "${topic}".

Your job:
1. Read the latest message in the context of the debate.
2. Determine if it contains a specific factual claim that is FALSE or MISLEADING (wrong statistics, wrong dates, incorrect scientific claims, false historical events, misattributed quotes, etc.).
3. If the message contains a false or misleading claim: provide a brief correction (2-3 sentences max). State what is wrong and give the correct information.
4. Otherwise — if the message contains no factual claims, only opinions/arguments/rhetoric, or if the factual claims are accurate — respond with exactly "NO_CHECK".

Only flag claims that are clearly false or misleading. Accurate facts, opinions, predictions, and subjective statements should all get "NO_CHECK".`,
      messages: [
        {
          role: "user",
          content: `Recent debate messages:\n${context}\n\nLatest message to evaluate:\n"${message}"`,
        },
      ],
    });

    const text = response.content[0].text.trim();

    if (text.includes("NO_CHECK")) {
      return res.status(200).json({ needsCheck: false });
    }

    return res.status(200).json({ needsCheck: true, factCheck: text });
  } catch (err) {
    console.error("Fact-check error:", err);
    return res.status(500).json({ error: "Fact-check failed" });
  }
}
