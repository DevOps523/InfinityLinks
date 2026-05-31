import { ExpressAuth, getSession } from '@auth/express';
import Credentials from '@auth/express/providers/credentials';
import type { AuthConfig } from '@auth/core';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { createLoginAttemptLimiter } from './login-attempt-limiter.js';
import { verifyPassword } from './passwords.js';
import {
  findAuthUserByEmail,
  findAuthUserById,
  normalizeAuthEmail,
  toSafeSessionUser,
  updateAuthUserLastLogin,
  type AuthUserRole
} from './users.repository.js';

export type SessionUser = {
  id: string;
  email: string;
  role: AuthUserRole;
  mustChangePassword: boolean;
};

const PASSWORD_CHANGE_REQUIRED_RESPONSE = {
  error: 'Password change required.',
  code: 'PASSWORD_CHANGE_REQUIRED'
};

const AUTH_CLIENT_IP_HEADER = 'x-infinitylinks-auth-client-ip';

function getCredentialsClientIp(request: { headers: { get(name: string): string | null } }) {
  return request.headers.get(AUTH_CLIENT_IP_HEADER)?.trim() || 'unknown';
}

declare module 'express-serve-static-core' {
  interface Locals {
    authUser?: SessionUser;
  }
}

declare module '@auth/core/types' {
  interface Session {
    user?: SessionUser;
  }

  interface User {
    role?: AuthUserRole;
    mustChangePassword?: boolean;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role?: AuthUserRole;
    mustChangePassword?: boolean;
  }
}

export function createAuthConfig(db: AppDatabase, config: AppConfig): AuthConfig {
  const loginAttemptLimiter = createLoginAttemptLimiter({ limit: 10, windowMs: 15 * 60_000 });

  return {
    secret: config.authSecret,
    trustHost: true,
    session: { strategy: 'jwt' },
    providers: [
      Credentials({
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' }
        },
        authorize(credentials, request) {
          const email = typeof credentials?.email === 'string' ? credentials.email : '';
          const password = typeof credentials?.password === 'string' ? credentials.password : '';
          const clientIp = getCredentialsClientIp(request);
          const limiterKey = `${clientIp}:${normalizeAuthEmail(email)}`;

          if (loginAttemptLimiter.isBlocked(limiterKey)) {
            return null;
          }

          const user = findAuthUserByEmail(db, email);

          if (!user || !verifyPassword(password, user.passwordHash)) {
            loginAttemptLimiter.recordFailure(limiterKey);
            return null;
          }

          loginAttemptLimiter.clear(limiterKey);
          updateAuthUserLastLogin(db, user.id);
          return toSafeSessionUser(user);
        }
      })
    ],
    callbacks: {
      jwt({ token, user }) {
        if (user) {
          token.sub = user.id;
          token.email = user.email;
          token.role = user.role;
          token.mustChangePassword = Boolean(user.mustChangePassword);
        }
        return token;
      },
      session({ session, token }) {
        if (token.sub && token.email && token.role) {
          session.user = {
            id: token.sub,
            email: token.email,
            role: token.role,
            mustChangePassword: Boolean(token.mustChangePassword)
          } as typeof session.user;
        }
        return session;
      }
    }
  };
}

export function createAuthHandler(db: AppDatabase, config: AppConfig) {
  const authHandler = ExpressAuth(createAuthConfig(db, config));

  return (req: Request, res: Response, next: NextFunction) => {
    req.headers[AUTH_CLIENT_IP_HEADER] = req.ip || req.socket.remoteAddress || 'unknown';
    return authHandler(req, res, next);
  };
}

export async function getRequestSessionUser(req: Request, config: AuthConfig): Promise<SessionUser | undefined> {
  const session = await getSession(req, config);
  return session?.user;
}

export function requireApiAuth(authConfig: AuthConfig, db?: AppDatabase) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await getRequestSessionUser(req, authConfig);

      if (!user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      if (db) {
        const userId = Number(user.id);
        const refreshedUser = Number.isInteger(userId) ? findAuthUserById(db, userId) : undefined;

        if (!refreshedUser) {
          res.status(401).json({ error: 'Authentication required.' });
          return;
        }

        if (refreshedUser.mustChangePassword) {
          res.status(403).json(PASSWORD_CHANGE_REQUIRED_RESPONSE);
          return;
        }

        res.locals.authUser = toSafeSessionUser(refreshedUser);
        next();
        return;
      }

      if (user.mustChangePassword) {
        res.status(403).json(PASSWORD_CHANGE_REQUIRED_RESPONSE);
        return;
      }

      res.locals.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (res.locals.authUser?.role !== 'admin') {
    res.status(403).json({ error: 'You do not have permission to manage users.' });
    return;
  }

  next();
}

export function refreshSessionUserFromDatabase(db: AppDatabase, sessionUser: SessionUser): SessionUser | undefined {
  const user = findAuthUserById(db, Number(sessionUser.id));
  return user ? toSafeSessionUser(user) : undefined;
}
