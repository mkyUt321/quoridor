import { useState } from 'react';
import { Game } from './components/Game.js';
import { Home } from './components/Home.js';
import { Waiting } from './components/Waiting.js';
import { useGameSocket } from './net/useGameSocket.js';

export function App() {
  const {
    phase,
    state,
    youAre,
    you,
    opponent,
    error,
    gameOverReason,
    notice,
    rematchRequestedByMe,
    joinPass,
    joinQuick,
    send,
    leave,
  } = useGameSocket();
  const [waitLabel, setWaitLabel] = useState('');

  if (phase === 'home') {
    return (
      <Home
        error={error}
        onJoinPass={(pass, name) => {
          setWaitLabel(`あいことば「${pass}」で待機中`);
          joinPass(pass, name);
        }}
        onJoinQuick={(name) => {
          setWaitLabel('ランダム対戦の相手をさがしています');
          void joinQuick(name);
        }}
      />
    );
  }

  if (state === null || youAre === null) {
    return <Waiting label={waitLabel} onCancel={leave} />;
  }

  return (
    <Game
      state={state}
      youAre={youAre}
      you={you}
      opponent={opponent ?? 'あいて'}
      gameOverReason={gameOverReason}
      notice={notice}
      rematchRequestedByMe={rematchRequestedByMe}
      send={send}
    />
  );
}
