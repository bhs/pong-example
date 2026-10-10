'use strict';

/**
 * lib/stubs.js — which demo stubs are switched on.
 *
 * ENABLED_STUBS is a comma-separated list of stub names read as ordinary
 * configuration. Absent or empty, every stub is off and the real
 * implementations run. Production never sets it.
 */

function isStubEnabled(name, env = process.env) {
  return String(env.ENABLED_STUBS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(name);
}

module.exports = { isStubEnabled };
