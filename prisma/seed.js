'use strict';

// Demo seed: fictional players with saved game settings, high scores and
// history. Deterministic; run with `npm run seed` after migrations.
const prisma = require('../lib/prisma');

const COLORS = ['#ffffff', '#ff5555', '#50fa7b', '#8be9fd', '#f1fa8c', '#bd93f9'];
const SPEEDS = ['slow', 'normal', 'fast'];
const LEVELS = ['easy', 'normal', 'hard'];
const NAMES = ['Ada Example', 'Ben Sample', 'Cleo Demo', 'Dev Testperson', 'Eli Fictional', 'Fay Placeholder'];

async function main() {
  let games = 0;
  for (let i = 0; i < NAMES.length; i++) {
    const id = `seed-user-${i + 1}`;
    const data = {
      id,
      email: `player${i + 1}@example.com`,
      name: NAMES[i],
      nickname: NAMES[i].split(' ')[0],
    };
    await prisma.user.upsert({ where: { id }, update: {}, create: data });
    const prefs = {
      paddleColor: COLORS[i % COLORS.length],
      ballSpeed: SPEEDS[i % SPEEDS.length],
      difficulty: LEVELS[(i * 2) % LEVELS.length],
    };
    await prisma.preference.upsert({
      where: { userId: id },
      update: prefs,
      create: { userId: id, ...prefs },
    });
    const best = 5 + i * 4;
    await prisma.highScore.upsert({
      where: { userId: id },
      update: {},
      create: { userId: id, score: best, longestRally: 6 + i * 3 },
    });
    const existing = await prisma.gameHistory.count({ where: { userId: id } });
    if (existing === 0) {
      for (let g = 0; g < 4; g++) {
        await prisma.gameHistory.create({
          data: { userId: id, score: Math.max(1, best - g * 2), duration: 40 + g * 15 + i * 5 },
        });
        games++;
      }
    }
  }
  console.log(`Seeded ${NAMES.length} users with preferences and high scores, ${games} game history rows`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
