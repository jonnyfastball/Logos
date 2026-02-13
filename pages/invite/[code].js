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
      <div className="main flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Debate Invitation</h2>
          <p className="text-gray-400 mb-4">
            You need to sign in to join this debate.
          </p>
          <button
            onClick={() => router.push("/")}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded transition duration-150"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="main flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Oops</h2>
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/lobby")}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded transition duration-150"
          >
            Go to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="main flex items-center justify-center h-screen w-screen bg-gray-900 text-gray-100">
      <div className="text-center">
        <div className="mb-4">
          <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p className="text-lg">Joining debate...</p>
      </div>
    </div>
  );
}
