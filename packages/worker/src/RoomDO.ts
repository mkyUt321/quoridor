import { isClientMsg, type PlayerId, type ServerMsg } from '@quoridor/shared';
import { Session } from './session.js';

interface Attachment {
  seat: PlayerId;
  token: string;
  name: string;
}

export interface Env {
  ROOM: DurableObjectNamespace;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  ws.send(JSON.stringify(msg));
}

export class RoomDO implements DurableObject {
  private session = new Session();

  constructor(private ctx: DurableObjectState, _env: Env) {}

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

    const opponent = this.other(seat);
    if (opponent) {
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
    } else {
      send(server, { t: 'waiting' });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
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
      this.broadcast({ t: 'state', state: result.value });
      if (result.value.winner !== null) {
        this.broadcast({ t: 'gameOver', winner: result.value.winner, reason: 'goal' });
      }
      return;
    }

    if (parsed.t === 'resign') {
      const state = this.session.resign(att.seat);
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
        this.broadcast({ t: 'rematchAgreed' });
        this.broadcast({ t: 'state', state: this.session.state });
      }
      return;
    }
  }

  webSocketClose(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    const opponent = this.other(att.seat);
    if (opponent) send(opponent.ws, { t: 'opponentLeft', grace: 30 });
  }
}
