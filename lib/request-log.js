'use strict';

/**
 * lib/request-log.js — structured (one JSON object per line) request logging.
 *
 *   requestLogger(write)  middleware: assigns a request id (or takes the
 *                         incoming X-Request-Id), echoes it in the response
 *                         header and writes an access line when the response
 *                         finishes.
 *   errorLogger(write)    error middleware: writes one "error" line (message
 *                         and stack, same request_id) and answers 500.
 *
 * `write` receives one finished line (without newline); the default writes
 * straight to standard output so each line appears as it happens. Request
 * bodies, headers and cookies are never logged.
 */

const crypto = require('crypto');

function defaultWrite(line) {
  process.stdout.write(line + '\n');
}

function pathOf(req) {
  const url = req.originalUrl || req.url || '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function requestId(req) {
  const incoming = req.headers && req.headers['x-request-id'];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)) return value;
  return crypto.randomUUID();
}

function emit(write, fields) {
  try {
    write(JSON.stringify(fields));
  } catch (e) {
    // Logging must never break a request.
  }
}

function requestLogger(write = defaultWrite) {
  return function requestLogMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const id = requestId(req);
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    const method = req.method;
    const path = pathOf(req);

    let logged = false;
    const done = () => {
      if (logged) return;
      logged = true;
      emit(write, {
        time: new Date().toISOString(),
        level: 'info',
        msg: 'request completed',
        request_id: id,
        method,
        path,
        status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
      });
    };
    res.on('finish', done);
    res.on('close', done);
    next();
  };
}

function errorLogger(write = defaultWrite) {
  // eslint-disable-next-line no-unused-vars
  return function errorLogMiddleware(err, req, res, next) {
    const error = err instanceof Error ? err : new Error(String(err));
    emit(write, {
      time: new Date().toISOString(),
      level: 'error',
      msg: 'unhandled error',
      request_id: req.requestId,
      method: req.method,
      path: pathOf(req),
      error: error.message,
      stack: error.stack,
    });
    if (res.headersSent) {
      return req.socket && req.socket.destroy();
    }
    const status = Number.isInteger(err && err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
  };
}

module.exports = { requestLogger, errorLogger };
