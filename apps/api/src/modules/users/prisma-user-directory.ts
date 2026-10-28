import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@workspace/saudisensei-database";
import type { VerifiedIdentity } from "../identity/identity-adapter.js";
import type { ApplicationUser, ProfilePatch, UserDirectory } from "./user-directory.js";

const userInclude = { roles: { include: { role: true } } } as const;
type StoredUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;
function asProfile(user: StoredUser): ApplicationUser {
  return {
    id: user.id, email: user.email, displayName: user.displayName, status: user.status,
    preferredLocale: user.preferredLocale === "en" ? "en" : "ar",
    roles: user.roles.map((assignment) => assignment.role.name),
  };
}

@Injectable()
export class PrismaUserDirectory implements UserDirectory {
  async resolve(identity: VerifiedIdentity, requestId: string): Promise<ApplicationUser> {
    const where = { issuer_subject: { issuer: identity.issuer, subject: identity.subject } };
    const existing = await prisma.userIdentity.findUnique({
      where, include: { user: { include: userInclude } },
    });
    if (existing) return asProfile(existing.user);
    try {
      return await prisma.$transaction(async (tx) => {
        const student = await tx.role.findUniqueOrThrow({ where: { name: "student" } });
        const user = await tx.user.create({
          data: {
            email: identity.email, displayName: identity.displayName,
            status: "active", preferredLocale: "ar",
            identities: { create: { issuer: identity.issuer, subject: identity.subject } },
            roles: { create: { roleId: student.id } },
          },
          include: userInclude,
        });
        await tx.auditLog.create({ data: {
          actorUserId: user.id, action: "identity.provisioned", entityType: "user",
          entityId: user.id, requestId, metadata: { assignedRole: "student" },
        } });
        return asProfile(user);
      });
    } catch (error) {
      // Concurrent first requests may provision the same external identity.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const winner = await prisma.userIdentity.findUniqueOrThrow({
        where, include: { user: { include: userInclude } },
      });
      return asProfile(winner.user);
    }
  }

  async updateProfile(userId: string, input: ProfilePatch, requestId: string): Promise<ApplicationUser> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId, status: "active" },
        data: { ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
                ...(input.preferredLocale !== undefined ? { preferredLocale: input.preferredLocale } : {}) },
        include: userInclude,
      });
      await tx.auditLog.create({ data: {
        actorUserId: userId, action: "profile.updated", entityType: "user", entityId: userId,
        requestId, metadata: { fields: Object.keys(input) },
      } });
      return asProfile(user);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ForbiddenException("ACCOUNT_INACTIVE");
      }
      throw error;
    });
  }
}
