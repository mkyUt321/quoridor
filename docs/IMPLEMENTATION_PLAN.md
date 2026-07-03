# Quoridor オンライン対戦 Web アプリ 実装プラン

## Context(背景と目的)

ボードゲーム「Quoridor(コリドール)」を、2人のユーザーが WebSocket でリアルタイム対戦できる Web アプリとして新規に構築する。現状ディレクトリは空(グリーンフィールド)。Node.js 22.20 / npm が利用可能。

**目的とねらい**: 「**合言葉を打つだけ**で外部連絡ツールを介さずに2人が出会える軽量さ」と「サーバ権威型による確実なルール検証(不正手の排除)」を軸に、リアルタイム同期と再接続に強い対戦体験を提供する。競合(Board Game Arena, playquor.org 等)に対しては “URLコピペ不要ですぐ遊べる・ルールが厳密・再接続に強い” を差別化点とする。

**確定した方針(ユーザー選択)**:
- 対戦モード: **合言葉マッチング(両者が同じ合言葉を入力して出会う)+ ランダムマッチング**(対CPU・同一端末ローカルは対象外)
  - URLをコピーして外部ツールに貼る導線は不採用。合言葉は口頭/事前約束で共有し、両者が独立に同じ語を入力→ランデブー成立。先着が待機、次に同じ語を入れた人とマッチ。
- フロントエンド: **React + Vite + TypeScript**
- 盤面描画: **SVG + CSS**
- 永続化: **匿名(ニックネームのみ)**。ルーム/対局状態はサーバのメモリ上で管理(DB なし)

## ルール要件(実装が満たすべき仕様)

- 9×9 盤。2人対戦で各プレイヤーは対辺中央からスタート、壁を各 **10枚** 保持。
- 手番は「ポーンを隣接マスへ1歩移動」**または**「壁を1枚設置」のいずれか。
- 勝利: 自ポーンを相手側の対辺(9マスのいずれか)へ到達。
- 壁: マス間の溝に2マス長で設置、除去不可。**重なり・交差禁止**、かつ **両プレイヤーのゴール経路を最低1本残す**(完全封鎖禁止 → BFS 検証必須)。
- ジャンプ: 隣接する相手ポーンを飛び越えて進める。背後が壁/盤外なら斜め移動を許可。

## アーキテクチャ

**サーバ権威型**。全ての手はサーバ(Cloudflare Durable Object)で検証し、正規化した対局状態をブロードキャスト。クライアントは表示と入力プレビュー(合法手ハイライト)に専念し、サーバの `state` を唯一の真実として反映する。

**モノレポ(npm workspaces)** でゲームロジックと型を共有:

```
quoridor/
  package.json            # workspaces: packages/*, dev スクリプト(concurrently)
  tsconfig.base.json
  packages/
    shared/               # ゲームロジック + 型(worker/client 共用)
    worker/               # Cloudflare Worker + Durable Objects(WebSocket)
    client/               # React + Vite + TypeScript(SVG 盤面)
```

> ※ 以下「アーキテクチャ〜packages/client」は概要。**確定した型名・関数名・API・ファイル構成は後半の「# 詳細実装計画」が正**(そちらを優先)。

## packages/shared — ゲームロジック(最重要・純粋関数)

ゲームロジックと型を純粋関数として `shared` に置き、worker(権威判定)と client(合法手の先読みハイライト)で共用する。**確定した型定義・関数シグネチャは後半「型定義」「ルール関数」節が正**(`r/c` 命名、`GameState{pawns,goal,walls,wallsLeft,turn,last,winner}`、`legalPawnMoves/wallLegal/hasPath/wallConflict/applyMove`)。

- 初期配置: P1 は row 8 → goal 0 / P2 は row 0 → goal 8、中央列。壁各 10 枚。
- 判定: 直進4方向 + ジャンプ/斜め、壁の重なり(同一/隣接セグメント)・交差(H と V が同交点)、**BFS** による両者ゴール到達可能性(封鎖禁止の核)。
- `applyMove` は検証込みで新 state を返す**サーバ権威の単一入口**。不正手は `Result` の失敗で返す。
- **正当性はモックで検証済み**(Node 14 ケース緑)。そのロジックと幾何定数を移植する(再発明しない)。

テスト(Vitest, `packages/shared/src/*.test.ts`): 直進/ジャンプ/斜め、壁の重なり・交差、BFS 封鎖拒否、勝利判定、壁枚数 0 での設置拒否 を網羅。**ここが正当性の要**。

## サーバ(WebSocket)概要

- リアルタイム通信は WebSocket。サーバ権威で全手を検証しブロードキャスト。合言葉ランデブー(両者が同じ合言葉で出会う)+ ランダムマッチ、切断時の再接続(トークン + 猶予タイマー)に対応。
- **実装は Cloudflare Workers + Durable Objects を採用**(1ルーム=1 DO、Hibernatable WebSockets)。**具体の API・プロトコル・DO 設計は後半「サーバ実装(`packages/worker` …)」が正**。

## UX 設計 — 差別化の柱(最重要)

競合(モード切替式操作・長い開始導線・置いてからエラー・視点固定)の摩擦を全て潰すことを差別化点とする。

### 移動 vs 壁: モードレス操作(核心)
- **モードトグルを廃止**。SVG 盤面の当たり判定を2種類持ち、**カーソル位置で操作を自動判別**する。
  - **マス(セル)上** → ポーン移動候補。合法先に lichess 風のドット/ゴースト駒、クリックで移動。
  - **マス間の溝(グルーヴ)上** → 壁設置候補。ゴースト壁、クリックで設置。
- **壁の向きは溝の種類で完全自動**(横溝→横壁 / 縦溝→縦壁)。2マス長は**カーソル位置から最寄り合法スロットへスナップ**。交点付近は**より深く入っている溝の向き**を採用(`(xin-C) > (yin-C) ? V : H`)。→ **手動の向き反転(R/右クリック)は不採用**(モックで不要と確認)。
- **置く前に合法性を色で提示**: shared ロジックをクライアントでも実行し **合法=緑 / 不正(重なり・交差・封鎖違反)=赤**。赤はクリック無効(軽くシェイク)。残り壁0は溝ホバー無効。→ **「置いてからエラー」を根絶**。
- **タッチ対応**: マスタップ=移動、溝タップ=ゴースト壁+**ドラッグ微調整/⤿反転/✓確定/✕ハンドル**の2ステップ確定(ホバー無しでも誤操作なし)。初回のみ「マスで移動・線で壁」ヒント。

### 開始までの手数を最小化(ストレス軽減)
会員登録なし・別ロビー画面なし・設定ダイアログなし・**URLコピペなし**を徹底。
- **合言葉マッチング**: 両者が同じ合言葉(例「さくら」)を入力 → 「対戦する」1クリックで出会う。外部連絡ツール不要(合言葉は口頭/事前約束で共有)。先着は「相手待ち」オーバーレイ、二人目が来たら即開始。
- **ランダム対戦**: 合言葉すら不要、1クリックで待機キュー → マッチ即開始。
- ニックネームは**自動生成 + localStorage 保存**(初回以外は入力ゼロ)。ホームは「ニックネーム + 合言葉入力 + 対戦する / ランダム対戦」だけの1画面。待機中もホバーで操作を予習可。

### 配色(確定)— 壁の視認性を最優先
**盤面(プレイ面)は常に明るい面**にし、**壁だけを黒に近い色**にして視認性を最大化する。盤面はページのライト/ダークに関わらず明るい面のまま(暗いテーブルに置かれた明るい盤のイメージ)。盤面の背景とマスは共に白に近いが**明確に区別**できる濃淡差をつける。
- **盤面の背景(溝・フレーム)**: ごく淡いグレー `#e7ebef`(溝が薄いグレーの線として見える)。両テーマ共通。
- **マス(セル)**: 白に近い `#fafbfc`(背景よりわずかに明るい)+ 細い境界 `#dde3e8`。両テーマ共通。→ 背景との濃淡差でマスの区切りが分かる。
- **壁**: 黒に近いチャコール `#23282e`(縁 `--wall-edge:#14181c`)。明るい盤面上で最大コントラスト。両テーマ共通。
- **駒 P1**: 落ち着いたティール `#2f8f88`(白マス上でも十分なコントラスト)。
- **駒 P2**: 落ち着いたテラコッタ `#c2764f`。
- **合法/不正(設置時のみ一時表示)**: 緑 `#4a9d5f`、赤 `#cf5a4c`。ホーム行はごく淡い駒色の地(約8%)。
- ページの外枠(パネル/文字/地)はライト/ダークで切替(`prefers-color-scheme` + `data-theme`)。**ただし盤面のトークン(背景・マス・壁)はテーマ非依存で固定**。

### その他のやさしさ
- **視点の正規化**: サーバ状態は正準だが、各クライアントは**自分の駒を常に手前(下)**に描画(両者が下→上へ進む直感)。
- **相手の直前手をハイライト** / **手番グロー + 「あなたの番」バナー** / 移動・設置の軽アニメ + 効果音。

## packages/client — React + Vite + TypeScript(SVG 盤面)

- 接続層: `useGameSocket` フック/Context で WebSocket 接続・送受信・状態を集約。受信 `state` を単一の真実として保持。
- 画面(単一ページ・ルーティング最小):
  - `Home`: 自動生成ニックネーム(編集可) + **合言葉入力** + 「対戦する(合言葉)」「ランダム対戦」ボタン。
  - `GameBoard`(**SVG**): 上記モードレス操作を実装。合法先ハイライト・ゴースト壁・スナップ・緑/赤の合法性表示・視点正規化・last-move ハイライト。相手待ちは「合言葉『◯◯』で待機中」オーバーレイ(キャンセル可)。
  - `GameHUD`: 手番バナー、残り壁数(ピップ表示)、プレイヤー名、リザイン/リマッチ。
  - ステータス表示: 相手切断/再接続中トースト。
- 楽観的 UX はハイライト/ゴーストのみに留め、確定はサーバ応答で行う(不整合防止)。

## 検証(Verification)

- **ユニット**: `npm test` で `shared`(合法手・ジャンプ/斜め・壁重なり/交差・BFS 封鎖拒否・勝利判定)と `worker/session`(手番拒否・勝敗・resign/rematch)が全て緑。
- **E2E(手動)**: `npm run dev`(wrangler dev + vite)起動 → ブラウザ2タブ。
  1. 両タブで同じ合言葉(例「さくら」)を入力し「対戦する」→ マッチ成立・対局開始、交互着手が両タブで同期。
  2. クイックマッチ: 2タブから「ランダム対戦」→ `/quick` ペアリングで自動マッチング。
  3. 不正手拒否: 相手を完全封鎖する壁を置こうとして `error` が返り盤面が変わらないこと。ジャンプ/斜め移動が正しく発生すること。
  4. 勝利: ゴール到達で両タブに `gameOver`、リマッチで再開できること。
  5. 再接続: 一方のタブをリロード → `rejoin` で同一対局へ復帰、相手側に切断/復帰通知が出ること。
  6. スマホ実機/エミュレータ: タップ移動・溝タップ→`WallConfirmBar`で壁確定、盤面が画面幅に収まること。

## スコープ外(将来拡張)

対CPU(AI)、同一端末ローカル対戦、アカウント/DB による対局履歴・棋譜、持ち時間(チェスクロック)、4人対戦。

---

# 詳細実装計画

> インタラクション検証: 盤面操作モック(`scratchpad/quoridor-interaction.html`)でモードレス操作を実装・確認済み。コアルール(canStep / legalPawnMoves / hasPath(BFS) / wallConflict)は Node で 14 ケース検証済み。**このモックの JS ロジックと幾何定数をそのまま `shared` / `GameBoard` へ移植する**(再発明しない)。

## ファイル構成(確定)

```
quoridor/
  package.json                # workspaces:["packages/*"], scripts: dev/build/test
  tsconfig.base.json          # strict, target ES2022, moduleResolution "bundler"
  .gitignore
  packages/
    shared/
      package.json            # name:"@quoridor/shared", type:module, exports ./src/index.ts
      tsconfig.json
      src/
        types.ts              # Position, Wall, Move, GameState, PlayerId, Result
        rules.ts              # canStep/legalPawnMoves/hasPath/wallConflict/wallLegal(=モック移植)
        game.ts               # createInitialState / applyMove / checkWinner
        protocol.ts           # ClientMsg / ServerMsg 判別可能union + 型ガード
        index.ts              # re-export
        rules.test.ts         # Vitest(モックの node テストを移植・拡張)
        game.test.ts
    worker/                   # Cloudflare Worker + Durable Objects(採用: 案B)
      package.json            # name:"@quoridor/worker", deps: wrangler, @cloudflare/workers-types, @quoridor/shared
      wrangler.toml           # DO bindings: ROOM=RoomDO, LOBBY=LobbyDO / compatibility_date
      tsconfig.json
      src/
        index.ts              # Worker fetch(): POST /quick(ペアリング) と GET /ws(WSアップグレード→DOへルーティング)
        RoomDO.ts             # Durable Object: 1ルーム=1インスタンス、Hibernatable WS、権威 GameState 保持
        LobbyDO.ts            # シングルトン: quickMatch のペアリング→共有 roomKey を返す
        session.ts            # ランタイム非依存の対局セッション中核(shared の applyMove 利用・単体テスト可能)
        session.test.ts       # Vitest(手番拒否・勝敗・resign・rematch)
    client/
      package.json            # react, react-dom, vite, @vitejs/plugin-react, @quoridor/shared
      vite.config.ts          # server.proxy: { "/ws":{target 'ws://localhost:8787', ws:true}, "/quick":{target 'http://localhost:8787'} }
      index.html
      tsconfig.json
      src/
        main.tsx / App.tsx    # 画面ステートで Home ⇄ Game を切替(ルータ最小)
        net/useGameSocket.ts  # WebSocket 接続・送受信・再接続・状態集約フック
        game/geometry.ts      # C/G/P/STEP/WSPAN、cellXY/wallRect(モック移植)
        game/interaction.ts   # computeHover/nearestAnchor(モック移植, 純粋関数, 向き反転なし)
        components/Home.tsx        # ニックネーム + 合言葉 + 対戦する/ランダム対戦
        components/Waiting.tsx     # 待機画面(スピナー + 合言葉表示 + キャンセル)
        components/Game.tsx        # 盤面 + HUD + オーバーレイの container
        components/Board.tsx       # SVG(モック描画を React 化)
        components/Hud.tsx         # ターンバナー・壁ピップ・resign/rematch
        components/WaitingOverlay.tsx  # 「合言葉◯◯で待機中」/ 切断・再接続トースト
        styles.css            # モックの CSS トークン(light/dark 両対応)を移植
        nickname.ts           # 自動生成 + localStorage
```

## 型定義(`shared/src/types.ts`)

```ts
export type PlayerId = 0 | 1;
export interface Position { r: number; c: number; }          // 0..8
export interface Wall { r: number; c: number; o: 'H' | 'V'; }// 交点アンカー 0..7
export type Move =
  | { type: 'pawn'; to: Position }
  | { type: 'wall'; wall: Wall };
export interface GameState {
  pawns: [Position, Position];
  goal: [number, number];        // [0, 8]
  walls: Wall[];
  wallsLeft: [number, number];   // 初期 [10,10]
  turn: PlayerId;
  last: { type: 'pawn'; from: Position; to: Position }
      | { type: 'wall'; wall: Wall } | null;
  winner: PlayerId | null;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
```

## ルール関数(`shared/src/rules.ts` / `game.ts`) — モックから移植

- `canStep(walls, r,c, r2,c2): boolean`(blockedV/blockedH 内包)
- `legalPawnMoves(state, who): Position[]`(直進/ジャンプ/斜め)
- `hasPath(walls, start, goalRow): boolean`(BFS)
- `wallConflict(walls, w): boolean`(同交点=交差 / 隣接同向=重なり)
- `wallLegal(state, w): boolean`(範囲・残枚数・conflict・両者 hasPath)
- `applyMove(state, move, who): Result<GameState>` — **サーバ権威の単一入口**。手番一致→種別ごとに合法性検証→新 state(immutable)を返し `winner`/`turn`/`last` を更新。不正は `{ok:false,error}`。
- テストは moc の Node 検証(14 ケース)を Vitest 化し、勝利判定・残枚数0拒否・applyMove の手番拒否を追加。

## プロトコル(`shared/src/protocol.ts`)

**入室はWSのURLで表現**(DOルーティング): 合言葉= `GET /ws?room=p:<pass>&name=<nick>`、ランダム= 先に `POST /quick`→`{roomKey}`→ `GET /ws?room=<roomKey>&name=<nick>`。待機(相手未着)・キャンセル(=WSクローズ)は接続状態で表現するため、WS上の `ClientMsg` は対局操作に絞る。

```ts
export type ClientMsg =
  | { t: 'move'; move: Move }
  | { t: 'resign' }
  | { t: 'rematch' }
  | { t: 'rejoin'; token: string };
export type ServerMsg =
  | { t: 'waiting' }                          // 相手の入室待ち(自分だけ入室済み)
  | { t: 'matched'; you: PlayerId; token: string; opponent: string; state: GameState }
  | { t: 'state'; state: GameState }
  | { t: 'gameOver'; winner: PlayerId; reason: 'goal' | 'resign' | 'disconnect' }
  | { t: 'opponentLeft'; grace: number }     // 再接続待ち(秒)
  | { t: 'opponentBack' }
  | { t: 'rematchOffered' } | { t: 'rematchAgreed' }
  | { t: 'error'; code: string; message: string };
// POST /quick のレスポンス: { roomKey: string }
```

## サーバ実装(`packages/worker` — Cloudflare Workers + Durable Objects)

**設計の要**: 「1ルーム = 1 Durable Object」。合言葉→DO名で両プレイヤーが自然に同一 DO へ集約されるため、従来の RoomManager マップは不要。DO 内に権威 `GameState` を保持し、**Hibernatable WebSockets**(`state.acceptWebSocket`)で休眠中も接続維持・課金最小。

- **`index.ts`(Worker fetch)**: ルーティングのみ。
  - `POST /quick` → `LOBBY`(シングルトン DO)へ。応答 `{ roomKey }`。
  - `GET /ws?room=<key>&name=<nick>`(WSアップグレード)→ `env.ROOM.idFromName(key)` の `RoomDO` へ `fetch` を forward。合言葉は `key = "p:"+normalize(passphrase)`、quick は Lobby が払い出した乱数キー。
- **`LobbyDO`(quickMatch ペアリング)**: 待機中の roomKey を最大1つ保持。`pair()`: 待機があれば返して消去、無ければ乱数キーを生成し待機登録して返す(TTL で古い待機を掃除)。→ 先着と次客が**同じ roomKey** を得て同一 RoomDO に入る。単一スレッドなので競合なし。
- **`RoomDO`(1ルーム=権威対局)**:
  - WS 受理時に席(0/1)を割当て、`token`(uuid)発行、`ws.serializeAttachment({seat, token, name})` で休眠復帰後も識別。3人目は `error('room_full')` で拒否。
  - `webSocketMessage(ws, raw)`: `ClientMsg` を解析。`move` は `session.applyMove(state, move, seat)` → `ok` なら両者へ `state`、`winner!=null` で `gameOver('goal')`。`ok:false` は送信者へ `error('illegal_move')`(盤面不変)。`resign`/`rematch` も処理。
  - **再接続**: `webSocketClose` で席を空席化し相手へ `opponentLeft{grace:30}`、`storage.setAlarm(now+30s)`。同 `token` の `rejoin` で復帰→相手へ `opponentBack`+現 `state` 再送、アラーム解除。`alarm()` 発火(未復帰)で相手 `gameOver('disconnect')`。
  - 両席とも `matched{ you:seat, token, opponent, state }` を接続確立時に送る。`rematch` 合意で `createInitialState()`(先後入替)→ `state`。
- **`session.ts`**: `shared` の `applyMove`/`createInitialState` を用いた**ランタイム非依存の純ロジック**(DO から呼ぶだけ)。Vitest で単体テスト(Wrangler 不要)。
- **ローカル開発**: `wrangler dev`(Worker + DO + WS をローカル実行、既定 `:8787`)。本番と同一ランタイムで開発。

## クライアント実装(`packages/client`)

- **`useGameSocket`**: 接続関数 `joinPass(pass,nick)`(WS `?room=p:<pass>`)/ `joinQuick(nick)`(`POST /quick`→`?room=<key>`)。URL は `location.origin.replace('http','ws') + '/ws?...'`。`send(msg: ClientMsg)`、受信を `switch(msg.t)` で React state(`phase: 'home'|'waiting'|'playing'|'over'`, `state`, `youare`, `opponent`, `notice`)へ反映。`waiting` で待機画面、`matched` で対局へ。`token`+roomKey は sessionStorage 保存、`onclose` で指数バックオフ再接続→ token あれば `rejoin`。
- **`Board.tsx`**: モックの SVG 構築/`computeHover`/`paintGhost` を React 化。**視点正規化**: `youare===1` のとき描画座標を 180°回転(`r→8-r, c→8-c`、壁アンカーも変換)する純関数を噛ませ、常に自分を手前に。`onClick`→合法なら `send({t:'move',move})`(送信のみ、確定はサーバ `state` 受信で反映=楽観更新はゴーストのみ)。壁の向きはカーソル位置で自動(手動反転なし)。手番でない/`winner`時は入力無効。
- **`Home.tsx`**: `nickname`(自動生成+localStorage)、合言葉入力(空なら「対戦する」無効)、「対戦する」→`joinPass`、「ランダム対戦」→`joinQuick`。
- **`Waiting.tsx`**: `waiting` 受信で表示。合言葉/ランダムの待機メッセージ + スピナー + 「キャンセル」→WSクローズ→Home。`matched` 受信で Game へ。
- **`Hud.tsx`/`WaitingOverlay.tsx`**: ターンバナー・壁ピップ・resign/rematch・待機/切断/再接続トースト。
- **`styles.css`**: モックのトークン(light/dark、`prefers-color-scheme` + `data-theme`)を移植。

## スマホ(タッチ)操作の詳細

ホバーが無いタッチ環境でも、モードレスの思想を保ちつつ誤操作なく操作できるようにする。`matchMedia('(pointer: coarse)')` で入力種別を判定し、UI を出し分ける。

- **入力種別フック `usePointerKind()`**: `coarse`(タッチ) / `fine`(マウス)を返す。`Board` はこれで挙動を分岐。
- **移動(タッチ)**: 合法手ドットは常時表示。**マスをタップ=即移動**(ドットが明快なので確認不要)。相手駒隣接時のジャンプ/斜めもドットとして出るのでタップで選択。
- **壁設置(タッチ)= 2ステップ確定**: 溝付近をタップ → ゴースト壁がスナップ表示(緑/赤)→ 盤下部に **`WallConfirmBar`**(「ここに壁を置く ✓ / ✕」)が出現。ゴーストはドラッグで微調整可。✓ で `send(move)`、✕ で取消。誤タップ即設置を防ぐ。
- **当たり判定の拡大**: 溝は 14px と細く指には小さいので、`coarse` 時は `computeHover` に**ヒット許容幅**を持たせ(セル帯 `C` を実効的に狭め溝帯を広げる `TOUCH_SLOP`)、狙いやすくする。純関数 `computeHover` に `slop` 引数を追加(既定 0)。
- **レイアウト**: 盤は `min(100vw - 32px, 560px)` で親幅に追従(SVG viewBox はそのまま)。ポートレート主体で HUD 上・盤中央・操作は**下部(親指圏)**。`100dvh` と `env(safe-area-inset-*)` でノッチ対応。`index.html` に `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`。
- **ズーム/スクロール干渉の抑止**: 盤要素に `touch-action: none`(ページ全体は通常スクロール可)。移動・設置時に `navigator.vibrate?.(10)` で軽い触覚フィードバック(任意)。
- **PWA(任意・後段)**: `manifest.webmanifest` + 最小 Service Worker でホーム画面インストール可能に。静的クライアントなのでキャッシュも容易。

## 無料・永続の公開構成(採用: 案B = Cloudflare)

**クライアント(Vite ビルド)は完全静的**で **Cloudflare Pages** に永続無料配信。**WS ルームは Workers + Durable Objects**:

- **1ルーム = 1 Durable Object**(`env.ROOM.idFromName(roomKey)`)。両プレイヤーが自然に同一 DO へ集約されるためルーム管理マップ不要。
- **Hibernatable WebSockets** で休眠中も接続維持・課金最小、メッセージ受信で即復帰 → **コールドスタート体感なし・スケール to ゼロ**。9×9 の BFS は数十μs で CPU 制限に余裕。切断猶予は **DO アラーム**(`storage.setAlarm`)で実装。
- **無料・永続**: Pages も Workers/DO 無料枠(SQLite-backed DO・1GB)も恒久。カード登録は Cloudflare 側の要件に従う(基本無料枠で収まる)。
- **同一オリジン運用**: Pages の Functions/ルーティングで `/ws`・`/quick` を同じ Worker(DO バインディング付き)へ向け、単一ドメイン・同一オリジンにする(CORS 不要)。
- **デプロイ**: `wrangler deploy`(Worker/DO)+ Pages(GitHub 連携で push 自動ビルド、または `wrangler pages deploy dist`)。
- **参考**: [Durable Objects WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/) / [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) / [Real free tiers 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)。
- **フォールバック(不採用・記録のみ)**: Render 無料 Web サービスで Node `ws` 単一サービス公開も可能だが、約15分アイドルでスリープ→初回約1分のコールドスタートがあるため案B を採用。

## GitHub 運用・コミット方針

- リポジトリを初期化し(`.gitignore` に `node_modules`/`dist`/`.env`)、GitHub の**プライベートリポジトリ**へ push(`gh repo create`)。
- **フェーズごとに1コミット**(下記マイルストーン単位)。各コミットは動作する単位(テスト緑 or 手動確認済み)にする。コミット文は日本語可、末尾に規定の Co-Authored-By を付す。
- 任意: GitHub Actions で `npm test`(shared)を CI 実行。公開を案A/Bにする場合はデプロイ Workflow も追加可能(後段)。

## 開発環境の要点

- ルート `package.json`: `"dev":"concurrently -k \"npm -w @quoridor/worker run dev\" \"npm -w @quoridor/client run dev\""`、`"test":"npm -w @quoridor/shared run test && npm -w @quoridor/worker run test"`。
- worker dev: `wrangler dev`(Worker + DO + WS をローカル `:8787` で実行=本番同一ランタイム)。client dev: `vite`(proxy で `/ws`・`/quick`→`localhost:8787`)。
- `shared` は各パッケージから `@quoridor/shared` で参照(workspaces 解決)。worker/client とも TS をそのまま解決(worker は wrangler/esbuild、client は Vite)。

## ビルド順(マイルストーン = コミット単位)

各フェーズ完了時に1コミット(テスト緑 or 手動確認済み)。

- **P0**: GitHub リポジトリ初期化 + モノレポ雛形(workspaces/tsconfig/.gitignore)。→ commit
- **P1**: `shared`(型・ルール・protocol・**Vitest 緑**)。← 正当性を最初に固定。→ commit
- **P2**: `worker`(Cloudflare)最小 — `RoomDO` + `session.ts`(**Vitest 緑**)+ Worker ルーティング。`wrangler dev` で合言葉 WS 2 接続 → `matched`→`move`→`state` 往復。→ commit
- **P3**: `client` 最小(`useGameSocket` + `Board` 描画 + move 送信で 2 タブ同期、モックロジック移植)。→ commit
- **P4**: HUD / 待機画面 / 視点正規化 / last-move / 勝敗演出 + **スマホ操作**(`usePointerKind`/`WallConfirmBar`/レスポンシブ)。→ commit
- **P5**: quickMatch(`LobbyDO`+`/quick`)→ 再接続(token / DO アラーム grace)→ rematch → エラーハンドリング/ポリッシュ。→ commit
- **P6(公開)**: Cloudflare へデプロイ — `wrangler deploy`(Worker/DO)+ Pages(client)、同一オリジンで `/ws`・`/quick` を配線。→ commit

> 補足: 「Sonnet 5 へ切替」はユーザー操作(`/model sonnet`)。実装フェーズ(P0以降)はモデル切替後に着手する。
