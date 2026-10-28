import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  for (const name of ["student", "admin"] as const) {
    await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
  }
  process.stdout.write("Student and Admin roles seeded. No credentials or unverified accounts created.\n");
} finally {
  await prisma.$disconnect();
}
