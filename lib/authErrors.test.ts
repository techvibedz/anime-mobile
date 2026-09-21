import assert from "node:assert/strict";
import { authErrorKey, needsConfirmationHelp } from "./authErrors";

// The exact strings the project's GoTrue returns today (verified live against
// /auth/v1/token and /auth/v1/signup), plus the phrasings Supabase uses in
// other versions.
assert.equal(authErrorKey("Email not confirmed"), "emailNotConfirmed");
assert.equal(authErrorKey("email_not_confirmed"), "emailNotConfirmed");
assert.equal(authErrorKey("Invalid login credentials"), "invalidCredentials");
assert.equal(authErrorKey("User already registered"), "emailAlreadyRegistered");
assert.equal(
  authErrorKey("For security purposes, you can only request this after 47 seconds."),
  "rateLimited",
);
assert.equal(authErrorKey("Password should be at least 6 characters."), "weakPassword");
assert.equal(authErrorKey("New password should be different from the old password."), "samePassword");
assert.equal(authErrorKey("Unable to validate email address: invalid format"), "invalidEmail");
assert.equal(authErrorKey("Network request failed"), "offline");
assert.equal(authErrorKey(""), "unknown");
assert.equal(authErrorKey(null), "unknown");

assert.equal(needsConfirmationHelp("emailNotConfirmed"), true);
assert.equal(needsConfirmationHelp("invalidCredentials"), false);

console.log("auth error mapping tests passed");
