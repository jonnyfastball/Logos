import { useState, useEffect, useContext } from "react";
import { useRouter } from "next/router";
import UserContext from "lib/UserContext";
import { supabase } from "lib/Store";

export default function InvitePage() {
  const { user } = useContext(UserContext);
  const router = useRouter();
  const { code } = router.query;
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code || !user) return;
    joinDebate();
  }, [code, user]);

  async function joinDebate() {
    try {
      const { data: debate, error: fetchError } = await supabase
        .from("debates")
        .select("*")
        .eq("invite_code", code)
        .single();

      if (fetchError || !debate) {
        setStatus("error");
        setError("Invite link not found or has expired.");
        return;
      }

      if (debate.status !== "waiting") {
        setStatus("error");
        setError("This debate has already started or was cancelled.");
        return;
      }

      if (debate.user1_id === user.id) {
        setStatus("error");
        setError("You cannot join your own debate.");
        return;
      }

      // Create a channel for this debate
      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .insert([
          {
            slug: "debate-" + debate.id.substring(0, 8),
            created_by: user.id,
            inserted_at: new Date().toISOString(),
            debate_id: debate.id,
          },
        ])
        .single();

      if (channelError) throw channelError;

      // Activate the debate
      const { error: updateError } = await supabase
        .from("debates")
        .update({
          status: "active",
          user2_id: user.id,
          channel_id: channel.id,
          started_at: new Date().toISOString(),
        })
        .eq("id", debate.id);

      if (updateError) throw updateError;

      router.push(`/debate/${debate.id}`);
    } catch (err) {
      console.error("Join debate error:", err);
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  if (!user) {
    return (
      <div className="main flex items-center justify-center h-screen w-screen page-bg">
        <div className="card" style={{ padding: '36px 40px', textAlign: 'center', maxWidth: 400 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Debate Invitation</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 14 }}>
            You need to sign in to join this debate.
          </p>
          <button onClick={() => router.push("/")} className="btn btn-primary btn-md">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="main flex items-center justify-center h-screen w-screen page-bg">
        <div className="card" style={{ padding: '36px 40px', textAlign: 'center', maxWidth: 400 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Oops</h2>
          <p style={{ color: '#fca5a5', marginBottom: 20, fontSize: 14 }}>{error}</p>
          <button onClick={() => router.push("/lobby")} className="btn btn-primary btn-md">
            Go to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="main flex items-center justify-center h-screen w-screen page-bg">
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 16 }}>
          <div className="spinner spinner-blue spinner-lg"></div>
        </div>
        <p style={{ fontSize: 16, fontWeight: 500 }}>Joining debate...</p>
      </div>
    </div>
  );
}
