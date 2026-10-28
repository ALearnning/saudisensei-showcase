import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  if (process.env.NODE_ENV !== "development" || process.env.CONFIRM_DEV_ADMIN !== "yes") {
    throw new Error("Development-only operation requires NODE_ENV=development and CONFIRM_DEV_ADMIN=yes.");
  }
  const issuer = process.env.DEV_ADMIN_ISSUER;
  const subject = process.env.DEV_ADMIN_SUBJECT;
  if (!issuer || !subject) throw new Error("Supply DEV_ADMIN_ISSUER and DEV_ADMIN_SUBJECT for an already verified application identity.");
  const identity = await prisma.userIdentity.findUnique({
    where: { issuer_subject: { issuer, subject } }, include: { user: true },
  });
  if (!identity || identity.user.status !== "active") {
    throw new Error("An existing active user provisioned by verified sign-in is required. No account will be fabricated.");
  }
  await prisma.$transaction(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { name: "admin" } });
    const assignment = await tx.userRole.findUnique({ where: { userId_roleId: { userId: identity.userId, roleId: role.id } } });
    if (!assignment) {
      await tx.userRole.create({ data: { userId: identity.userId, roleId: role.id } });
      await tx.auditLog.create({ data: {
        action: "role.granted.development", entityType: "user", entityId: identity.userId,
        metadata: { role: "admin", method: "restricted-development-script" },
      } });
    }
  });
  process.stdout.write("Development Admin role granted to the existing verified identity.\n");
} finally {
  await prisma.$disconnect();
}
