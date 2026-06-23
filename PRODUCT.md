# Product

## Register

product

## Users

Arabic-speaking anime fans on Android phones (primarily), watching subbed/dubbed
anime for free. They arrive to do one of three jobs: (1) resume something they're
mid-binge on, (2) find what's new this week / this season, or (3) search for a
specific title and start watching with the least friction possible. Context is
casual and mobile — couch, bed, commute — often one-handed, often at night in a
dark room. They care about *getting to playback fast* and *not losing their
place*. They tolerate the app being a scraper aggregator as long as it feels
trustworthy and smooth.

## Product Purpose

Pantoufa is a backend-free anime streaming app that aggregates three Arabic
sources (witanime, anime4up, anime3rb) into one clean catalogue with favorites,
cross-source watch history, offline downloads, completion tracking, and new-
episode alerts. Success = the user opens the app and is watching, on their
resume point, within seconds — without thinking about which source a server came
from. The product's job is to make a messy, ad-filled scraping reality feel like
a single premium streaming service.

## Brand Personality

Calm, cinematic, trustworthy. Three words: **premium, focused, effortless.**
The voice is quiet confidence — it shows the content and gets out of the way.
Emotional goal: the hush of a dark cinema right before the film starts, not the
buzz of an arcade. Personality lives in the artwork, the motion, and the
restraint — never in decoration shouting for attention.

## Anti-references

- **The old "Void" maximalism** — neon glow on every card, hot-pink everywhere,
  decorative gradients competing with poster art. Glow and saturation should be
  rare and earned, not the default surface treatment.
- **Ad-heavy piracy-site chrome** — the sources we scrape look cheap and noisy;
  the app must read as the opposite: spacious, premium, ad-free in feel.
- **Generic AI dashboard slop** — identical glowing card grids, gradient text,
  side-stripe accents, tiny tracked uppercase eyebrows over every section.
- **Over-stimulating gamer-RGB aesthetics** — this is a place to wind down and
  watch, not a launcher skin.

## Design Principles

1. **Content is the hero; chrome recedes.** Poster art and video carry the
   color and energy. UI furniture stays near-monochrome so artwork pops against
   it. Quiet the surface so the content gets louder.
2. **Earn every glow.** Accent color and shadow/glow signal *one* thing at a
   time — what's live, what's selected, what to tap next. If everything glows,
   nothing does.
3. **Fast to playback, never lose the place.** Every screen is measured by how
   quickly it gets the user watching or back to their resume point. Resume,
   continue-watching, and Play are the privileged actions.
4. **One service, not three scrapers.** Source plumbing (witanime / anime4up /
   anime3rb, "Direct" vs "Embed") is an implementation detail surfaced only when
   it helps the user choose; it never fragments the experience.
5. **Calm in the dark.** Designed for night viewing: true-dark surfaces, gentle
   contrast steps, motion that eases rather than pops, nothing that strobes or
   shouts at 1am.

## Accessibility & Inclusion

- **WCAG 2.2 AA contrast** is a hard floor: body text ≥4.5:1, large/bold text
  ≥3:1, including text laid over poster artwork (use scrims/gradients to
  guarantee it). Placeholder and muted text held to the same body floor.
- **Reduced motion is required**, not optional. Every reveal/transition has a
  crossfade-or-instant alternative for users who opt out; nothing essential is
  gated behind an animation.
- **Solid RTL Arabic** end to end: correct right-to-left layout on every screen,
  Cairo for all static Arabic chrome (Latin fonts under-measure Arabic and spill
  in tight rows), dynamic/romaji content stays on the Latin stack.
- **≥44px touch targets** and comfortable hit-slop on all controls, especially
  the player and one-handed reach zones.
