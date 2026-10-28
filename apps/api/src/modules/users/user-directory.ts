import type { VerifiedIdentity } from "../identity/identity-adapter.js";

export const USER_DIRECTORY = Symbol("USER_DIRECTORY");
export interface ApplicationUser {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "suspended" | "deleted";
  preferredLocale: "ar" | "en";
  roles: ("student" | "admin")[];
}
export interface ProfilePatch {
  displayName?: string;
  preferredLocale?: "ar" | "en";
}
export interface UserDirectory {
  resolve(identity: VerifiedIdentity, requestId: string): Promise<ApplicationUser>;
  updateProfile(userId: string, input: ProfilePatch, requestId: string): Promise<ApplicationUser>;
}
