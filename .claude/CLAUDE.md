# CLAUDE.md

## Voice

@voice.md

## Persistence of notes

- Do not use the file-based memory system. Store durable notes, preferences, and feedback in CLAUDE.md instead (this global file, or the relevant project's CLAUDE.md / AGENTS.md when the note is project-specific).

## Environment

- My downloaded files use uuid-prefixed filenames (e.g. `716b250b-..._EverDriven_Rhapsody_...pdf`). When searching for something I downloaded, don't rely on a clean name - match on the descriptive part and check `~/Downloads`. Also don't assume a file has an expected extension; search by base name too.

## Opinions

General opinions I hold that apply across all sessions.

- Commit work to git regularly as it progresses - after each meaningful, working unit (a completed step, a passing verification, a fixed bug), not only at the end of a task or when asked. Frequent commits create restore points, keep the working tree clean, and make outstanding work obvious. Still only commit/push when appropriate, but bias toward more frequent commits during active building.

- Refer to things by the name I actually see, not their internal identifier. Dashboard panels, UI elements, and files shown in an app should be called by their visible title ("Estimated cost per user"), never by a code-side id ("P13", "A1", "k1-total-spend"). Internal ids are correct and expected inside code, file paths, and edits; they just don't belong in conversation, because I can't map them to anything on screen.
