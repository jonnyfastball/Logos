import { useState, useEffect, useContext, useRef } from "react";
import { useRouter } from "next/router";
import UserContext from "lib/UserContext";
import { supabase } from "lib/Store";
import TOPICS, { pickRandomTopic } from "lib/topics";

export default function Lobby() {
  const { user, signOut } = useContext(UserContext);
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [startingAi, setStartingAi] = useState(false);
  const [inviteLink, setInviteLink] = useState(null);
  const [error, setError] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState("random");
  const [mode, setMode] = useState("video");
  const [myRating, setMyRating] = useState(null);
  const [showAiFallback, setShowAiFallback] = useState(false);
  const waitingDebateIdRef = useRef(null);
  const aiTimeoutRef = useRef(null);

  useEffect(() => {
    if (!user) {
      router.push("/");
      return;
    }

    // Fetch rating
    supabase
      .from("users")
      .select("rating, rating_deviation, total_debates, wins, losses")
      .eq("id", user.id)
      .single()
      .then(({ data }) => { if (data) setMyRating(data); });

    const subscription = supabase
      .from(`debates:user1_id=eq.${user.id}`)
      .on("UPDATE", (payload) => {
        const debate = payload.new;
        if (debate.status === "active" && debate.channel_id) {
          clearAiTimeout();
          setShowAiFallback(false);
          waitingDebateIdRef.current = null;
          setSearching(false);
          router.push(`/debate/${debate.id}`);
        }
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, [user]);

  // Cancel waiting debate + clear timeout on unmount
  useEffect(() => {
    return () => {
      clearAiTimeout();
      if (waitingDebateIdRef.current) {
        supabase
          .from("debates")
          .update({ status: "cancelled" })
          .eq("id", waitingDebateIdRef.current)
          .eq("status", "waiting")
          .then();
      }
    };
  }, []);

  function clearAiTimeout() {
    if (aiTimeoutRef.current) {
      clearTimeout(aiTimeoutRef.current);
      aiTimeoutRef.current = null;
    }
  }

  function getSelectedTopic() {
    return selectedTopic === "random" ? pickRandomTopic() : selectedTopic;
  }

  async function handleDebateNow() {
    if (!user) return;
    setError(null);
    setSearching(true);
    setShowAiFallback(false);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "join_random_debate",
        { p_user_id: user.id, p_is_video: mode === "video" }
      );

      if (rpcError) throw rpcError;

      if (data) {
        router.push(`/debate/${data.debate_id}`);
        return;
      }

      // No one waiting — create a new waiting debate
      const topic = getSelectedTopic();
      const { data: newDebate, error: insertError } = await supabase
        .from("debates")
        .insert([{ topic, status: "waiting", user1_id: user.id, is_video: mode === "video" }])
        .single();

      if (insertError) throw insertError;
      waitingDebateIdRef.current = newDebate.id;

      // Start 15s timer for AI fallback
      aiTimeoutRef.current = setTimeout(() => {
        setShowAiFallback(true);
      }, 15000);
    } catch (err) {
      console.error("Matchmaking error:", err);
      setError("Something went wrong. Please try again.");
      setSearching(false);
    }
  }

  async function handleCancelSearch() {
    if (waitingDebateIdRef.current) {
      await supabase
        .from("debates")
        .update({ status: "cancelled" })
        .eq("id", waitingDebateIdRef.current)
        .eq("status", "waiting");
    }
    waitingDebateIdRef.current = null;
    clearAiTimeout();
    setShowAiFallback(false);
    setSearching(false);
  }

  async function handleDebateAI() {
    if (!user) return;
    setError(null);

    // Cancel any waiting human debate
    if (waitingDebateIdRef.current) {
      await supabase
        .from("debates")
        .update({ status: "cancelled" })
        .eq("id", waitingDebateIdRef.current)
        .eq("status", "waiting");
      waitingDebateIdRef.current = null;
    }
    clearAiTimeout();
    setShowAiFallback(false);
    setSearching(false);
    setStartingAi(true);

    try {
      const topic = getSelectedTopic();
      const res = await fetch("/api/start-ai-debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, topic }),
      });
      const data = await res.json();
      if (data.debate_id) {
        router.push(`/debate/${data.debate_id}`);
      } else {
        throw new Error(data.error || "Failed to start AI debate");
      }
    } catch (err) {
      console.error("AI debate error:", err);
      setError("Could not start AI debate. Please try again.");
      setStartingAi(false);
    }
  }

  async function handleInvite() {
    if (!user) return;
    setError(null);

    try {
      const topic = getSelectedTopic();
      const inviteCode = Math.random().toString(36).substring(2, 10);
      const { data, error: insertError } = await supabase
        .from("debates")
        .insert([
          {
            topic,
            status: "waiting",
            user1_id: user.id,
            invite_code: inviteCode,
            is_video: mode === "video",
          },
        ])
        .single();

      if (insertError) throw insertError;
      setInviteLink(`${window.location.origin}/invite/${inviteCode}`);
      waitingDebateIdRef.current = data.id;
    } catch (err) {
      console.error("Invite error:", err);
      setError("Could not create invite. Please try again.");
    }
  }

  function copyInviteLink() {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
    }
  }

  if (!user) return null;

  return (
    <div className="main flex flex-col h-screen w-screen page-bg">
      {/* Header */}
      <header className="header-bar">
        <h1 onClick={() => router.push('/lobby')} style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.3px', margin: 0, cursor: 'pointer' }}>LOGOS</h1>
        <div className="flex items-center" style={{ gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{user.email}</span>
          <button onClick={signOut} className="btn btn-ghost btn-sm">
            Log out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center" style={{ padding: '32px 20px', overflow: 'auto' }}>

        {/* Rating Card */}
        {myRating && (
          <div className="rating-card" style={{ marginBottom: 32, minWidth: 220 }}>
            <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
              {Math.round(myRating.rating)}
            </div>
            {myRating.rating_deviation > 200 && (
              <span className="badge badge-yellow" style={{ marginTop: 8, display: 'inline-flex' }}>
                Provisional
              </span>
            )}
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
              {myRating.total_debates} debate{myRating.total_debates !== 1 ? 's' : ''}
              <span style={{ margin: '0 8px', color: 'var(--border-default)' }}>&middot;</span>
              <span style={{ color: '#86efac' }}>{myRating.wins}W</span>
              {' / '}
              <span style={{ color: '#fca5a5' }}>{myRating.losses}L</span>
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 32, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.5px' }}>
          Ready to Debate?
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: 15 }}>
          Challenge someone to a battle of ideas
        </p>

        {/* Error */}
        {error && (
          <div className="card animate-fade-in" style={{ padding: '12px 18px', marginBottom: 20, background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.25)' }}>
            <span style={{ color: '#fca5a5', fontSize: 14 }}>{error}</span>
          </div>
        )}

        {/* Starting AI Debate */}
        {startingAi && (
          <div className="card animate-fade-in" style={{ padding: '32px 40px', marginBottom: 32, textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}>
              <div className="spinner spinner-purple spinner-lg"></div>
            </div>
            <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Setting up AI debate...</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Generating opening argument</p>
          </div>
        )}

        {/* Searching for Opponent */}
        {!startingAi && searching && !inviteLink && (
          <div className="card animate-fade-in" style={{ padding: '32px 40px', marginBottom: 32, textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}>
              <div className="spinner spinner-blue spinner-lg"></div>
            </div>
            <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Finding an opponent...</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
              Waiting for someone to join
            </p>
            {showAiFallback && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={handleDebateAI} className="btn btn-purple btn-md">
                  Debate AI Instead
                </button>
              </div>
            )}
            <button onClick={handleCancelSearch} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        )}

        {/* Invite Link */}
        {inviteLink && (
          <div className="card animate-fade-in" style={{ padding: '28px 32px', marginBottom: 32, textAlign: 'center', maxWidth: 440, width: '100%' }}>
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Share this link with your opponent</p>
            <div className="invite-box" style={{ marginBottom: 14 }}>
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="input-dark"
                style={{ border: 'none', padding: '6px 0', background: 'transparent', flex: 1, fontSize: 13, marginRight: 10 }}
              />
              <button onClick={copyInviteLink} className="btn btn-primary btn-sm">
                Copy
              </button>
            </div>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 16 }}>
              Waiting for opponent to join...
            </p>
            <button
              onClick={() => { handleCancelSearch(); setInviteLink(null); }}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Controls */}
        {!searching && !startingAi && !inviteLink && (
          <>
            {/* Topic + Mode Row */}
            <div className="flex items-center" style={{ gap: 14, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
              <select
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                className="select-dark"
              >
                <option value="random">Random Topic</option>
                {TOPICS.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>

              <div className="toggle-group">
                <button
                  onClick={() => setMode("text")}
                  className={`toggle-btn ${mode === "text" ? "active" : ""}`}
                >
                  Text
                </button>
                <button
                  onClick={() => setMode("video")}
                  className={`toggle-btn ${mode === "video" ? "active" : ""}`}
                >
                  Video
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center" style={{ gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={handleDebateNow} className="btn btn-primary btn-lg">
                Debate Now
              </button>
              <button onClick={handleInvite} className="btn btn-secondary btn-lg">
                Invite to Debate
              </button>
              <button onClick={handleDebateAI} className="btn btn-purple btn-lg">
                Debate AI
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
