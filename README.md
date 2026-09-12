# Quoridor

ボードゲーム **Quoridor(コリドール)** を、ブラウザで遊べるオンライン対戦アプリとして実装したものです。
9×9 の盤で 2 人が交互に「駒を 1 マス動かす」か「壁を 1 枚置く」を選び、先に相手側の対辺へ到達した方が勝ちです。

すべての着手は **サーバ側(Cloudflare Durable Object)で検証** され、正規化された対局状態がブロードキャストされます。
クライアントは受け取った状態を唯一の真実として描画し、入力の先読み(合法手のハイライト)だけを担当します。

**デモ: <https://quoridor-worker.mkyut321.workers.dev/>**

---

## 主な機能

### 3 つの対戦モード

| モード | 入り方 | 部屋の決まり方 |
| --- | --- | --- |
| あいことば対戦 | 2 人が同じあいことばを入力 | あいことばがそのまま部屋キー(`p:<あいことば>`)になり、同じ Durable Object へ合流する |
| ランダム対戦 | ボタン 1 つ | `POST /quick` でロビーが部屋キーを払い出し、先着と次の 1 人を同じ部屋へ入れる(待機の有効期限 30 秒) |
| CPU 対戦 | ボタン 1 つ | 毎回新しい部屋(`cpu:<uuid>`)を作り、人間が先手(席 0)、CPU が後手(席 1)になる |

URL の共有やアカウント登録は不要です。ニックネームは自動生成され、`localStorage` に保存されます。

### 実装しているルール

- 9×9 の盤。駒は互いの対辺中央(行 8 / 行 0 の中央列)から始まり、相手側の対辺の行(どのマスでもよい)に到達すれば勝ち。
- 壁は 1 人 10 枚。1 手につき「駒の移動」または「壁の設置」のどちらか一方のみ。
- 壁は 2 マス分の長さで溝に置き、**重なり(同じ向きの隣接・同一位置)と交差(同じ交点での H と V)は禁止**。
- **完全封鎖の禁止**: 設置後に BFS で両プレイヤーのゴールへの経路を検証し、どちらかの経路が残らない置き方は拒否されます。
- **ジャンプ**: 相手の駒が隣接しているとき、その真後ろが空いていれば飛び越えて進めます。真後ろが壁や盤外なら斜めへ回り込みます。

### 対局まわり

- **モードレスな盤面操作**: マス上のクリック/タップは駒の移動、溝の上は壁の設置。壁の向きは溝の種類から自動で決まり、最寄りのスロットへスナップします。置く前に合法/不正を色で提示するため「置いてからエラー」が起きません。
- **タッチ操作**: 溝の当たり判定を広げ、壁はゴースト表示 →「✓ / ✕」の 2 段階で確定します(誤タップ防止)。
- **視点の正規化**: 盤面はどちらのプレイヤーでも自分の駒が手前(下)に来るよう 180° 回転して描画されます。
- **持ち時間(対人戦のみ)**: 1 手ごとに無料の 60 秒があり、それを超えた分だけ繰り越し式の予備時間(初期 2 分)から引かれます。使い切っても負けにはならず、**ゴールへの最短経路に向けて 1 手自動で進み**手番が移ります。クライアントの申告をサーバが自前の時刻で再計算して検証します。CPU 対戦に持ち時間はありません。
- **再接続**: トークンを `sessionStorage` に保存し、切断時は指数バックオフで再接続して対局へ復帰します。対人戦では相手の切断から 30 秒の猶予(Durable Object のアラーム)があり、戻らなければ投了と同じ扱いで決着します。CPU 対戦には猶予も自動投了もなく、局面はストレージに残るので同じ部屋へ戻れば続きから再開できます。
- **自動レース**: 双方が壁を使い切った局面は、選ぶべき手が最短経路の一手だけに定まるため、全モードで 0.5 秒間隔の自動進行に切り替わり決着まで進みます。
- **もう一局**: あいことば対戦は両者の合意で再戦、ランダム対戦は改めて相手を探し直し、CPU 対戦は同じ部屋を即リセットします。

---

## アーキテクチャ

npm workspaces による TypeScript モノレポで、**ゲームのルールと通信の型を `shared` に置き、サーバとクライアントの両方が同じコードを使います**。

```
ブラウザ (React + Vite / SVG 盤面)
      │  WebSocket  /ws?room=<key>&name=<nick>[&cpu=1]
      │  HTTP       POST /quick(ランダム対戦のペアリング)
      ▼
Cloudflare Worker (packages/worker/src/index.ts)  ── 静的アセット (client/dist) も同一オリジンで配信
      ├── LobbyDO  (シングルトン) : 待機中の部屋キーを 1 つ保持しペアリング
      └── RoomDO   (1 部屋 = 1 DO) : 権威ある GameState / 持ち時間 / CPU の応手
                    │
                    └── @quoridor/shared : applyMove・合法手判定・BFS・AI(クライアントと共用)
```

### 各パッケージの役割

- **`packages/shared`** — ゲームロジックと型の唯一の置き場。純粋関数のみで、ランタイムに依存しません。
  - `types.ts` / `protocol.ts`: `GameState`・`Move` などの型と、WebSocket メッセージの判別可能 union + 型ガード。
  - `rules.ts`: `canStep` / `legalPawnMoves` / `hasPath`(BFS)/ `wallConflict` / `wallLegal` / `shortestPathLength` / `bestMoveTowardGoal`。
  - `game.ts`: `createInitialState` と `applyMove`。**`applyMove` が着手検証の単一の入口**で、不正手は `Result` の失敗として返ります。
  - `ai.ts`: CPU 対戦の思考ルーチン(後述)。
  - ビルド成果物を持たず `src/index.ts` をそのまま公開しているため、worker 側は wrangler(esbuild)、client 側は Vite が直接取り込みます。
- **`packages/worker`** — Cloudflare Workers + Durable Objects。
  - `index.ts`: ルーティングのみ。`POST /quick` → `LobbyDO`、`/ws?room=…` → 部屋キーから `idFromName` で解決した `RoomDO`、それ以外は `ASSETS`(クライアントのビルド成果物)。
  - `RoomDO.ts`: 1 部屋 1 インスタンス。Hibernatable WebSocket(`acceptWebSocket` + `serializeAttachment` に席・トークン・名前を保持)で休眠中も接続を維持し、`GameState`・持ち時間・CPU モードをストレージへ永続化します(休眠から復帰したときはコンストラクタで復元)。切断猶予はアラームで実装。
  - `LobbyDO.ts`: シングルトンの DO。待機中の部屋キーを最大 1 つだけ保持し、先着と次の 1 人に同じキーを返します。単一スレッドなので競合しません。
  - `session.ts`: DO から切り離した対局セッションの中核(`applyMove` の呼び出し・投了・再戦・リセット)。Wrangler なしで単体テストできます。
- **`packages/client`** — React 18 + Vite、盤面は SVG。
  - `net/useGameSocket.ts`: 接続・再接続・受信メッセージの状態集約を 1 つのフックに閉じ込めています。サーバから受け取った `state` が唯一の真実で、楽観更新はゴースト表示に留めています。
  - `components/Board.tsx` と `game/geometry.ts` / `game/interaction.ts`: 座標計算・ホバー判定・視点反転を純粋関数として分離。`shared` の `legalPawnMoves` / `wallLegal` をクライアントでも実行して合法性を即座に色で返します。

### 配信構成

クライアントは Worker の `[assets]` バインディング経由で配信されるため、ページも `/ws`・`/quick` もすべて同一オリジンです(CORS 設定は不要)。

---

## CPU 対戦(AI)の考え方

`packages/shared/src/ai.ts` にあり、**カジュアルに遊べる速さ**を優先した設計です。強豪 AI ではありません。

- **探索**: alpha-beta 枝刈り付きのミニマックス(最大深さ 4)。
- **評価関数**: `(相手のゴールまでの最短距離 − 自分のゴールまでの最短距離) × 10 + 残り壁数の差`。距離は壁を考慮した BFS で求めます。勝敗が確定した局面は ±1,000,000。
- **壁候補の絞り込み**: 128 通りすべてを毎ノードで検証すると重いため、相手の駒からチェビシェフ距離 2 以内、自分の駒から 1 以内のアンカーだけを候補にし、`wallLegal`(内部で BFS を 2 回)を通ったものを使います。
- **ノード数予算による打ち切り**: 時間ではなく**探索ノード数**(既定 10,000)で制御します。Cloudflare Workers は 1 回の同期実行中 `Date.now()` / `performance.now()` の値が進まないため、時間ベースの打ち切りが機能しないという実測上の制約に合わせたものです。
- **段階的縮退**: 予算が尽きた枝はそこで静的評価に切り替えるだけで、探索結果を丸ごと捨てて浅い深さへ戻すことはしません。有望な手(ゴールに近づく駒の移動)から順に並べ替えて調べるため、予算が潤沢なうちに有力手が深く読まれます。
- **ルートでの予算配分**: 候補手へ予算を均等に割り振ります。単純に使い回すと駒の移動だけが深く読まれ、壁がほとんど選ばれなくなるためです。壁候補は静的評価で上位 6 件に絞ってから本探索にかけます。
- **足踏みの抑止**: 直近 3 手で自分がいたマスへ戻る手には減点を与えます(禁じ手ではないので、本当に最善なら選ばれます)。
- **終盤の扱い**: CPU が壁を使い切ったら探索せずに最短経路を進み、さらに「壁は経路を短くしない」ことから、最短距離の比較で既に負けが確定している場合は投了します。
- **ばらつき**: 同点の最善手が複数あるときは乱数で選ぶため、毎局まったく同じ進行にはなりません(乱数を渡さなければ決定的になり、テストで利用しています)。

サーバ側では、見かけ上の思考時間として 0.6 秒待ってから着手します。

---

## ローカルでの開発

必要なもの: Node.js と npm(npm workspaces を使用。Node.js v24.18.0 で動作を確認しています)。

```bash
# 依存関係のインストール(リポジトリのルートで実行)
npm install

# 開発サーバ(wrangler dev:8787 と vite を同時起動)
npm run dev

# テスト(shared と worker の Vitest)
npm test

# 本番ビルド(クライアントを packages/client/dist へ出力)
npm run build
```

`npm run dev` は Wrangler(Worker + Durable Objects + WebSocket をローカルで本番と同じランタイムで実行、`localhost:8787`)と Vite を並行起動します。**ブラウザで開くのは Vite が表示する URL**です。Vite の `server.proxy` が `/ws` と `/quick` を `localhost:8787` へ転送します。

型チェックは各パッケージに用意しています。

```bash
npm -w @quoridor/shared run typecheck
npm -w @quoridor/worker run typecheck
npm -w @quoridor/client run typecheck
```

2 人対戦の動作確認は、ブラウザのタブを 2 つ開いて同じあいことばを入力するのが手軽です。

---

## テスト

Vitest を使用しています(`npm test` で `shared` → `worker` の順に実行)。

| パッケージ | ファイル | 件数 | 主な内容 |
| --- | --- | --- | --- |
| `shared` | `rules.test.ts` | 24 | 直進/ジャンプ/斜め、壁の重なり・交差、BFS による封鎖判定、壁の合法性、最短経路 |
| `shared` | `game.test.ts` | 11 | 初期状態、手番違いの拒否、駒/壁の着手適用、勝利判定 |
| `shared` | `ai.test.ts` | 13 | 評価関数、常に合法手を返すこと、AI 同士の対局が必ず決着すること、足踏み抑止 |
| `worker` | `session.test.ts` | 6 | 手番の拒否、勝敗、投了、再戦 |

合計 54 件です。個別に走らせる場合は次のようにします。

```bash
npm -w @quoridor/shared run test
npm -w @quoridor/worker run test
```

---

## デプロイ(Cloudflare)

クライアントの静的アセットも Worker から配信するため、デプロイ先は Worker 1 つだけです。

1. Cloudflare アカウントを用意し、Wrangler で認証します(`npx wrangler login`、または CI では `CLOUDFLARE_API_TOKEN` 環境変数)。
2. `packages/worker/wrangler.toml` の `name` を自分のワーカー名に変更します。アカウント固有の値(`account_id` など)はリポジトリに含めず、Wrangler の認証情報や環境変数で与えてください。
3. クライアントをビルドします(`[assets]` が参照する `packages/client/dist` を作るため、デプロイ前に必須です)。

   ```bash
   npm run build
   ```

4. Worker をデプロイします。

   ```bash
   npm -w @quoridor/worker run deploy   # 実体は wrangler deploy
   ```

Durable Objects(`RoomDO` / `LobbyDO`)のマイグレーションは `wrangler.toml` に定義済みで、初回デプロイ時に適用されます。秘密情報が必要になった場合は `wrangler secret put` を使い、ローカルの `.dev.vars` は `.gitignore` 済みです。

---

## ディレクトリ構成

```
quoridor/
├── package.json               # npm workspaces / dev・build・test スクリプト
├── tsconfig.base.json         # strict, ES2022, noUncheckedIndexedAccess
├── docs/
│   └── IMPLEMENTATION_PLAN.md # 初期の実装プラン(設計の経緯)
└── packages/
    ├── shared/                # ゲームロジック・型・AI(worker と client で共用)
    │   └── src/
    │       ├── types.ts  rules.ts  game.ts  protocol.ts  ai.ts  index.ts
    │       └── rules.test.ts  game.test.ts  ai.test.ts
    ├── worker/                # Cloudflare Worker + Durable Objects
    │   ├── wrangler.toml
    │   └── src/
    │       ├── index.ts  RoomDO.ts  LobbyDO.ts  session.ts
    │       └── session.test.ts
    └── client/                # React + Vite(SVG 盤面)
        ├── index.html  vite.config.ts
        └── src/
            ├── App.tsx  main.tsx  styles.css  nickname.ts  usePointerKind.ts
            ├── components/    # Home, Game, Board, Hud, Waiting, WallConfirmBar ほか
            ├── game/          # geometry.ts, interaction.ts(座標・ホバー判定)
            └── net/           # useGameSocket.ts(WebSocket 接続と状態集約)
```

`docs/IMPLEMENTATION_PLAN.md` は初期の設計計画です。CPU 対戦と持ち時間はそこでは対象外としていましたが、その後に追加されています。現状の仕様はこの README とコードが正です。
