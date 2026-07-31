// Vercel serverless entry point (see vercel.json's /api/(.*) rewrite).
// Vercel's Node runtime accepts a default-exported (req, res) handler, and
// an Express app satisfies that signature directly, so no adapter is needed.
// `server.ts` skips app.listen() here because it detects VERCEL=1.
import app from '../server';

export default app;
