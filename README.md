# Creonnect Outreach Logger

## Run locally

1. Create a Google service account and enable the Google Sheets API.
2. Share the `Creators` and `Brands` tabs with the service account email as Editor.
3. Copy `.env.example` to `.env` and set `GOOGLE_SHEET_ID` plus the service account JSON. These values stay server-side and are never prefixed with `VITE_`.
4. Run `pnpm install`, then `pnpm dev`.
5. Open `http://127.0.0.1:5173` and create an account.

Supabase authentication is configured in `.env.local` with the publishable key. The Vite client uses `VITE_SUPABASE_*`; the private API uses `SUPABASE_*` (the public publishable key is also safe server-side). The app uses Supabase Auth for login, signup, password-reset email, and refreshed browser sessions.

Run [supabase/schema.sql](supabase/schema.sql) once in the Supabase SQL editor and set `SUPABASE_SERVICE_ROLE_KEY` only in the server `.env`. Each accepted entry is then written to both Supabase and the configured Google Sheet.

`pnpm dev` starts both the Vite client and the private API server. The API requires an authenticated HttpOnly session cookie. Settings, users, and synced entries are persisted under `server/data/` and that directory is ignored by git.

Creator submissions require Creator Name and Instagram ID. Brand submissions use the Brand fields. Country selection stores country name, flag, and dial code in the form and writes the combined phone value to Sheets.

For production, use HTTPS, a real database and a secrets manager instead of the local JSON store, set a secure cookie, and put the API behind the same origin or a strict CORS allowlist.
