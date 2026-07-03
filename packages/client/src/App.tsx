import { useState } from 'react';
import { Game } from './components/Game.js';
import { Home } from './components/Home.js';
import { Waiting } from './components/Waiting.js';
import { useGameSocket } from './net/useGameSocket.js';

type JoinMode = 'pass' | 'quick' | null;

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
    clock,
    rematchRequestedByMe,
    joinPass,
    joinQuick,
    send,
    leave,
  } = useGameSocket();
  const [waitLabel, setWaitLabel] = useState('');
  const [joinMode, setJoinMode] = useState<JoinMode>(null);

  if (phase === 'home') {
    return (
      <Home
        error={error}
        onJoinPass={(pass, name) => {
          setJoinMode('pass');
          setWaitLabel(`あいことば「${pass}」で待機中`);
          joinPass(pass, name);
        }}
        onJoinQuick={(name) => {
          setJoinMode('quick');
          setWaitLabel('ランダム対戦の相手をさがしています');
          void joinQuick(name);
        }}
      />
    );
  }

  if (state === null || youAre === null) {
    return <Waiting label={waitLabel} onCancel={leave} />;
  }

  // ランダム対戦(クイックマッチ)で入った対局は、終了後「戻る」を押しても
  // 同じ相手との再戦を前提にせず、そのまま新しい相手を探すマッチング画面へ
  // 直接移動する。合言葉で入った対局はホーム画面へ戻る。
  const handleBackToHome = () => {
    if (joinMode === 'quick') {
      setWaitLabel('ランダム対戦の相手をさがしています');
      void joinQuick(you);
    } else {
      leave();
      setJoinMode(null);
    }
  };
  const backToHomeLabel = joinMode === 'quick' ? '次の相手を探す' : 'ホームに戻る';

  return (
    <Game
      state={state}
      youAre={youAre}
      you={you}
      opponent={opponent ?? 'あいて'}
      gameOverReason={gameOverReason}
      notice={notice}
      clock={clock}
      rematchRequestedByMe={rematchRequestedByMe}
      send={send}
      onBackToHome={handleBackToHome}
      backToHomeLabel={backToHomeLabel}
    />
  );
}
