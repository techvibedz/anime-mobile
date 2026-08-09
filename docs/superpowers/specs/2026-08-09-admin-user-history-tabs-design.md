# Admin User History Tabs Design

## Goal

Separate daily app usage and watch history in the admin user profile, repair missing history posters where stored data permits, and make each history entry searchable.

## Scope

- Keep the user profile header, summary cards, and chat action visible above the tab content.
- Add two underline tabs: Spend Time and Watch History.
- Open Spend Time by default on every screen visit. Do not persist tab selection.
- Show the daily usage list only in Spend Time.
- Show the full newest-first episode history only in Watch History.
- Make each history row open the existing search screen with its anime title as the `q` parameter.
- Preserve current loading, error, empty, retry, and pull-to-refresh behavior.
- Publish the verified change to the existing Android preview channel on runtime `3.3.1`.

## UI Behavior

The tabs reuse the editorial underline treatment already used by the anime detail screen. The active tab uses the accent color and underline; the inactive tab remains muted. The screen always initializes with Spend Time selected.

History rows remain compact poster-and-progress cards. The complete row is pressable and navigates to `/(tabs)/search?q=<encoded anime title>`. The existing search screen receives the title and performs the search automatically.

## Poster Recovery

The admin history RPC returns the row's stored image when present. When it is empty, it reuses the newest non-empty image stored for the same normalized anime title in watch history. This repairs older incomplete rows without initiating slow WebView scrapes.

The client renders the selected image through the existing `posterUrl()` helper. If the optimized image request fails, it retries the original stored URL. If no usable URL remains, it shows the existing film placeholder.

## Data Flow

`UserDetailScreen` continues loading daily usage and history together so summary counts and pull-to-refresh remain accurate. Tab selection controls rendering only; it does not trigger duplicate network calls. The admin-only RPC continues enforcing authorization in Supabase.

## Error Handling

- Daily usage keeps its current loading and empty states.
- History keeps its current loading, empty, error, and retry states.
- Image failures degrade to the original URL and then a local placeholder without failing the history list.
- Search navigation is disabled only when an entry has no anime title.

## Verification

- Add a pure test for selecting a stored image versus a recovered fallback image.
- Verify Spend Time is the initial tab and each tab renders only its own list through TypeScript and focused source checks.
- Run the complete `npm test` command.
- Publish with `eas update --branch preview --platform android` and confirm runtime `3.3.1` on the preview channel.

## Out Of Scope

- Remembering the selected tab.
- Scraping posters when the tab opens.
- Opening anime details directly from history.
- Changing watch-history collection or playback behavior.
