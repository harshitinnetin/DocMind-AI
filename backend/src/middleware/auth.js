import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { profileCache } from '../config/cache.js';

/**
 * authenticate — API Gateway-style auth middleware.
 *
 * Strategy (fastest path first):
 *  1. Decode JWT — if it carries role/plan/email claims (new tokens), build req.user
 *     from the JWT payload alone. Zero DB queries. ⚡
 *  2. If JWT is legacy (userId only), hit profileCache first. If present: zero DB
 *     queries. Cache TTL is 5 minutes.
 *  3. Only on a true cache miss do we query the DB — with request coalescing so
 *     N simultaneous requests for the same userId fire only 1 DB query.
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { userId, email, role, plan, fullName, avatarUrl } = decoded;

    // ── Fast path: JWT carries full profile claims ─────────────────────────
    // New tokens embed role/email so we never need a DB lookup for auth.
    if (email && role) {
      req.user = { id: userId, email, role, plan: plan || 'FREE', fullName: fullName || null, avatarUrl: avatarUrl || null };
      return next();
    }

    // ── Cache path: return cached profile without DB ───────────────────────
    const cacheKey = `profile:${userId}`;
    const profile = await profileCache.getOrFetch(
      cacheKey,
      () => prisma.profile.findUnique({
        where: { id: userId },
        select: { id: true, email: true, fullName: true, role: true, plan: true, avatarUrl: true },
      }),
      5 * 60_000 // 5-minute TTL
    );

    if (!profile) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = profile;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

/**
 * Invalidate a user's cached profile (call after profile updates).
 */
export const invalidateProfileCache = (userId) => {
  profileCache.delete(`profile:${userId}`);
};
