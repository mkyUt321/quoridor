import {
  bestMoveTowardGoal,
  chooseAiMove,
  isClientMsg,
  type GameState,
  type PlayerId,
  type ServerMsg,
} from '@quoridor/shared';
import { Session } from './session.js';

interface Attachment {
  seat: PlayerId;
  token: string;
  name: string;
}

interface PendingDisconnect {
  seat: PlayerId;
}

interface ClockStorage {
  bankMs: [number, number];
  turnStartedAt: number;
}

const RECONNECT_GRACE_MS = 30_000;
/** 1手ごとに無条件で与えられる無料の持ち時間。この枠内で指せば予備時間は減らない。 */
const FREE_MS = 60_000;
/** 無料枠を超えた分だけ消費される、繰り越し式の予備時間(使った分は戻らない)。 */
const DEFAULT_BANK_MS = 2 * 60_000;

/** CPU 対戦での人間の席。CPU は常に席 1。 */
const HUMAN_SEAT: PlayerId = 0;
const CPU_SEAT: PlayerId = 1;
/** CPU が指すまでの見かけ上の「考慮時間」。即指しは不自然なので少し待たせる。 */
const CPU_MOVE_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  ws.send(JSON.stringify(msg));
}

export class RoomDO implements DurableObject {
  private session = new Session();
  private bankMs: [number, number] = [DEFAULT_BANK_MS, DEFAULT_BANK_MS];
  private turnStartedAt = Date.now();
  /** この部屋が対 CPU 戦か。true の間は席 1 を CPU が担当し、持ち時間は無効化される。 */
  private cpuMode = false;

  constructor(
    private ctx: DurableObjectState,
    _env: Env,
  ) {
    // Durable Object はアイドル時にハイバネートされ、次のアクセスで
    // コンストラクタが再実行される。session と持ち時間はメモリ上だけの
    // 状態なので、復帰のたびに ctx.storage から復元しないと進行状況が
    // 消えてしまう(再接続の有無に関わらず起こりうる)。
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<GameState>('gameState');
      if (saved) this.session.state = saved;
      const clock = await this.ctx.storage.get<ClockStorage>('clock');
      if (clock) {
        this.bankMs = clock.bankMs;
        this.turnStartedAt = clock.turnStartedAt;
      }
      this.cpuMode = (await this.ctx.storage.get<boolean>('cpuMode')) === true;
    });
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put('gameState', this.session.state);
  }

  private async persistClock(): Promise<void> {
    await this.ctx.storage.put<ClockStorage>('clock', {
      bankMs: this.bankMs,
      turnStartedAt: this.turnStartedAt,
    });
  }

  /**
   * 直前の手番(moverSeat)の消費時間を予備時間(bankMs)へ反映し、新しい手番の計測を
   * 開始する。1手には無条件でFREE_MSの無料枠があり、それを超えた分だけ予備時間から
   * 差し引く(使い切らなければ予備時間は減らず、そのまま次の手番へ繰り越される)。
   */
  private tickClock(moverSeat: PlayerId): void {
    const elapsed = Date.now() - this.turnStartedAt;
    const overage = Math.max(0, elapsed - FREE_MS);
    this.bankMs[moverSeat] = Math.max(0, this.bankMs[moverSeat] - overage);
    this.turnStartedAt = Date.now();
  }

  private resetClock(): void {
    this.bankMs = [DEFAULT_BANK_MS, DEFAULT_BANK_MS];
    this.turnStartedAt = Date.now();
  }

  /** その手番で実際に使える持ち時間(無料枠+予備時間の残り)。 */
  private availableMs(seat: PlayerId): number {
    return FREE_MS + this.bankMs[seat];
  }

  private clockMsg(): ServerMsg {
    return {
      t: 'clock',
      remainingMs: [this.availableMs(0), this.availableMs(1)],
      turn: this.session.state.turn,
    };
  }

  private sockets(): { ws: WebSocket; att: Attachment }[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ({ ws, att: ws.deserializeAttachment() as Attachment | null }))
      .filter((s): s is { ws: WebSocket; att: Attachment } => s.att !== null);
  }

  private other(seat: PlayerId): { ws: WebSocket; att: Attachment } | undefined {
    return this.sockets().find((s) => s.att.seat !== seat);
  }

  private broadcast(msg: ServerMsg): void {
    for (const { ws } of this.sockets()) send(ws, msg);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const name = url.searchParams.get('name') ?? '名無し';

    // CPU 対戦は最初の接続の ?cpu=1 で確定し、以後 storage に永続化する
    // (ハイバネート復帰・再接続でも維持されるように)。
    if (url.searchParams.get('cpu') === '1' && !this.cpuMode) {
      this.cpuMode = true;
      await this.ctx.storage.put('cpuMode', true);
    }

    const occupied = new Set(this.sockets().map((s) => s.att.seat));

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // CPU 対戦では人間は席 0 の1人だけ。対人戦では2席まで。
    const full = this.cpuMode ? occupied.has(HUMAN_SEAT) : occupied.size >= 2;
    if (full) {
      this.ctx.acceptWebSocket(server);
      send(server, { t: 'error', code: 'room_full', message: 'この部屋は満員です' });
      server.close(1000, 'room_full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const seat: PlayerId = this.cpuMode ? HUMAN_SEAT : occupied.has(0) ? 1 : 0;
    const token = crypto.randomUUID();
    server.serializeAttachment({ seat, token, name } satisfies Attachment);
    this.ctx.acceptWebSocket(server, [`seat:${seat}`]);
    await this.clearPendingDisconnect(seat);

    if (this.cpuMode) {
      // 相手(CPU)の接続を待たずに即マッチ成立。持ち時間は無効なので clock は送らない。
      send(server, {
        t: 'matched',
        you: HUMAN_SEAT,
        token,
        opponent: 'CPU',
        state: this.session.state,
      });
      // 進行中局面での再接続で、既に手番が CPU 側なら詰まらないようここで指させる
      // (応答を返す前にブロックしないよう遅延なしで実行)。
      await this.runCpuTurn(0);
      return new Response(null, { status: 101, webSocket: client });
    }

    const opponent = this.other(seat);
    if (opponent) {
      const freshGame = this.session.state.last === null && this.session.state.winner === null;
      if (freshGame) {
        this.turnStartedAt = Date.now();
        await this.persistClock();
      }
      send(server, {
        t: 'matched',
        you: seat,
        token,
        opponent: opponent.att.name,
        state: this.session.state,
      });
      send(opponent.ws, {
        t: 'matched',
        you: opponent.att.seat,
        token: opponent.att.token,
        opponent: name,
        state: this.session.state,
      });
      this.broadcast(this.clockMsg());
    } else {
      send(server, { t: 'waiting' });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * 手番が CPU(席1)なら一手指して結果をブロードキャストする。delayMs > 0 のときは
   * 見かけ上の思考時間として少し待ってから指す。CPU 対戦以外・手番でない・決着済みの
   * ときは何もしない。
   */
  private async runCpuTurn(delayMs: number): Promise<void> {
    if (!this.cpuMode) return;
    if (this.session.state.winner !== null) return;
    if (this.session.state.turn !== CPU_SEAT) return;

    if (delayMs > 0) await sleep(delayMs);

    const move = chooseAiMove(this.session.state, CPU_SEAT, { rng: Math.random });
    const result = this.session.move(move, CPU_SEAT);
    if (!result.ok) return;

    await this.persistState();
    this.broadcast({ t: 'state', state: result.value });
    if (result.value.winner !== null) {
      this.broadcast({ t: 'gameOver', winner: result.value.winner, reason: 'goal' });
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      send(ws, { t: 'error', code: 'bad_json', message: 'invalid message' });
      return;
    }
    if (!isClientMsg(parsed)) {
      send(ws, { t: 'error', code: 'bad_message', message: 'unknown message' });
      return;
    }

    if (parsed.t === 'move') {
      const result = this.session.move(parsed.move, att.seat);
      if (!result.ok) {
        send(ws, { t: 'error', code: 'illegal_move', message: result.error });
        return;
      }
      if (!this.cpuMode) this.tickClock(att.seat);
      await this.persistState();
      if (!this.cpuMode) await this.persistClock();
      this.broadcast({ t: 'state', state: result.value });
      if (!this.cpuMode) this.broadcast(this.clockMsg());
      if (result.value.winner !== null) {
        this.broadcast({ t: 'gameOver', winner: result.value.winner, reason: 'goal' });
        return;
      }
      // 人間の手が決着でなければ、CPU の応手を(思考時間ぶん待ってから)返す。
      await this.runCpuTurn(CPU_MOVE_DELAY_MS);
      return;
    }

    if (parsed.t === 'resign') {
      const state = this.session.resign(att.seat);
      await this.persistState();
      this.broadcast({ t: 'state', state });
      if (state.winner !== null) {
        this.broadcast({ t: 'gameOver', winner: state.winner, reason: 'resign' });
      }
      return;
    }

    if (parsed.t === 'rematch') {
      if (this.cpuMode) {
        // CPU 対戦の「もう一局」は相手の同意を待たず即リセット。人間(席0)が先手なので
        // ここで CPU が指すことはない。
        this.session.reset();
        await this.persistState();
        this.broadcast({ t: 'rematchAgreed' });
        this.broadcast({ t: 'state', state: this.session.state });
        return;
      }
      const vote = this.session.requestRematch(att.seat);
      if (vote === 'offered') {
        const opponent = this.other(att.seat);
        if (opponent) send(opponent.ws, { t: 'rematchOffered' });
      } else {
        this.resetClock();
        await this.persistState();
        await this.persistClock();
        this.broadcast({ t: 'rematchAgreed' });
        this.broadcast({ t: 'state', state: this.session.state });
        this.broadcast(this.clockMsg());
      }
      return;
    }

    if (parsed.t === 'rejoin') {
      await this.handleRejoin(ws, att);
      return;
    }

    if (parsed.t === 'claimTimeout') {
      await this.handleClaimTimeout();
      return;
    }
  }

  /**
   * クライアントからの「手番側の持ち時間が切れた」という申告をサーバ側で再計算して検証する。
   * 時間切れは対局を終わらせず、ゴールへの最短経路のマスへ自動的に一手進めて手番を渡す
   * (ゲーム性を保つため、即敗北にはしない)。時間切れが続く限り、その席は以後も
   * 自動移動が繰り返される。
   */
  private async handleClaimTimeout(): Promise<void> {
    if (this.session.state.winner !== null) return;
    const mover = this.session.state.turn;
    const elapsed = Date.now() - this.turnStartedAt;
    const effectiveRemaining = this.availableMs(mover) - elapsed;
    if (effectiveRemaining > 0) return;

    const to = bestMoveTowardGoal(this.session.state, mover);
    const result = this.session.move({ type: 'pawn', to }, mover);
    if (!result.ok) return;

    this.tickClock(mover);
    await this.persistState();
    await this.persistClock();
    this.broadcast({ t: 'state', state: result.value });
    this.broadcast(this.clockMsg());
    if (result.value.winner !== null) {
      this.broadcast({ t: 'gameOver', winner: result.value.winner, reason: 'goal' });
    }
  }

  private async clearPendingDisconnect(seat: PlayerId): Promise<void> {
    const pending = await this.ctx.storage.get<PendingDisconnect>('pendingDisconnect');
    if (!pending || pending.seat !== seat) return;
    await this.ctx.storage.delete('pendingDisconnect');
    await this.ctx.storage.deleteAlarm();
  }

  private async handleRejoin(ws: WebSocket, att: Attachment): Promise<void> {
    await this.clearPendingDisconnect(att.seat);
    send(ws, { t: 'state', state: this.session.state });
    if (!this.cpuMode) send(ws, this.clockMsg());
    const opponent = this.other(att.seat);
    if (opponent) send(opponent.ws, { t: 'opponentBack' });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    // CPU 対戦には切断猶予・自動投了はない。人間が離脱しても局面は storage に残り、
    // 同じ部屋へ再接続すれば続きから再開できる(放置されればそのまま消える)。
    if (this.cpuMode) return;
    const opponent = this.other(att.seat);
    if (!opponent || this.session.state.winner !== null) return;

    send(opponent.ws, { t: 'opponentLeft', grace: RECONNECT_GRACE_MS / 1000 });
    await this.ctx.storage.put<PendingDisconnect>('pendingDisconnect', { seat: att.seat });
    await this.ctx.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
  }

  /**
   * 猶予時間(RECONNECT_GRACE_MS)内に再接続がなければ、相手の接続切れが確定したと
   * 判断し、投了(resign)と全く同じ処理で決着させる。
   */
  async alarm(): Promise<void> {
    const pending = await this.ctx.storage.get<PendingDisconnect>('pendingDisconnect');
    if (!pending) return;
    await this.ctx.storage.delete('pendingDisconnect');
    if (this.session.state.winner !== null) return;

    // 猶予中に同じ席へ生きた接続が戻っていれば、実際には再接続済みなので何もしない。
    const stillDisconnected = !this.sockets().some((s) => s.att.seat === pending.seat);
    if (!stillDisconnected) return;

    const state = this.session.resign(pending.seat);
    await this.persistState();
    this.broadcast({ t: 'state', state });
    if (state.winner !== null) {
      this.broadcast({ t: 'gameOver', winner: state.winner, reason: 'resign' });
    }
  }
}
