---
name: analyze-games
description: Analyse finished SchackMars games with the chess-grandmaster and engine-developer agents and save their reports to the app. Use for /analyze-games, when asked to run the agents on games, to backfill agent reports, or to re-run them on a game.
argument-hint: "[game-id ...]"
allowed-tools: Bash(bun scripts/agents.ts *)
---

Run the two analysis agents on SchackMars games. Each saves its own report in the app's database, and the analysis page shows it.

Game ids given: $ARGUMENTS

1. Choose the games.
   - If ids are given, analyse exactly those, even if they already have reports. New reports replace old ones.
   - If none are given, run `bun scripts/agents.ts pending` and analyse the games it lists: at most 10, oldest first, and it says if more are waiting. If nothing is pending, say so and stop.
2. For each game, one at a time:
   1. Run `bun scripts/agents.ts status <id>` and note when its reports were last saved, if ever.
   2. In a single message, start both subagents so they run in parallel: `chess-grandmaster` and `engine-developer`, each with the task "Analyse SchackMars game #<id> and save your report."
   3. Wait for both to finish, then run `bun scripts/agents.ts status <id>` again. Both reports should now be newer than before. If one isn't, run that agent once more; if it still fails, note it and move on to the next game.
3. Finish with a short summary per game: whether both reports were saved, and each agent's top suggestion (`bun scripts/agents.ts reports <id>` prints them). Say if more games are still pending.
