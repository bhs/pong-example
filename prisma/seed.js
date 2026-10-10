'use strict';

/**
 * prisma/seed.js — fills an empty database with fictional players for demos.
 *
 *   npm run seed
 *
 * Run by hand (never at startup). Idempotent: players are upserted and their
 * game history is replaced. These are the people the demo's sign-in picker
 * offers.
 */

const prisma = require('../lib/prisma');

const PLAYERS = [
  ['Avery Lindqvist', 'avery.lindqvist', 'Rally King'],
  ['Bao Tran', 'bao.tran', null],
  ['Carmen Ortega', 'carmen.ortega', 'Topspin'],
  ['Dmitri Volkov', 'dmitri.volkov', null],
  ['Esi Mensah', 'esi.mensah', 'Esi M'],
  ['Farah Haddad', 'farah.haddad', null],
  ['Gustav Berg', 'gustav.berg', 'Gus'],
  ['Hana Kobayashi', 'hana.kobayashi', null],
  ['Imani Okafor', 'imani.okafor', 'Smash'],
  ['Jonas Weber', 'jonas.weber', null],
  ['Keiko Ito', 'keiko.ito', null],
  ['Liam Doyle', 'liam.doyle', 'Paddle Pal'],
];

const THEMES = ['dark', 'light', 'neon'];
const BG_COLORS = ['#00008b', '#000000', '#1a3d1a'];
const COLORS = ['#ffffff', '#ff5555', '#55ff55', '#5599ff'];

// Small deterministic generator (LCG) so every run writes the same data.
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

async function main() {
  const rand = makeRandom(20240501);
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  let games = 0;
  let scores = 0;

  for (let i = 0; i < PLAYERS.length; i += 1) {
    const [name, handle, nickname] = PLAYERS[i];
    const id = `demo-player-${String(i + 1).padStart(2, '0')}`;
    const data = {
      email: `${handle}@example.com`,
      name,
      avatar: null,
      nickname,
    };

    await prisma.user.upsert({ where: { id }, update: data, create: { id, ...data } });

    // A few players keep default preferences; the rest have saved settings.
    if (i % 3 !== 2) {
      const pref = { theme: THEMES[i % THEMES.length], soundEnabled: i % 4 !== 1, paddleColor: COLORS[i % COLORS.length],
        ballColor: COLORS[(i + 1) % COLORS.length], bgColor: BG_COLORS[i % BG_COLORS.length], presetName: i % 2 === 0 ? 'classic' : null };
      await prisma.preference.upsert({ where: { userId: id }, update: pref, create: { userId: id, ...pref } });
    }

    await prisma.gameHistory.deleteMany({ where: { userId: id } });
    const gameCount = int(3, 14);
    let best = 0;
    let bestRally = 0;
    let lastPlayed = 0;
    for (let g = 0; g < gameCount; g += 1) {
      const score = int(1, 11);
      const duration = int(25, 240);
      const finishedAt = new Date(now - int(0, 20) * DAY - int(0, 23) * 3600 * 1000);
      best = Math.max(best, score);
      bestRally = Math.max(bestRally, int(2, 25));
      lastPlayed = Math.max(lastPlayed, finishedAt.getTime());
      await prisma.gameHistory.create({ data: { userId: id, score, duration, finishedAt } });
      games += 1;
    }

    await prisma.user.update({ where: { id }, data: { lastPlayedAt: new Date(lastPlayed) } });
    await prisma.highScore.upsert({
      where: { userId: id },
      update: { score: best, longestRally: bestRally },
      create: { userId: id, score: best, longestRally: bestRally },
    });
    scores += 1;
  }

  console.log(`Seeded ${PLAYERS.length} players, ${scores} high scores, ${games} finished games.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
