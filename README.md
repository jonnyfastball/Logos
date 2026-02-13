# Logos

A competitive debate platform — like chess.com for debates. Built with Next.js, Supabase, and WatermelonDB.

## Features

- Google OAuth authentication
- Real-time matchmaking (random queue or invite links)
- Debate rooms with topic headers and live messaging
- Offline-first architecture with WatermelonDB

## Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the SQL in `full-schema.sql` and `supabase/migrations/001_debates.sql`
3. Enable Google OAuth in Supabase Auth settings
4. Copy `.env.local.example` to `.env.local` and fill in your Supabase URL and anon key
5. `npm install && npm run dev`
