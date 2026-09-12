import { useState } from 'react';
import { Game } from './components/Game.js';
import { Home } from './components/Home.js';
import { Waiting } from './components/Waiting.js';
import { useGameSocket } from './net/useGameSocket.js';

type JoinMode = 'pass' | 'quick' | 'cpu' | null;

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
    joinCpu,
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
        onJoinCpu={(name) => {
          setJoinMode('cpu');
          setWaitLabel('CPU対戦を準備しています');
          joinCpu(name);
        }}
      />
    );
  }

  if (state === null || youAre === null) {
    return <Waiting label={waitLabel} onCancel={leave} />;
  }

  // 「もう一局」は合流方法によって意味が異なる: 合言葉で入った対局は同じ相手との
  // 再戦(既存のrematchプロトコル)、ランダム対戦で入った対局は同じ相手を前提にせず
  // 新たにランダムマッチを試みる。CPU対戦は同じ部屋を即リセットして新しい対局を始める
  // (サーバが相手の同意を待たず rematchAgreed を返す)。
  const handleRematch = () => {
    if (joinMode === 'quick') {
      setWaitLabel('ランダム対戦の相手をさがしています');
      void joinQuick(you);
    } else {
      send({ t: 'rematch' });
    }
  };

  const handleBackToHome = () => {
    leave();
    setJoinMode(null);
  };

  return (
    <Game
      state={state}
      youAre={youAre}
      you={you}
      opponent={opponent ?? 'あいて'}
      gameOverReason={gameOverReason}
      notice={notice}
      clock={clock}
      rematchRequestedByMe={joinMode === 'quick' || joinMode === 'cpu' ? false : rematchRequestedByMe}
      onRematch={handleRematch}
      onBackToHome={handleBackToHome}
      send={send}
    />
  );
}
