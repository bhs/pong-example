'use strict';

/**
 * prisma/seed.js — fills an empty database with fictional players for demos.
 *
 *   npm run seed
 *
 * Run by hand (never at startup). The data itself lives in lib/demo-seed.js.
 * These are the people the demo's sign-in picker offers.
 */

const prisma = require('../lib/prisma');
const { seedDemo } = require('../lib/demo-seed');

seedDemo(prisma)
  .then(({ players, scores, games }) => {
    console.log(`Seeded ${players} players, ${scores} high scores, ${games} finished games.`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
