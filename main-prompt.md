We need to create a web app that let's our ai play games against stockfish api and gain elo rating. The app should be able to replay old games as well or any game pasted as algebraic notation.

Features
- A chess game board. (We later want to be able to design the board and pieces)
- We have two modes in the app. 
  - play mode: Our ai playes a game against stockfish
  - analize mode: select previous games for analysis or pase any game into a textbox for analysis.
- We want to get a estinated elo rating for played games.
- We want to be able to sort previous games by elo.
- we should be able to paste any chess game into mode 1.
- we need a log of old games stored in algebraic notation.

Game loop
- Every game against stockfish is alternated between black and white.
- the moves are saved as algebraic notation

/goal we have a chess game app running with proper unit and integration tests.
