import { LobbyDO } from './LobbyDO.js';
import { RoomDO, type Env } from './RoomDO.js';

export { LobbyDO, RoomDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/quick') {
      const id = env.LOBBY.idFromName('singleton');
      return env.LOBBY.get(id).fetch(request);
    }

    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room');
      if (!room) return new Response('missing room', { status: 400 });
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(request);
    }

    return new Response('not found', { status: 404 });
  },
};
