# Remove WitAnime c.you Mirror

## Goal

Stop using the incomplete `witanime.cyou` mirror without removing the established
`witanime.you` and `witanime.life` sources.

## Design

- Remove `witanime.cyou` from the shared WitAnime candidate list.
- Update the source-domain test to expect only the two retained hosts.
- Preserve the WebView top-level error handling added in the same recent commit.
- Let existing preference validation ignore any stored `witanime.cyou` preference.

## Verification And Delivery

- Run the focused source-domain test.
- Run the full project test command.
- Confirm the diff is OTA-safe TypeScript and test-only work.
- Publish through the existing OTA script with `BRANCHES=preview`, targeting the
  current runtime and discovered Android runtimes, including app version `3.3.1`.
