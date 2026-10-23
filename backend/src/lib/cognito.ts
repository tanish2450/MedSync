import {
  AdminAddUserToGroupCommand, AdminCreateUserCommand, CognitoIdentityProviderClient, AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { Role } from "./types.js";
import { badRequest } from "./http.js";

const idp = new CognitoIdentityProviderClient({});

/** Admin-provisioned account; Cognito emails a temporary password. Returns the user's sub (used as patientId/doctorId). */
export async function createCognitoUser(opts: { email: string; name: string; role: Role; phone?: string }): Promise<string> {
  const UserPoolId = process.env.USER_POOL_ID!;
  try {
    const r = await idp.send(new AdminCreateUserCommand({
      UserPoolId, Username: opts.email, DesiredDeliveryMediums: ["EMAIL"],
      UserAttributes: [
        { Name: "email", Value: opts.email }, { Name: "email_verified", Value: "true" }, { Name: "name", Value: opts.name },
      ],
    }));
    const sub = r.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
    if (!sub) throw new Error("Cognito did not return a sub");
    await idp.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: opts.email, GroupName: opts.role }));
    return sub;
  } catch (e: any) {
    if (e?.name === "UsernameExistsException") throw badRequest("An account with this email already exists");
    throw e;
  }
}

export async function cognitoUserExists(email: string): Promise<string | null> {
  try {
    const r = await idp.send(new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID!, Username: email }));
    return r.UserAttributes?.find((a) => a.Name === "sub")?.Value ?? null;
  } catch (e: any) {
    if (e?.name === "UserNotFoundException") return null;
    throw e;
  }
}

/** Used by self sign-up: the role group is added LAST, after the profile rows exist. */
export async function addUserToGroup(username: string, group: Role): Promise<void> {
  await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: process.env.USER_POOL_ID!, Username: username, GroupName: group }));
}
