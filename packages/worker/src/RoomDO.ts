import { bestMoveTowardGoal, isClientMsg, type GameState, type PlayerId, type ServerMsg } from '@quoridor/shared';
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
  remainingMs: [number, number];
  turnStartedAt: number;
}

const RECONNECT_GRACE_MS = 30_000;
const DEFAULT_TIME_MS = 10 * 60 * 1000;

export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  ws.send(JSON.stringify(msg));
}

export class RoomDO implements DurableObject {
  private session = new Session();
  private remainingMs: [number, number] = [DEFAULT_TIME_MS, DEFAULT_TIME_MS];
  private turnStartedAt = Date.now();

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
        this.remainingMs = clock.remainingMs;
        this.turnStartedAt = clock.turnStartedAt;
      }
    });
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put('gameState', this.session.state);
  }

  private async persistClock(): Promise<void> {
    await this.ctx.storage.put<ClockStorage>('clock', {
      remainingMs: this.remainingMs,
      turnStartedAt: this.turnStartedAt,
    });
  }

  /** 直前の手番(moverSeat)が消費した時間を差し引き、新しい手番の計測を開始する。 */
  private tickClock(moverSeat: PlayerId): void {
    const elapsed = Date.now() - this.turnStartedAt;
    this.remainingMs[moverSeat] = Math.max(0, this.remainingMs[moverSeat] - elapsed);
    this.turnStartedAt = Date.now();
  }

  private resetClock(): void {
    this.remainingMs = [DEFAULT_TIME_MS, DEFAULT_TIME_MS];
    this.turnStartedAt = Date.now();
  }

  private clockMsg(): ServerMsg {
    return { t: 'clock', remainingMs: [...this.remainingMs], turn: this.session.state.turn };
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

    const occupied = new Set(this.sockets().map((s) => s.att.seat));

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (occupied.size >= 2) {
      this.ctx.acceptWebSocket(server);
      send(server, { t: 'error', code: 'room_full', message: 'この部屋は満員です' });
      server.close(1000, 'room_full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const seat: PlayerId = occupied.has(0) ? 1 : 0;
    const token = crypto.randomUUID();
    server.serializeAttachment({ seat, token, name } satisfies Attachment);
    this.ctx.acceptWebSocket(server, [`seat:${seat}`]);
    await this.clearPendingDisconnect(seat);

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
      this.tickClock(att.seat);
      await this.persistState();
      await this.persistClock();
      this.broadcast({ t: 'state', state: result.value });
      this.broadcast(this.clockMsg());
      if (result.value.winner !== null) {
        this.broadcast({ t: 'gameOver', winner: result.value.winner, reason: 'goal' });
      }
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
    const effectiveRemaining = this.remainingMs[mover] - elapsed;
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
    send(ws, this.clockMsg());
    const opponent = this.other(att.seat);
    if (opponent) send(opponent.ws, { t: 'opponentBack' });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    const opponent = this.other(att.seat);
    if (!opponent || this.session.state.winner !== null) return;

    send(opponent.ws, { t: 'opponentLeft', grace: RECONNECT_GRACE_MS / 1000 });
    await this.ctx.storage.put<PendingDisconnect>('pendingDisconnect', { seat: att.seat });
    await this.ctx.storage.setAlarm(Date.now() + RECONNECT_GRACE_MS);
  }

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
      this.broadcast({ t: 'gameOver', winner: state.winner, reason: 'disconnect' });
    }
  }
}
