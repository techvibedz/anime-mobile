# Related Tab Loading Implementation Plan

> **For agentic workers:** Execute inline; the user explicitly prohibited subagents.

**Goal:** Show the Related tab immediately and display progress while related anime load.

**Architecture:** Track whether the relation request has settled independently from its result array. Always include the tab, pass loading state to its existing content component, and keep the current cached relation fetch unchanged.

**Tech Stack:** Expo, React Native, TypeScript, Node assertions, EAS Update

---

### Task 1: Lock the UI contract

**Files:**
- Create: `scripts/check-related-tab-loading.js`
- Modify: `package.json`

- [ ] Assert that the Related tab is unconditional and `RelatedTab` receives loading state.
- [ ] Run `node scripts/check-related-tab-loading.js` and confirm it fails before implementation.

### Task 2: Render loading state

**Files:**
- Modify: `app/anime/[id].tsx`

- [ ] Add relation-loading state that settles for success or failure.
- [ ] Always render the Related tab.
- [ ] Show the existing activity indicator and `t.loading` while unresolved.
- [ ] Run the contract check and confirm it passes.

### Task 3: Verify and publish

- [ ] Run `npm test`.
- [ ] Publish with `BRANCHES=preview bash scripts/publish-ota.sh "fix: show related tab while loading"`.
