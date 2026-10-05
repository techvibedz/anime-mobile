# Manga redesign — Ink & Paper

The manga hub, search, filters, library, series details, chapter index, reader,
reader settings, chapter selector, page jump, loading, error and empty states
now use a manga-specific visual system. The manga tab's navigation also follows
this style while it is selected.

## Visual system

`lib/manga/design.ts` owns the palette and typography independently of the anime
theme: warm ivory paper, near-black ink, vermilion actions, forest-green reading
progress, crisp borders and small corner radii. The reader uses a dark ink canvas
with warm text; its sheets use the paper palette. Existing bundled Cairo and
DM Sans fonts are reused; no new runtime dependencies or authored images.

`components/MangaUI.tsx` provides manga cover tiles, artwork fallbacks, explicit
layout choices, skeletons and recovery states. Covers retain their book shape;
text sits outside the cover. Arabic shelves and grids start on the right.

## Layout and interaction fixes

- Full-width search input with a separate navigation/filter toolbar.
- Scrollable filter and settings sheets with fixed, reachable actions.
- Resume cards with independent removal buttons rather than nested buttons.
- Saved titles have grid/list layouts, search and an in-progress filter.
- Details use a cover-first header, wrapping metadata, reading statistics and
  a numbered chapter index. The reading action's measured height reserves list
  space so the last chapter remains reachable with larger text.
- Reader controls use consistent touch targets and a quieter solid toolbar.
  Chapter search, selected/read states, explicit sheet close buttons and the
  page slider have been restyled. The direction choice appears in horizontal
  paged mode, where it applies.
- Failed covers show the story's title; recycled covers recover for new items.
  Page retry, safe image decoding, saved-position restoration, pinch/pan,
  all three reading modes and cross-source chapter navigation are retained.

## Validation

### Android panels and chapter rows missing

The user's Expo Go screenshots showed unstyled chapter buttons stacked vertically,
white text on paper where a dark/colored button should be, and a featured panel
with its cover outside the intended layout. These are lost container styles, not
font metrics. The earlier font fix did not resolve this main rendering defect.

The app's Babel config used NativeWind's JSX runtime for every component. The
installed `react-native-css-interop` native wrapper collects a `Pressable` style
callback as an inline rule, then spreads the function into an empty object in
`applyRules`. The callback never reaches React Native. Static child text styles
survive, explaining the white text with no background. The browser fixture used
the default React JSX runtime and therefore concealed this native-only bug.

Babel now defaults to Expo's standard React JSX runtime. `CatalogCard.tsx`, the
only app component using `className`, explicitly opts into NativeWind with a JSX
pragma; Metro's NativeWind CSS support is retained. This fixes inline Pressable
callbacks at the shared compiler entry point without rewriting individual buttons.

`node scripts/check-native-pressable.cjs` reproduces the empty-style behavior with
the installed native wrapper, compiles real components with the app's Android
Babel config in development and release modes, and checks chapter/card layouts, backgrounds, selected states and
pressed opacity. It failed on the original configuration and passes after the
fix. It also verifies the class-based catalog card keeps NativeWind's JSX runtime.

The cleared-cache Android export passed to ignored
`.expo/manga-native-style-validation`. The project's Expo Go Metro server on
port 8081 was restarted with `npx expo start --go --clear --port 8081` to apply
the compiler change; the phone needs to reload/reconnect to that server. This
does not publish an OTA or install a new app.

### Expo Go font mismatch

The browser fixture explicitly loaded Cairo and DM Sans with `useFonts`, but the
app root assumed the fonts were embedded by the `expo-font` config plugin and
hid the splash immediately. Expo Go does not embed this project's plugin assets;
custom font aliases were therefore unavailable in that runtime. This was a
confirmed startup defect affecting font metrics, separate from the lost
Pressable styles above, and the fixture concealed it.

The app root now registers all existing local font aliases with `useFonts` and
waits before mounting screens and hiding the splash. Already embedded fonts are
reused by Expo Font. A loading error is logged and releases the splash rather
than trapping startup. `node scripts/check-app-fonts.cjs` exercises pending,
ready and error startup states and checks every local asset/alias.

The Android Metro export after this fix passed to ignored
`.expo/manga-font-validation` and includes all 12 local font assets. No native
rebuild or published update was needed for the source fix.

The browser fixture still uses sample data and fixed safe-area insets. It is a
layout preview, not evidence of identical native rendering. No device was
available to verify the user's Expo Go screen directly.

- Full `npm test`: passed.
- Final TypeScript and manga reader/recovery checks: passed, including a runnable
  failed-cover/recycled-cover check in `scripts/check-manga-recovery.cjs`.
- Android Metro export: passed to ignored `.expo/manga-redesign-validation`.
- Local React Native Web preview of the actual screen components: reviewed at
  390 x 844 and 320 x 640. Checked search/filter selection, comfortable/list
  layouts, library filtering/empty results, chapter rows/search and reader sheets.
  The ignored `.expo/manga-preview` harness supplies sample catalog/progress data;
  reader preview artwork is sample covers and provider headers are omitted for
  browser preview only. Production data fetching and image headers are unchanged.
- No connected Android device or configured AVD was available. Native gestures,
  Android keyboard behavior, OS text scaling and real-device image performance
  still need device verification; web screenshots do not establish those checks.

No Impeccable skill was used. No global design-system file, app version or release
configuration was changed. No OTA update, publication, APK install or app update
was performed.
