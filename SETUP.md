# Pantoufa — Production Setup

This app uses **Supabase** for authentication (email + Google) and cloud sync (favorites, watch history). Until Supabase is configured the app runs in **anonymous mode**: data is stored locally only, no login required.

## 1. Create a Supabase project

1. Go to [app.supabase.com](https://app.supabase.com) → New project
2. Pick a name + database password, click Create

## 2. Apply the schema

In your project dashboard:

- Open **SQL Editor**
- Paste the contents of [`supabase/schema.sql`](./supabase/schema.sql)
- Click Run

This creates two tables (`favorites`, `watch_history`) with Row-Level Security policies so users only see their own data.

## 3. Configure environment variables

Copy `.env.example` to `.env` in the project root:

```sh
cp .env.example .env
```

Edit `.env` and paste your values from **Project Settings → API**:

```
EXPO_PUBLIC_SUPABASE_URL=https://abcdefghij.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Restart Metro after changing env vars: `npx expo start -c`

## 4. Enable Google OAuth (optional but recommended)

1. In your Supabase dashboard: **Authentication → Providers → Google**
2. Toggle Google on
3. Follow Supabase's link to the **Google Cloud Console** to create OAuth credentials:
   - Application type: Web application
   - Authorized redirect URIs: copy the one Supabase shows (looks like `https://abcdefghij.supabase.co/auth/v1/callback`)
4. Paste the Client ID + Client Secret back into Supabase
5. Save

On the mobile side, Google sign-in opens an in-app browser via `expo-web-browser` and returns to the app via the `anime-mobile://auth-callback` deep link (already configured via `scheme` in `app.json`).

## 5. Email settings (optional)

For email/password auth:

- **Authentication → Settings → Email Auth** is enabled by default
- For development you can disable email confirmation under **Authentication → Settings → User Signups → Confirm email** so new accounts work immediately

## 6. Run the app

```sh
npx expo start
```

Press `a` for Android, `i` for iOS, or scan the QR with Expo Go.

## 7. Build for production

EAS Build (recommended):

```sh
npm install -g eas-cli
eas login
eas build --platform android
eas build --platform ios
```

Make sure your `.env` is set, or pass the values as `--build-secret` for production builds. EAS will not bundle local `.env` files unless you add an `eas.json` configuration to expose them.

## Notes on offline mode

The app works without Supabase configured:
- Favorites and watch history are stored in `AsyncStorage` only (per-device)
- The login/welcome screens are skipped — user goes straight to the home tab
- A yellow banner appears on the auth screens if env vars are missing

To force a re-login locally, sign out from the My List screen or clear the app's storage.
