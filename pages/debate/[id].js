import { useState, useEffect, useContext, useRef } from "react";
import { useRouter } from "next/router";
import UserContext from "lib/UserContext";
import { supabase } from "lib/Store";
import MessageInput from "~/components/MessageInput";
import VideoChat from "~/components/VideoChat";

export default function DebateRoom() {
  const { user } = useContext(UserContext);
  const router = useRouter();
  const { id: debateId } = router.query;
  const [debate, setDebate] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [myRating, setMyRating] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [voting, setVoting] = useState(false);
  const [myVote, setMyVote] = useState(null);
  const [result, setResult] = useState(null);
  const [factChecks, setFactChecks] = useState({});
  const [checkingMsgId, setCheckingMsgId] = useState(null);
  const [aiTyping, setAiTyping] = useState(false);
  const [endingDebate, setEndingDebate] = useState(false);
  const messagesEndRef = useRef(null);

  // Fetch debate + opponent + ratings
  useEffect(() => {
    if (!debateId || !user) return;

    async function load() {
      const { data: d, error: err } = await supabase
        .from("debates")
        .select("*")
        .eq("id", debateId)
        .single();

      if (err || !d) {
        setError("Debate not found.");
        return;
      }

      setDebate(d);

      const isUser1 = d.user1_id === user.id;

      // Restore state if already voting/completed
      if (d.status === "voting" && !d.is_ai_opponent) {
        setVoting(true);
        const existingVote = isUser1 ? d.user1_vote : d.user2_vote;
        if (existingVote) setMyVote(existingVote);
      }
      if (d.status === "completed") {
        if (d.is_ai_opponent) {
          const outcome =
            d.outcome === "user1_wins"
              ? "win"
              : d.outcome === "ai_wins"
              ? "loss"
              : "draw";
          setResult({ winner_id: d.winner_id, outcome, is_practice: true });
        } else {
          setResult({
            winner_id: d.winner_id,
            outcome:
              d.winner_id === user.id
                ? "win"
                : d.winner_id
                ? "loss"
                : "draw",
          });
        }
      }

      // Fetch my rating
      const { data: me } = await supabase
        .from("users")
        .select("rating, rating_deviation")
        .eq("id", user.id)
        .single();
      if (me) setMyRating(me);

      // Fetch opponent (human debates only)
      if (!d.is_ai_opponent) {
        const opponentId = isUser1 ? d.user2_id : d.user1_id;
        if (opponentId) {
          const { data: opp } = await supabase
            .from("users")
            .select("id, username, rating, rating_deviation")
            .eq("id", opponentId)
            .single();
          if (opp) setOpponent(opp);
        }
      }

      // Fetch messages
      if (d.channel_id) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("*, author:user_id(username)")
          .eq("channel_id", d.channel_id)
          .order("inserted_at", { ascending: true });
        if (msgs) setMessages(msgs);
      }
    }

    load();
  }, [debateId, user]);

  // Realtime: messages
  useEffect(() => {
    if (!debate?.channel_id) return;

    const subscription = supabase
      .from(`messages:channel_id=eq.${debate.channel_id}`)
      .on("INSERT", async (payload) => {
        const msg = payload.new;
        const { data: author } = await supabase
          .from("users")
          .select("username")
          .eq("id", msg.user_id)
          .single();
        setMessages((prev) => [...prev, { ...msg, author }]);
        // Clear AI typing indicator when AI message arrives
        if (msg.user_id !== user.id) {
          setAiTyping(false);
          triggerFactCheck(msg.id, msg.message);
        }
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, [debate?.channel_id]);

  // Realtime: debate status changes (voting → completed)
  useEffect(() => {
    if (!debateId) return;

    const subscription = supabase
      .from(`debates:id=eq.${debateId}`)
      .on("UPDATE", (payload) => {
        const d = payload.new;
        setDebate(d);
        if (d.status === "voting" && !d.is_ai_opponent) {
          setVoting(true);
        }
        if (d.status === "completed") {
          if (d.is_ai_opponent) {
            const outcome =
              d.outcome === "user1_wins"
                ? "win"
                : d.outcome === "ai_wins"
                ? "loss"
                : "draw";
            setResult({
              winner_id: d.winner_id,
              outcome,
              is_practice: true,
            });
          } else {
            const outcome =
              d.winner_id === user.id
                ? "win"
                : d.winner_id
                ? "loss"
                : "draw";
            setResult({ winner_id: d.winner_id, outcome });
            refreshRatings(d);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, [debateId, user]);

  async function refreshRatings(d) {
    const { data: me } = await supabase
      .from("users")
      .select("rating, rating_deviation")
      .eq("id", user.id)
      .single();
    if (me) setMyRating(me);

    const opponentId = d.user1_id === user.id ? d.user2_id : d.user1_id;
    if (opponentId) {
      const { data: opp } = await supabase
        .from("users")
        .select("id, username, rating, rating_deviation")
        .eq("id", opponentId)
        .single();
      if (opp) setOpponent(opp);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiTyping]);

  async function handleSend(text) {
    if (!debate?.channel_id || !user) return;
    const { data: inserted } = await supabase
      .from("messages")
      .insert([
        { message: text, channel_id: debate.channel_id, user_id: user.id },
      ])
      .single();

    // Fire fact-check in background
    if (inserted) {
      triggerFactCheck(inserted.id, text);
    }

    // Trigger AI response for AI debates
    if (debate.is_ai_opponent) {
      setAiTyping(true);
      try {
        await fetch("/api/ai-respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ debate_id: debate.id }),
        });
      } catch (err) {
        console.error("AI response failed:", err);
        setAiTyping(false);
      }
    }
  }

  async function triggerFactCheck(msgId, text) {
    setCheckingMsgId(msgId);
    try {
      const recent = messages.slice(-6).map((m) => ({
        author: m.author?.username || "Unknown",
        message: m.message,
      }));
      const res = await fetch("/api/fact-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          topic: debate.topic,
          recentMessages: recent,
        }),
      });
      const data = await res.json();
      if (data.needsCheck) {
        setFactChecks((prev) => ({ ...prev, [msgId]: data.factCheck }));
      }
    } catch (err) {
      console.error("Fact-check failed:", err);
    } finally {
      setCheckingMsgId(null);
    }
  }

  async function handleEndDebate() {
    if (debate.is_ai_opponent) {
      // AI debates skip voting — go straight to AI judge
      setEndingDebate(true);
      try {
        const res = await fetch("/api/end-debate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            debate_id: debateId,
            user_id: user.id,
            vote: "ai_debate",
          }),
        });
        const data = await res.json();
        if (data.status === "completed") {
          const outcome =
            data.outcome === "user1_wins"
              ? "win"
              : data.outcome === "ai_wins"
              ? "loss"
              : "draw";
          setResult({
            winner_id: data.winner_id,
            outcome,
            ai_judgment: data.ai_judgment,
            is_practice: true,
          });
          setDebate((prev) => ({ ...prev, status: "completed" }));
        }
      } catch (err) {
        console.error("End AI debate failed:", err);
        setError("Failed to end debate. Please try again.");
      } finally {
        setEndingDebate(false);
      }
      return;
    }

    setVoting(true);
    await supabase
      .from("debates")
      .update({ status: "voting" })
      .eq("id", debateId);
  }

  async function handleVote(vote) {
    setMyVote(vote);
    const res = await fetch("/api/end-debate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debate_id: debateId, user_id: user.id, vote }),
    });
    const data = await res.json();
    if (data.status === "completed") {
      setResult({
        winner_id: data.winner_id,
        outcome:
          data.winner_id === user.id
            ? "win"
            : data.winner_id
            ? "loss"
            : "draw",
        ratings: data.ratings,
        ai_judgment: data.ai_judgment,
      });
    }
  }

  if (!user) return null;

  if (error) {
    return (
      <div className="main flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/lobby")}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded transition duration-150"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!debate) {
    return (
      <div className="main flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const isAiDebate = debate.is_ai_opponent;
  const isVideoActive = debate.is_video && !isAiDebate && debate.status === "active" && !result;

  return (
    <div className="main flex flex-col h-screen w-screen bg-gray-800 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 p-3 flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
            Debate Topic
            {isAiDebate && (
              <span className="ml-2 text-purple-400">(Practice)</span>
            )}
            {debate.is_video && !isAiDebate && (
              <span className="ml-2 text-blue-400">(Video)</span>
            )}
          </div>
          <h2 className="text-lg font-semibold">{debate.topic}</h2>
          <p className="text-sm text-gray-400 mt-1">
            {myRating && (
              <span className="text-gray-300">
                You ({Math.round(myRating.rating)})
              </span>
            )}
            {isAiDebate ? (
              <>
                {" vs "}
                <span className="text-purple-400 font-medium">
                  AI Opponent
                </span>
              </>
            ) : (
              opponent && (
                <>
                  {" vs "}
                  <span className="text-blue-400 font-medium">
                    {opponent.username} ({Math.round(opponent.rating)})
                  </span>
                </>
              )
            )}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {debate.status === "active" && !voting && !endingDebate && (
            <button
              onClick={handleEndDebate}
              className="bg-red-700 hover:bg-red-600 text-white py-1 px-3 rounded text-sm transition duration-150"
            >
              End Debate
            </button>
          )}
          {endingDebate && (
            <span className="text-purple-400 text-sm flex items-center">
              <div className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mr-1"></div>
              AI judging...
            </span>
          )}
          <button
            onClick={() => router.push("/lobby")}
            className="bg-gray-700 hover:bg-gray-600 text-white py-1 px-3 rounded text-sm transition duration-150"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Video Chat */}
      {debate.is_video && !isAiDebate && debate.status === "active" && !result && (
        <VideoChat debateId={debateId} userId={user.id} onTranscript={handleSend} />
      )}

      {/* Result Banner */}
      {result && (
        <div
          className={`p-4 text-center ${
            result.outcome === "win"
              ? "bg-green-900 text-green-200"
              : result.outcome === "loss"
              ? "bg-red-900 text-red-200"
              : "bg-yellow-900 text-yellow-200"
          }`}
        >
          <p className="font-semibold">
            {result.outcome === "win" && "You won!"}
            {result.outcome === "loss" && "You lost."}
            {result.outcome === "draw" && "It's a draw."}
            {result.is_practice && (
              <span className="ml-2 text-xs font-normal opacity-75">
                (Practice — no rating change)
              </span>
            )}
            {!result.is_practice &&
              result.ratings &&
              result.ratings[user.id] && (
                <span className="ml-2 text-sm font-normal">
                  Rating: {result.ratings[user.id].oldRating} →{" "}
                  {result.ratings[user.id].newRating} (
                  <span
                    className={
                      result.ratings[user.id].change >= 0
                        ? "text-green-300"
                        : "text-red-300"
                    }
                  >
                    {result.ratings[user.id].change >= 0 ? "+" : ""}
                    {result.ratings[user.id].change}
                  </span>
                  )
                </span>
              )}
          </p>
          {result.ai_judgment && (
            <div className="mt-2 text-sm font-normal">
              <span className="text-purple-300 font-medium">AI Judge: </span>
              {result.ai_judgment.reasoning}
              {result.ai_judgment.scores && (
                <span className="ml-2 text-xs opacity-75">
                  (Scores:{" "}
                  {isAiDebate
                    ? `You ${result.ai_judgment.scores.user1 || "?"} vs AI ${
                        result.ai_judgment.scores.user2 || "?"
                      }`
                    : `${result.ai_judgment.scores.user1 || "?"} vs ${
                        result.ai_judgment.scores.user2 || "?"
                      }`}
                  )
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className={`overflow-y-auto p-4 ${isVideoActive ? "" : "flex-1"}`}
        style={isVideoActive ? { maxHeight: "50%" } : {}}
      >
        {messages.map((msg) => (
          <div key={msg.id} className="mb-3">
            <span
              className={`font-bold text-sm ${
                isAiDebate && msg.user_id !== user.id
                  ? "text-purple-400"
                  : "text-blue-400"
              }`}
            >
              {msg.author?.username || "Unknown"}
            </span>
            <p className="text-white">{msg.message}</p>
            {checkingMsgId === msg.id && (
              <div className="mt-1 flex items-center text-xs text-purple-400">
                <div className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mr-1"></div>
                Fact-checking...
              </div>
            )}
            {factChecks[msg.id] && (
              <div className="mt-1 ml-2 p-2 bg-purple-900 bg-opacity-50 border-l-2 border-purple-400 rounded text-sm text-purple-200">
                <span className="font-semibold text-purple-300">
                  AI Fact-Check:{" "}
                </span>
                {factChecks[msg.id]}
              </div>
            )}
          </div>
        ))}
        {aiTyping && (
          <div className="mb-3">
            <span className="font-bold text-purple-400 text-sm">
              AI Opponent
            </span>
            <div className="flex items-center mt-1 text-gray-400">
              <div className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mr-2"></div>
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer: Input / Voting / Judging / Completed */}
      {!voting && !result && !endingDebate && (
        <div className="p-2 border-t border-gray-700">
          <MessageInput onSubmit={handleSend} />
        </div>
      )}

      {endingDebate && (
        <div className="p-4 border-t border-gray-700 text-center">
          <div className="flex items-center justify-center text-purple-400">
            <div className="inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mr-2"></div>
            AI Judge is evaluating the debate...
          </div>
        </div>
      )}

      {voting && !result && (
        <div className="p-4 border-t border-gray-700">
          {myVote ? (
            <p className="text-center text-gray-400">
              Vote submitted. Waiting for opponent...
            </p>
          ) : (
            <div className="text-center">
              <p className="mb-3 font-semibold">Who won this debate?</p>
              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => handleVote("self")}
                  className="bg-green-700 hover:bg-green-600 text-white py-2 px-5 rounded transition duration-150"
                >
                  I won
                </button>
                <button
                  onClick={() => handleVote("opponent")}
                  className="bg-red-700 hover:bg-red-600 text-white py-2 px-5 rounded transition duration-150"
                >
                  Opponent won
                </button>
                <button
                  onClick={() => handleVote("draw")}
                  className="bg-gray-600 hover:bg-gray-500 text-white py-2 px-5 rounded transition duration-150"
                >
                  Draw
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="p-4 border-t border-gray-700 text-center">
          <button
            onClick={() => router.push("/lobby")}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded transition duration-150"
          >
            Back to Lobby
          </button>
        </div>
      )}
    </div>
  );
}
