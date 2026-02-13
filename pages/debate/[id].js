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
      <div className="main flex items-center justify-center h-screen w-screen page-bg">
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#fca5a5', marginBottom: 16, fontSize: 15 }}>{error}</p>
          <button onClick={() => router.push("/lobby")} className="btn btn-primary btn-md">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (!debate) {
    return (
      <div className="main flex items-center justify-center h-screen w-screen page-bg">
        <div className="spinner spinner-blue spinner-lg"></div>
      </div>
    );
  }

  const isAiDebate = debate.is_ai_opponent;
  const isVideoActive = debate.is_video && !isAiDebate && debate.status === "active" && !result;

  // Shared pieces
  const resultBanner = result && (
    <div
      className={`animate-fade-in ${
        result.outcome === "win"
          ? "result-win"
          : result.outcome === "loss"
          ? "result-loss"
          : "result-draw"
      }`}
      style={{ padding: '16px 20px', textAlign: 'center', flexShrink: 0 }}
    >
      <p style={{ fontWeight: 700, fontSize: 18, margin: 0, color: result.outcome === 'win' ? '#86efac' : result.outcome === 'loss' ? '#fca5a5' : '#fcd34d' }}>
        {result.outcome === "win" && "You won!"}
        {result.outcome === "loss" && "You lost."}
        {result.outcome === "draw" && "It's a draw."}
        {result.is_practice && (
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, opacity: 0.7 }}>
            (Practice — no rating change)
          </span>
        )}
        {!result.is_practice &&
          result.ratings &&
          result.ratings[user.id] && (
            <span style={{ marginLeft: 10, fontSize: 14, fontWeight: 500 }}>
              {result.ratings[user.id].oldRating} → {result.ratings[user.id].newRating}{" "}
              <span style={{ color: result.ratings[user.id].change >= 0 ? '#86efac' : '#fca5a5' }}>
                ({result.ratings[user.id].change >= 0 ? "+" : ""}
                {result.ratings[user.id].change})
              </span>
            </span>
          )}
      </p>
      {result.ai_judgment && (
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>
          <span style={{ color: '#c4b5fd', fontWeight: 600 }}>AI Judge: </span>
          {result.ai_judgment.reasoning}
          {result.ai_judgment.scores && (
            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>
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
  );

  const messagesArea = (
    <div
      className={isVideoActive ? "debate-chat-col__messages" : "flex-1"}
      style={isVideoActive ? {} : { overflowY: 'auto', padding: '16px 20px' }}
    >
      {messages.map((msg) => {
        const isOwn = msg.user_id === user.id;
        const isAi = isAiDebate && !isOwn;
        return (
          <div key={msg.id} className="message-row">
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: isAi ? '#c4b5fd' : '#79b8ff' }}>
                {msg.author?.username || "Unknown"}
              </span>
            </div>
            <div className={`message-bubble ${isOwn ? 'message-own' : isAi ? 'message-ai' : ''}`}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--text-primary)' }}>
                {msg.message}
              </p>
            </div>
            {checkingMsgId === msg.id && (
              <div className="flex items-center" style={{ marginTop: 6, gap: 6 }}>
                <div className="spinner spinner-purple spinner-sm"></div>
                <span style={{ fontSize: 12, color: '#c4b5fd' }}>Fact-checking...</span>
              </div>
            )}
            {factChecks[msg.id] && (
              <div className="fact-check-box">
                <span style={{ fontWeight: 600, color: '#a78bfa' }}>AI Fact-Check: </span>
                {factChecks[msg.id]}
              </div>
            )}
          </div>
        );
      })}
      {aiTyping && (
        <div className="message-row">
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#c4b5fd' }}>AI Opponent</span>
          </div>
          <div className="flex items-center" style={{ gap: 8, color: 'var(--text-secondary)', fontSize: 14 }}>
            <div className="spinner spinner-purple spinner-sm"></div>
            Thinking...
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );

  const footerStyle = isVideoActive ? {} : { padding: '10px 20px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-secondary)' };
  const footerClass = isVideoActive ? "debate-chat-col__footer" : "";

  const footer = (
    <>
      {!voting && !result && !endingDebate && (
        <div className={footerClass} style={footerStyle}>
          <MessageInput onSubmit={handleSend} />
        </div>
      )}

      {endingDebate && (
        <div className={footerClass} style={{ ...footerStyle, textAlign: 'center' }}>
          <div className="flex items-center justify-center" style={{ gap: 8, color: '#c4b5fd' }}>
            <div className="spinner spinner-purple spinner-sm"></div>
            <span style={{ fontSize: 14 }}>AI Judge is evaluating the debate...</span>
          </div>
        </div>
      )}

      {voting && !result && (
        <div className={footerClass} style={{ ...footerStyle, padding: isVideoActive ? undefined : '18px 20px' }}>
          {myVote ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
              Vote submitted. Waiting for opponent...
            </p>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <p style={{ marginBottom: 14, fontWeight: 600, fontSize: 15 }}>Who won this debate?</p>
              <div className="flex justify-center" style={{ gap: 10 }}>
                <button onClick={() => handleVote("self")} className="btn btn-success btn-md">
                  I won
                </button>
                <button onClick={() => handleVote("opponent")} className="btn btn-danger btn-md">
                  Opponent won
                </button>
                <button onClick={() => handleVote("draw")} className="btn btn-secondary btn-md">
                  Draw
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={footerClass} style={{ ...footerStyle, textAlign: 'center' }}>
          <button onClick={() => router.push("/lobby")} className="btn btn-primary btn-md">
            Back to Lobby
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="main flex flex-col h-screen w-screen page-bg">
      {/* Header */}
      <div className="header-bar" style={{ alignItems: 'flex-start', padding: '14px 20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-tertiary)' }}>
              Debate Topic
            </span>
            {isAiDebate && <span className="badge badge-purple">Practice</span>}
            {debate.is_video && !isAiDebate && <span className="badge badge-blue">Video</span>}
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0, lineHeight: 1.4, color: 'var(--text-primary)' }}>
            {debate.topic}
          </h2>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            {myRating && (
              <span style={{ color: 'var(--text-primary)' }}>
                You ({Math.round(myRating.rating)})
              </span>
            )}
            {isAiDebate ? (
              <>
                {" vs "}
                <span style={{ color: '#c4b5fd', fontWeight: 500 }}>AI Opponent</span>
              </>
            ) : (
              opponent && (
                <>
                  {" vs "}
                  <span style={{ color: '#79b8ff', fontWeight: 500 }}>
                    {opponent.username} ({Math.round(opponent.rating)})
                  </span>
                </>
              )
            )}
          </div>
        </div>
        <div className="flex items-center" style={{ gap: 8, flexShrink: 0, marginLeft: 16 }}>
          {debate.status === "active" && !voting && !endingDebate && (
            <button onClick={handleEndDebate} className="btn btn-danger btn-sm">
              End Debate
            </button>
          )}
          {endingDebate && (
            <span className="flex items-center" style={{ color: '#c4b5fd', fontSize: 13 }}>
              <div className="spinner spinner-purple spinner-sm" style={{ marginRight: 6 }}></div>
              AI judging...
            </span>
          )}
          <button onClick={() => router.push("/lobby")} className="btn btn-ghost btn-sm">
            Leave
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={`debate-body ${isVideoActive ? 'debate-body--video-active' : ''}`}>

        {/* Left column: Video (only when active) */}
        {isVideoActive && (
          <div className="debate-video-col">
            <VideoChat debateId={debateId} userId={user.id} onTranscript={handleSend} />
          </div>
        )}

        {/* Right column (or full-width when no video): Chat */}
        <div
          className={isVideoActive ? 'debate-chat-col' : ''}
          style={isVideoActive ? {} : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          {resultBanner}
          {messagesArea}
          {footer}
        </div>

      </div>
    </div>
  );
}
