import { Chess, type Square } from "chess.js";
import { classicTheme, type BoardTheme, type PieceCode } from "../theme.ts";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export interface BoardProps {
  fen: string;
  orientation?: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  theme?: BoardTheme;
}

export function Board({ fen, orientation = "white", lastMove, theme = classicTheme }: BoardProps) {
  const board = new Chess(fen).board();
  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "white" ? FILES : [...FILES].reverse();

  return (
    <div className="board" role="grid" aria-label="Chess board">
      {ranks.map((rank, row) =>
        files.map((file, col) => {
          const square = `${file}${rank}` as Square;
          const piece = board[8 - rank]![FILES.indexOf(file)];
          const light = (FILES.indexOf(file) + rank) % 2 === 1;
          const highlighted = lastMove && (lastMove.from === square || lastMove.to === square);
          const code = piece ? (`${piece.color}${piece.type}` as PieceCode) : null;
          return (
            <div
              key={square}
              role="gridcell"
              data-square={square}
              data-piece={code ?? undefined}
              className="square"
              style={{
                background: light ? theme.lightSquare : theme.darkSquare,
                boxShadow: highlighted ? `inset 0 0 0 100vmax ${theme.lastMoveHighlight}` : undefined,
              }}
            >
              {code && <span className={`piece piece-${code[0]}`}>{theme.renderPiece(code)}</span>}
              {col === 0 && (
                <span className="coord rank" style={{ color: light ? theme.coordinateColor.onLight : theme.coordinateColor.onDark }}>
                  {rank}
                </span>
              )}
              {row === 7 && (
                <span className="coord file" style={{ color: light ? theme.coordinateColor.onLight : theme.coordinateColor.onDark }}>
                  {file}
                </span>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}
