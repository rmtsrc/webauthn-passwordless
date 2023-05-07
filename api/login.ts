import {
  generateAuthenticationOptions,
  GenerateAuthenticationOptionsOpts,
  VerifiedAuthenticationResponse,
  verifyAuthenticationResponse,
  VerifyAuthenticationResponseOpts,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import base64url from 'base64url';

import type { AuthenticationResponseJSON } from '@simplewebauthn/typescript-types';

import * as users from './db/users';
import * as anonymousChallenges from './db/anonymousChallenges';

import { config } from './config';
import { getWebAuthnValidUntil } from './utils';
import { getJwtToken } from './account';
import { verifyPassphrase } from './utils/hash';

const {
  webUrl,
  webAuthnOptions: { rpID, timeout, userVerification },
} = config;

/**
 * Login (a.k.a. "Authentication")
 */
export const authenticationGenerateOptions = async ({ email }: users.User) => {
  const user = email ? await users.get({ email }, { requireEmailValidated: false }) : undefined;

  if (user?.verification.validated === false) {
    throw new Error('Account not verified');
  }

  const opts: GenerateAuthenticationOptionsOpts = {
    timeout,
    allowCredentials:
      user?.devices.map((device) => ({
        id: device.credentialID,
        type: 'public-key',
        transports: device.transports || [],
      })) || [],
    userVerification,
    rpID,
  };

  const options = generateAuthenticationOptions(opts);

  /**
   * The server needs to temporarily remember this value for verification, so don't lose it until
   * after you verify an authenticator response.
   */
  if (user) {
    user.challenge.validUntil = getWebAuthnValidUntil();
    user.challenge.data = options.challenge;
    await users.replace({ email: user.email }, user);
  } else {
    anonymousChallenges.deleteOld();
    await anonymousChallenges.save(options.challenge);
  }

  return options;
};

export const authenticationVerify = async ({
  email,
  authenticationBody,
  passphraseAttempt = '',
}: users.User & {
  authenticationBody: AuthenticationResponseJSON;
  passphraseAttempt: string;
}) => {
  let user: users.User | undefined;
  let expectedChallenge: string | undefined = undefined;
  if (email) {
    user = await users.getForChallenge({ email }, true);
    expectedChallenge = user.challenge.data;
  } else if (authenticationBody.response.userHandle) {
    user = await users.get({ id: authenticationBody.response.userHandle });

    const { challenge } = JSON.parse(
      Buffer.from(authenticationBody.response.clientDataJSON, 'base64') as any as string
    );
    if (await anonymousChallenges.exists(challenge)) {
      expectedChallenge = challenge;
    }
  } else {
    throw new Error('Unable to verify login');
  }

  if (!expectedChallenge) {
    throw new Error('Unable to verify login');
  }

  let dbAuthenticator: users.AuthenticatorDeviceDetails | undefined;
  const bodyCredIDBuffer = base64url.toBuffer(authenticationBody.rawId);
  // "Query the DB" here for an authenticator matching `credentialID`
  for (const device of user.devices) {
    if (isoUint8Array.areEqual(device.credentialID, bodyCredIDBuffer)) {
      dbAuthenticator = device;
      break;
    }
  }

  if (!dbAuthenticator) {
    throw new Error('Authenticator not found');
  }

  let verification: VerifiedAuthenticationResponse;
  const opts: VerifyAuthenticationResponseOpts = {
    response: authenticationBody,
    expectedChallenge: `${expectedChallenge}`,
    expectedOrigin: webUrl,
    expectedRPID: rpID,
    authenticator: dbAuthenticator,
    requireUserVerification: userVerification === 'required',
  };
  verification = await verifyAuthenticationResponse(opts);

  const { verified, authenticationInfo } = verification;

  if (verified) {
    // Update the authenticator's counter in the DB to the newest count in the authentication
    dbAuthenticator.counter = authenticationInfo.newCounter;
    dbAuthenticator.lastUsed = Date.now();
    await users.updateDevice({ email: user.email }, dbAuthenticator);
  }

  const requiresPassphrase = Boolean(user.usePassphraseAsWellAsLoginDevice);
  if (requiresPassphrase && user.passphrase) {
    if (passphraseAttempt && !(await verifyPassphrase(user.passphrase, passphraseAttempt))) {
      throw new Error('Invalid passphrase');
    } else if (!passphraseAttempt) {
      return { email: user.email, verified, requiresPassphrase };
    }
  }

  return {
    verified,
    clientExtensionResults: dbAuthenticator.clientExtensionResults,
    requiresPassphrase,
    jwtToken: verified ? getJwtToken(user) : null,
  };
};
