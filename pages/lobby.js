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
  const [mode, setMode] = useState("text");
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
    <div className="main flex flex-col h-screen w-screen bg-gray-900 text-gray-100">
      <header className="flex items-center justify-between p-4 border-b border-gray-700">
        <h1 className="text-2xl font-bold">Logos</h1>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          <button
            onClick={signOut}
            className="bg-gray-700 hover:bg-gray-600 text-white py-1 px-3 rounded text-sm transition duration-150"
          >
            Log out
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {myRating && (
          <div className="mb-6 text-center">
            <span className="text-5xl font-bold">{Math.round(myRating.rating)}</span>
            {myRating.rating_deviation > 200 && (
              <span className="ml-2 text-sm text-gray-400">Provisional</span>
            )}
            <p className="text-gray-400 text-sm mt-1">
              {myRating.total_debates} debates — {myRating.wins}W / {myRating.losses}L
            </p>
          </div>
        )}

        <h2 className="text-4xl font-bold mb-2">Ready to Debate?</h2>
        <p className="text-gray-400 mb-8">
          Challenge someone to a battle of ideas
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900 text-red-200 rounded">
            {error}
          </div>
        )}

        {startingAi && (
          <div className="text-center mb-8">
            <div className="mb-4">
              <div className="inline-block w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-lg mb-2">Setting up AI debate...</p>
            <p className="text-gray-400 text-sm">
              Generating opening argument
            </p>
          </div>
        )}

        {!startingAi && searching && !inviteLink && (
          <div className="text-center mb-8">
            <div className="mb-4">
              <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-lg mb-2">Finding an opponent...</p>
            <p className="text-gray-400 text-sm mb-4">
              Waiting for someone to join
            </p>
            {showAiFallback && (
              <button
                onClick={handleDebateAI}
                className="bg-purple-600 hover:bg-purple-500 text-white py-2 px-6 rounded transition duration-150 mb-3"
              >
                Debate AI Instead
              </button>
            )}
            <div>
              <button
                onClick={handleCancelSearch}
                className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-6 rounded transition duration-150"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {inviteLink && (
          <div className="text-center mb-8 max-w-md">
            <p className="text-lg mb-3">Share this link with your opponent:</p>
            <div className="flex items-center bg-gray-800 rounded p-2 mb-3">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="flex-1 bg-transparent text-gray-200 text-sm outline-none mr-2"
              />
              <button
                onClick={copyInviteLink}
                className="bg-blue-600 hover:bg-blue-500 text-white py-1 px-3 rounded text-sm transition duration-150"
              >
                Copy
              </button>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Waiting for opponent to join...
            </p>
            <button
              onClick={() => {
                handleCancelSearch();
                setInviteLink(null);
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-6 rounded transition duration-150"
            >
              Cancel
            </button>
          </div>
        )}

        {!searching && !startingAi && !inviteLink && (
          <>
            <div className="mb-6 flex items-center space-x-4">
              <select
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                className="bg-gray-800 text-gray-100 border border-gray-600 rounded py-2 px-4 text-sm cursor-pointer outline-none"
              >
                <option value="random">Random Topic</option>
                {TOPICS.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>

              <div className="flex bg-gray-800 rounded border border-gray-600 overflow-hidden">
                <button
                  onClick={() => setMode("text")}
                  className={`py-2 px-4 text-sm transition duration-150 ${
                    mode === "text"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  Text
                </button>
                <button
                  onClick={() => setMode("video")}
                  className={`py-2 px-4 text-sm transition duration-150 ${
                    mode === "video"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  Video
                </button>
              </div>
            </div>

            <div className="flex space-x-4 mb-8">
              <button
                onClick={handleDebateNow}
                className="bg-blue-600 hover:bg-blue-500 text-white py-3 px-8 rounded-lg text-lg font-semibold transition duration-150"
              >
                Debate Now
              </button>
              <button
                onClick={handleInvite}
                className="bg-gray-700 hover:bg-gray-600 text-white py-3 px-8 rounded-lg text-lg font-semibold transition duration-150"
              >
                Invite to Debate
              </button>
              <button
                onClick={handleDebateAI}
                className="bg-purple-600 hover:bg-purple-500 text-white py-3 px-8 rounded-lg text-lg font-semibold transition duration-150"
              >
                Debate AI
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
