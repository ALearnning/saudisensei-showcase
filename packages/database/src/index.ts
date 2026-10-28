import { PrismaClient } from "@prisma/client";
export { Prisma, PrismaClient, UserStatus, ContentStatus, EnrollmentStatus, RoleName } from "@prisma/client";
// Query exceptions are sanitized by the application; never log raw SQL parameters.
export const prisma = new PrismaClient();
