import { useState } from 'react';
import { Game } from './components/Game.js';
import { Home } from './components/Home.js';
import { Waiting } from './components/Waiting.js';
import { useGameSocket } from './net/useGameSocket.js';

export function App() {
  const { phase, state, youAre, opponent, error, gameOverReason, notice, rematchRequestedByMe, joinPass, send, leave } =
    useGameSocket();
  const [nick, setNick] = useState('');
  const [pass, setPass] = useState('');

  if (phase === 'home') {
    return (
      <Home
        error={error}
        onJoin={(p, name) => {
          setNick(name);
          setPass(p);
          joinPass(p, name);
        }}
      />
    );
  }

  if (state === null || youAre === null) {
    return <Waiting pass={pass} onCancel={leave} />;
  }

  return (
    <Game
      state={state}
      youAre={youAre}
      you={nick}
      opponent={opponent ?? 'あいて'}
      gameOverReason={gameOverReason}
      notice={notice}
      rematchRequestedByMe={rematchRequestedByMe}
      send={send}
    />
  );
}
