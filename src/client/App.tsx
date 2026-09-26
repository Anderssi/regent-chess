import { useState } from "react";
import { AnalyseMode } from "./components/AnalyseMode.tsx";
import { PlayMode } from "./components/PlayMode.tsx";

type Mode = "play" | "analyse";

export function App() {
  const [mode, setMode] = useState<Mode>("play");
  return (
    <main className="app">
      <header className="box">
        <h1>SchackMars</h1>
        <nav role="tablist">
          <button role="tab" aria-selected={mode === "play"} onClick={() => setMode("play")}>
            Play
          </button>
          <button role="tab" aria-selected={mode === "analyse"} onClick={() => setMode("analyse")}>
            Analyse
          </button>
        </nav>
      </header>
      {mode === "play" ? <PlayMode /> : <AnalyseMode />}
    </main>
  );
}
