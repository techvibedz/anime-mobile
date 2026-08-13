# Related Tab Loading Design

The anime detail page always renders the Related tab after its primary data loads. While AniList relations are unresolved, opening the tab shows the existing loading indicator and Arabic loading label. Once resolved, the same area shows related cards or the existing empty state.

The existing background request and week-long cache remain unchanged. This avoids duplicate traffic and preserves relation-match accuracy while removing the perceived wait caused by hiding the tab.

Verification covers immediate tab visibility, loading-state rendering, TypeScript, and the existing test suite. The finished JavaScript-only change is published to the existing preview OTA branch.
