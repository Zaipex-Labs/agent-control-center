# Example skill: using the `git` power

Copy this file into `~/.zaipex-acc/projects/<your-project>/skills/`
(rename to e.g. `git.md`) for any team whose backend / frontend
agents have the `git` power turned on. See `docs/powers.md` for the
plumbing.

---

## Git inspection before editing

Backend has the `git` power. Use it whenever you're about to modify
or refactor a file:

1. Call `git_log --max-count 5 <path>` first. Read the most recent
   commit subjects so you don't undo a fix or contradict a recent
   decision.
2. If the change touches behavior another agent (frontend, qa) might
   be working on, call `recall` for any related decisions before
   sending a message.
3. When you reply with the change, cite the commit sha you read
   (`already addressed in 8479d3e`) so the user can follow up.

## Don't write to git

The `git` power is **read-only**. Never call it to commit, push,
rebase, or reset — those operations belong to the user. If you
genuinely think a commit should happen, send a message to the team
with the proposed message and let the user run it.

## When to skip the power

If the file you're touching is brand new (no git history) or the
question is about something visibly off-disk (config you just wrote
yourself this turn), the lookup adds latency without value. Use
judgment.
