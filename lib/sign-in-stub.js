'use strict';

/**
 * lib/sign-in-stub.js — demo stand-in for Google sign-in (stub name
 * "google-sign-in", enabled through ENABLED_STUBS, see lib/stubs.js).
 *
 * Implements the SignIn interface (see the "SignIn interface" block in server.js) beside
 * the real Google OAuth routes, with the same two endpoints:
 *
 *   GET /auth/google           Instead of redirecting to Google, shows a
 *                              picker over the users in the database (the
 *                              people the seed creates).
 *   GET /auth/google/callback  ?user=<id> logs that user in, counts
 *                              'user_login' and redirects to "/".
 *
 * It needs no Google credentials and no registered redirect URI.
 */

const STUB_NAME = 'google-sign-in';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderPicker(users) {
  const items = users.map((u) => {
    const label = u.nickname || u.name || u.email || u.id;
    const detail = u.email ? ` <small>${escapeHtml(u.email)}</small>` : '';
    return `<li><a href="/auth/google/callback?user=${encodeURIComponent(u.id)}">${escapeHtml(label)}</a>${detail}</li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Demo sign-in</title>
<style>body{font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem}li{margin:.4rem 0}small{color:#666}</style>
</head><body>
<h1>Demo sign-in</h1>
<p>Stand-in for Google sign-in. Pick a player to continue as.</p>
${users.length ? `<ul>\n${items}\n</ul>` : '<p>No players yet — run the seed.</p>'}
<p><a href="/">Back to the game</a></p>
</body></html>`;
}

function registerStubSignIn(app, prisma, telemetry) {
  app.get('/auth/google', async (req, res, next) => {
    try {
      const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
      return res.status(200).type('html').send(renderPicker(users));
    } catch (err) {
      return next(err);
    }
  });

  app.get('/auth/google/callback', async (req, res, next) => {
    const id = req.query && req.query.user;
    if (typeof id !== 'string' || !id) return res.redirect('/?login=failed');
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.redirect('/?login=failed');
      return req.login(user, (err) => {
        if (err) return next(err);
        telemetry.recordServerEvent('user_login', req);
        return res.redirect('/');
      });
    } catch (err) {
      return next(err);
    }
  });
}

module.exports = { STUB_NAME, registerStubSignIn };
