import { SetMetadata } from "@nestjs/common";
export const PUBLIC_ROUTE = "saudisensei:public";
export const REQUIRED_ROLES = "saudisensei:roles";
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequireRoles = (...roles: ("student" | "admin")[]) => SetMetadata(REQUIRED_ROLES, roles);
