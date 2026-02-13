import { supabase } from "lib/Store";

const Home = () => {
  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signIn({ provider: "google" });
      if (error) {
        alert("Error with auth: " + error.message);
      }
    } catch (error) {
      console.log("error", error);
      alert(error.error_description || error);
    }
  };

  return (
    <div className="main flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 20px' }}>
        <div className="login-card" style={{ padding: 40 }}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text-primary)', margin: 0 }}>
              LOGOS
            </h1>
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14, marginBottom: 32, marginTop: 6 }}>
            The competitive debate platform
          </p>
          <div style={{ height: 1, background: 'var(--border-default)', marginBottom: 28 }} />
          <button
            onClick={handleGoogleLogin}
            className="btn btn-primary btn-md"
            style={{ width: '100%', fontSize: 15 }}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;
