// socket.io-клієнт до namespace /live. JWT іде в handshake.auth.token (сервер перевіряє підпис і кладе сокет у кімнати).
// Чекаємо на перевірку базової адреси, бо вона може змінитись з :8080 на :3000.
import { io, Socket } from 'socket.io-client';
import { getAccessToken, getAuthState } from './auth';
import { ensureProbed, getBaseUrl } from './baseUrl';

export async function connectLive(): Promise<Socket> {
  await ensureProbed();
  const token = getAccessToken() ?? '';
  const displayName = getAuthState().user?.displayName ?? 'anon';
  return io(`${getBaseUrl()}/live`, {
    auth: { token, displayName },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 3,
  });
}
