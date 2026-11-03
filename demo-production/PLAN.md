# Execution plan

Everything lives in `demo-production/`; application code is not touched except for real bugs found while recording (each one fixed separately, tested and listed here).

```
demo-production/
  ../docs/evidence/ARCHITECTURE_VS_PROTOTYPE.md   Phase 1 (done; moved out of this folder)
  STORYBOARD.md           Phase 2 (this proposal)
  automation/             Phase 3: Playwright scenarios, one per scene, plus reset.sh and record.mjs
  recordings/             raw .webm per scene + key screenshots (git-ignored above a size limit; see README)
  narration/              script.json (scene → text), audio/*.wav, subtitles .srt/.vtt, timings.json
  remotion/               Remotion 4 project (React/TS): compositions Main (≈4:30) and Short (≈1:30)
  render.sh               one command: record → narrate → render → ffmpeg loudness/encode
  out/                    final MP4s (published as a release asset or shared link, not committed)
  README.md
```

## Stages (each verified and pushed before the next)

1. **Recording scenarios.** Each scene is a Playwright script that resets or checks its starting state, then runs the real actions with a visible cursor overlay, human-paced typing and pauses. It records 1920×1080 video and writes a timestamp log for each action (used for zooms and callouts). Every scenario must pass its assertions; a failed assertion fails the recording.
2. **Narration.** `script.json` holds the text; TTS renders one clip per scene; the clip durations drive the scene timing (the video slows or holds frames to fit, never speeds the app up unrealistically). Subtitles come from the same text plus the clip timings.
3. **Remotion composition.** Title cards, scene sequences from the recordings, zoom and pan driven by the action log, callouts, cursor highlight, split screen for scene 4, terminal inset for scene 10, burned-in subtitles (plus separate .srt), quiet music bed and soft UI clicks.
4. **Render and validate.** 1080p H.264 + AAC, loudness normalised to −16 LUFS with ffmpeg; check duration, resolution, audio levels, subtitle sync; extract a frame contact sheet to review every scene.
5. **Short cut.** Same assets, the ★ scenes.

## Decisions needed from you

1. **Narration voice.** ElevenLabs (connected; natural voice, uses your ElevenLabs credits, about 4,000 characters for both cuts) or Piper (offline, free, clearly synthetic).
2. **Music.** A quiet synthesised ambient bed generated locally, or no music (voice and soft UI sounds only).
3. **Vercel.** See the deployment notes in the chat reply.
