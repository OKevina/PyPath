const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const datasetPath = path.join(__dirname, '..', 'dataset.json');
  const raw = fs.readFileSync(datasetPath, 'utf-8');
  const challenges = JSON.parse(raw);

  // Idempotent reseed: clear dependents first to respect foreign keys.
  await prisma.reviewSchedule.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.challenge.deleteMany();

  for (const c of challenges) {
    await prisma.challenge.create({
      data: {
        title: c.title,
        prompt: c.prompt,
        testCases: JSON.stringify(c.testCases),
        orderIndex: c.orderIndex,
        hints: JSON.stringify(c.hints),
        learningTip: c.learningTip,
        mode: c.mode || 'stdin',
        starterCode: c.starterCode || '',
        category: c.category || 'general',
        difficulty: c.difficulty || 'easy',
      },
    });
  }

  // Ensure exactly one user profile (single-user app) with starting values.
  await prisma.userProfile.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, xp: 0, eloRating: 800, currentStreak: 0, highestUnlockedIndex: 1 },
  });

  console.log(`Done. Seeded ${challenges.length} challenge(s) and ensured user profile.`);
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
