const TTL_MS = 30_000;

interface Waiting {
  roomKey: string;
  expiresAt: number;
}

/** シングルトン。待機中の roomKey を最大1つ保持し、先着と次客を同じ roomKey でペアリングする。 */
export class LobbyDO implements DurableObject {
  constructor(private ctx: DurableObjectState) {}

  async fetch(_request: Request): Promise<Response> {
    const waiting = await this.ctx.storage.get<Waiting>('waiting');
    if (waiting && waiting.expiresAt > Date.now()) {
      await this.ctx.storage.delete('waiting');
      return Response.json({ roomKey: waiting.roomKey });
    }

    const roomKey = `q:${crypto.randomUUID()}`;
    await this.ctx.storage.put<Waiting>('waiting', { roomKey, expiresAt: Date.now() + TTL_MS });
    return Response.json({ roomKey });
  }
}
