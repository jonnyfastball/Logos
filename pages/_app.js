import "~/styles/style.scss";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import UserContext from "lib/UserContext";
import { supabase } from "lib/Store";

export default function LogosApp({ Component, pageProps }) {
  const [userLoaded, setUserLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const session = supabase.auth.session();
    const currentUser = session?.user ?? null;
    if (currentUser) {
      setUser(currentUser);
      setUserLoaded(true);
      if (router.pathname === "/") {
        router.push("/lobby");
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const currentUser = session?.user ?? null;
        if (currentUser) {
          await ensureUser(currentUser);
          setUser(currentUser);
          setUserLoaded(true);
          if (router.pathname === "/") {
            router.push("/lobby");
          }
        } else {
          setUser(null);
          setUserLoaded(false);
        }
      }
    );

    return () => {
      authListener.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <UserContext.Provider value={{ userLoaded, user, signOut }}>
      <Component {...pageProps} />
    </UserContext.Provider>
  );
}

async function ensureUser(authUser) {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("id", authUser.id);

  if (!existing || existing.length === 0) {
    await supabase.from("users").insert([
      {
        id: authUser.id,
        username:
          authUser.email || authUser.user_metadata?.full_name || "User",
      },
    ]);
  }
}
