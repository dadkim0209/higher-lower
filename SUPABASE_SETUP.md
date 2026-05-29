# Higher/Lower Supabase Setup

1. Create a free Supabase project at https://supabase.com.
2. Open the SQL Editor and run `supabase-setup.sql`.
3. In Supabase, go to Project Settings > API.
4. Copy the Project URL and anon public key.
5. Paste them into `supabase-config.js`.

The app will keep working locally if Supabase is not configured. Once configured, every completed run is submitted to the `pitch_results` table and the Global Results panel reads the shared results.

For public hosting, deploy these files to Netlify, Vercel, or GitHub Pages. A custom domain is optional.
