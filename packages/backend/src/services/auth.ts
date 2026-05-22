import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { store } from '../db/index.js';
import { consumeValidRefreshTokenByHash, deleteRefreshTokensForUserId } from '../db/repositories/refresh-tokens-repository.js';
import { getUserRecordById } from '../db/repositories/users-repository.js';
import { env } from '../config/env.js';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseExpiry(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

function generateAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId }, { expiresIn: env.JWT_ACCESS_EXPIRES_IN });
}

export async function generateTokens(app: FastifyInstance, userId: string) {
  const accessToken = generateAccessToken(app, userId);

  const refreshToken = await generateRefreshToken(userId);

  return { accessToken, refreshToken };
}

async function generateRefreshToken(userId: string): Promise<string> {
  const rawRefresh = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(rawRefresh);
  const expiresAt = new Date(Date.now() + parseExpiry(env.JWT_REFRESH_EXPIRES_IN)).toISOString();

  await store.insert('refreshTokens', {
    userId,
    tokenHash,
    expiresAt,
  });

  return rawRefresh;
}

export async function refreshAccessToken(app: FastifyInstance, rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);

  const stored = await consumeValidRefreshTokenByHash(tokenHash);

  if (!stored) return null;

  const user = await getUserRecordById(stored.userId as string);

  if (!user || user.isActive !== true || user.type === 'agent') return null;

  const userId = String(user.id);

  return {
    accessToken: generateAccessToken(app, userId),
    refreshToken: await generateRefreshToken(userId),
  };
}

export async function revokeUserRefreshTokens(userId: string) {
  await deleteRefreshTokensForUserId(userId);
}
