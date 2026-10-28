import type { Request } from "express";
import type { ApplicationUser } from "../users/user-directory.js";
export interface AuthenticatedRequest extends Request {
  requestId: string;
  user: ApplicationUser;
  mfaVerified: boolean;
}
