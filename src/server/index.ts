import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { z } from 'zod';
import {
  isAuthenticated, issueSession, originAllowed, passwordsEqual, readAuthConfig,
  SESSION_COOKIE, sessionCookie, sessionValid,
} from './auth';
import { createArenaRoom, roomMetrics } from './room';

try { process.loadEnvFile(); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

const config = readAuthConfig(process.env);
const port = z.coerce.number().int().min(1).max(65_535).parse(process.env.PORT ?? 3000);
const maxRooms = z.coerce.number().int().min(1).max(100).parse(process.env.MAX_ROOMS ?? 4);
const httpServer = createServer();
const loginAttempts = new Map<string, { attempts: number; resetAt: number }>();
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | null = null;

const transport = new WebSocketTransport({
  server: httpServer,
  maxPayload: 2_048,
  beforeUpgrade: (request) => {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== request.headers.get('host')) return new Response(null, { status: 403 });
    const token = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? '';
    if (!sessionValid(token, config)) return new Response(null, { status: 401 });
  },
});

const gameServer = new Server({
  transport, greet: false, gracefullyShutdown: false, auth: false,
  express: async (app) => {
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '2kb' }));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/api/session', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ authenticated: isAuthenticated(req, config), passwordRequired: true });
    });
    app.post('/api/login', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!originAllowed(req)) { res.status(403).json({ error: 'Use the game’s own login page.' }); return; }
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      let attempts = loginAttempts.get(ip);
      if (!attempts || now > attempts.resetAt) {
        attempts = { attempts: 0, resetAt: now + 60_000 };
        if (loginAttempts.size > 1_000) loginAttempts.clear();
        loginAttempts.set(ip, attempts);
      }
      if (attempts.attempts >= 10) { res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' }); return; }
      attempts.attempts += 1;
      const login = z.object({ password: z.string().max(256) }).safeParse(req.body);
      if (!login.success || !passwordsEqual(login.data.password, config.password)) {
        res.status(401).json({ error: 'That password did not match. Try again.' }); return;
      }
      loginAttempts.delete(ip);
      res.setHeader('Set-Cookie', sessionCookie(issueSession(config), config));
      res.json({ authenticated: true });
    });
    app.get('/api/metrics', (req, res) => {
      if (!isAuthenticated(req, config)) { res.status(401).json({ error: 'Authentication required.' }); return; }
      res.json({ ...roomMetrics, maxRooms, averageTickMs: roomMetrics.ticks ? roomMetrics.totalTickMs / roomMetrics.ticks : 0, memory: process.memoryUsage().rss });
    });
    if (!config.production) {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
      app.use(vite.middlewares);
      app.get('/', async (req, res, next) => {
        try {
          const template = await readFile(path.resolve('index.html'), 'utf8');
          res.type('html').send(await vite!.transformIndexHtml(req.originalUrl, template));
        } catch (error) { next(error); }
      });
    } else {
      const clientDirectory = path.resolve('dist/client');
      app.use(express.static(clientDirectory, { maxAge: '1h', index: false }));
      app.get('/', (_req, res) => res.sendFile('index.html', { root: clientDirectory }));
    }
    app.use((_req, res) => res.status(404).json({ error: 'Page not found.' }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = error instanceof SyntaxError ? 400 : 500;
      if (status === 500) process.stderr.write(`${JSON.stringify({ level: 'error', event: 'request_failed', message: error instanceof Error ? error.message : String(error) })}\n`);
      res.status(status).json({ error: status === 400 ? 'Invalid request.' : 'Something went wrong. Please try again.' });
    });
  },
});

gameServer.define('arena', createArenaRoom({ auth: config, maxRooms }));
await gameServer.serverless();

// Gate the HTTP transport itself: Colyseus handles matchmaking before Express.
// An Express-only guard would leave its seat-reservation endpoints exposed.
const requestHandlers = httpServer.listeners('request');
httpServer.removeAllListeners('request');
httpServer.on('request', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.url?.startsWith('/matchmake')) {
    if (!originAllowed(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Origin not allowed.' })); return; }
    if (!isAuthenticated(req, config)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Enter the arena password first.' })); return; }
  }
  for (const handler of requestHandlers) handler.call(httpServer, req, res);
});

httpServer.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'server_ready', url: `http://localhost:${port}`, maxRooms, mode: config.production ? 'production' : 'development' })}\n`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await gameServer.gracefullyShutdown(false);
  await vite?.close();
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
