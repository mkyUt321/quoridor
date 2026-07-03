import { RoomDO, type Env } from './RoomDO.js';

export { RoomDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room');
      if (!room) return new Response('missing room', { status: 400 });
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(request);
    }

    return new Response('not found', { status: 404 });
  },
};
