# Pantoufa Arabic Ad Implementation Plan

**Goal:** Deliver a complete Arabic-narrated motion-graphics advertisement as
portrait and landscape MP4s, with reproducible editable source.

**Architecture:** A self-contained `marketing/pantoufa-ad` Remotion project reads
one scene manifest. A media preparation pipeline derives local branded assets,
generates scene narration, measures it with ffprobe, and produces the timing,
captions, QR code, and original score. No network assets are used while rendering.

**Tech stack:** React, Remotion, Cairo/Outfit, Edge neural TTS, FFmpeg, Node.

## Execution

- [x] Create the isolated video package, scene manifest, and local asset pipeline.
- [x] Generate narration with `ar-SA-HamedNeural`; measure each scene and build
      the complete timeline and SRT file from actual audio duration.
- [x] Create source-derived app screen illustrations and seven animated scenes.
- [x] Run the video package type check and media/timing verification.
- [x] Render representative stills and inspect a contact sheet for each format.
- [x] Render `PantoufaPortrait` and `PantoufaLandscape` with H.264/AAC into Downloads.
- [x] Decode the finished files, inspect their frame/audio metadata and loudness,
      and stage the MP4s, thumbnail, captions, and script in the deliverables folder.

## Verified delivery

- `bun run typecheck`: passed.
- `bun run verify`: passed; 7 scenes, 45 seconds, 17 speech-aligned caption pages.
- `node scripts/check-final.mjs`: both exports passed full decode, dimensions,
  1350-frame count, 30 fps, H.264/AAC stereo, limited-range Rec.709, duration,
  and audio headroom checks. Measured audio: −16.55 LUFS, −1.20 dBTP.
- Inspected contact sheets extracted from both final MP4s, including their held
  final download CTA frames. Files are 15.1 MB portrait and 13.3 MB landscape.
- Renderer v4's default color-space handling initially produced full-range
  BT.601. Setting `colorSpace: 'bt709'` in the shared render pipeline corrected
  both exports; a short diagnostic render confirmed the fix before rerendering.
