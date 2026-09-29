import { z } from "zod";

/** Rules for a password set from the panel (the installer applies its own). */
export const NEW_PASSWORD_MIN = 12;
export const NEW_PASSWORD_MAX = 256;

export const newPasswordSchema = z
  .string()
  .min(NEW_PASSWORD_MIN, `New password must be at least ${NEW_PASSWORD_MIN} characters`)
  .max(NEW_PASSWORD_MAX, `New password must be at most ${NEW_PASSWORD_MAX} characters`);
