# ai chess app 
We need to create a web app that let's "our ai" play games against stockfish api and gain elo rating. The app should be able to replay old games as well or any game pasted as algebraic notation.

- "Our ai" Claude via the anthropic api.
- Opponent is stockfish free api. Stockfish engine (https://official-stockfish.github.io/docs/stockfish-wiki/Home.html)

## App Features
- A chess game board. (We later want to be able to design the board and pieces)
- We have two modes in the app. 
  - play mode: Our ai playes a game against stockfish
  - analize mode: select previous games for analysis or pase any game into a textbox for analysis. Analysis should be done using stockfish.
- We want to get a estimated elo rating by stockfish engine for each played games.
- We want to be able to sort previous games by elo.
- we should be able to paste any chess game into mode 1.
- we need a log of old games stored in algebraic notation.

## Game loop
- Every game against stockfish is alternated between black and white.
- Play legal moves only 
- the moves are saved as algebraic notation

## Rules apart from chess rules.
- Thinking time is limited to 5 seconds per move/player.
- Stockfish elo rating should be 1600 done by setting
```typescript
engine.configure({
    "UCI_LimitStrength": True,
    "UCI_Elo": 1600
})
```
```

## Tech stack
- Bun (typescript)
- stockfish engine
- antrhopic api
- react frontend

```
/goal we have a chess game app running with proper unit and integration tests.
