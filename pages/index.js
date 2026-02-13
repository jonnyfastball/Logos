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
    <div className="w-full h-full flex justify-center items-center p-4 bg-gray-300">
      <div className="w-full sm:w-1/2 xl:w-1/3">
        <div className="border-teal p-8 border-t-12 bg-white mb-6 rounded-lg shadow-lg bg-white">
          <h2 className="text-2xl font-bold text-center mb-2 text-grey-darker">
            Welcome to Logos
          </h2>
          <p className="text-center text-gray-500 mb-6 text-sm">
            The competitive debate platform
          </p>
          <button
            onClick={handleGoogleLogin}
            className="bg-indigo-700 hover:bg-indigo-600 text-white py-2 px-4 rounded w-full text-center transition duration-150 cursor-pointer"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;
