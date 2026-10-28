import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { IDENTITY_ADAPTER } from "./identity-adapter.js";
import { Auth0IdentityAdapter } from "./auth0.adapter.js";
import { IdentityController } from "./identity.controller.js";
import { USER_DIRECTORY } from "../users/user-directory.js";
import { PrismaUserDirectory } from "../users/prisma-user-directory.js";
import { IdentityGuard } from "../authorization/identity.guard.js";
import { RolesGuard } from "../authorization/roles.guard.js";

@Module({
  controllers: [IdentityController],
  providers: [
    { provide: IDENTITY_ADAPTER, useClass: Auth0IdentityAdapter },
    { provide: USER_DIRECTORY, useClass: PrismaUserDirectory },
    { provide: APP_GUARD, useClass: IdentityGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class IdentityModule {}
