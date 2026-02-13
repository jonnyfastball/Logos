// Quick script to seed a waiting video debate for testing
// Usage: node scripts/seed-video-debate.js

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

// Load .env.local manually
const envFile = fs.readFileSync(".env.local", "utf8");
envFile.split("\n").forEach((line) => {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function seed() {
  const testEmail = "testbot@logos-debug.local";
  let testUserId;

  // Use the GoTrue admin REST API directly (supabase-js v1 doesn't expose admin helpers)
  // List users to find existing test user
  const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
  const listData = await listRes.json();
  const existing = listData.users?.find((u) => u.email === testEmail);

  if (existing) {
    testUserId = existing.id;
    console.log("Found existing test user:", testUserId);
  } else {
    // Create test user
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: testEmail,
        password: "testpassword123",
        email_confirm: true,
        user_metadata: { username: "TestOpponent" },
      }),
    });
    const newUser = await createRes.json();

    if (!newUser.id) {
      console.error("Failed to create test user:", newUser);
      process.exit(1);
    }
    testUserId = newUser.id;
    console.log("Created test user:", testUserId);

    // Ensure they have a username in the users table
    await supabase
      .from("users")
      .upsert({ id: testUserId, username: "TestOpponent" });
  }

  // Insert a waiting video debate
  const { data: debate, error: debateErr } = await supabase
    .from("debates")
    .insert([
      {
        topic: "Technology improves quality of life",
        status: "waiting",
        user1_id: testUserId,
        is_video: true,
      },
    ])
    .single();

  if (debateErr) {
    console.error("Failed to create debate:", debateErr);
    process.exit(1);
  }

  console.log("Created waiting video debate:", debate.id);
  console.log(
    '\nNow go to the lobby, select "Video", and click "Debate Now" to match against it.'
  );
}

seed().catch(console.error);
