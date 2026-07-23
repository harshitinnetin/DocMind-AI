import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { invalidateProfileCache } from '../middleware/auth.js';

const router = express.Router();

// Embed key profile fields directly in the token so authenticate() never
// needs a DB lookup — role/email act as trusted claims.
const generateToken = (profile, expiresIn) => {
  return jwt.sign(
    {
      userId:    profile.id,
      email:     profile.email,
      role:      profile.role,
      plan:      profile.plan,
      fullName:  profile.fullName  || null,
      avatarUrl: profile.avatarUrl || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.profile.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const profile = await prisma.profile.create({
      data: {
        email,
        fullName,
        password: hashedPassword,
      },
    });

    const token = generateToken(profile);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        plan: profile.plan,
        avatarUrl: profile.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Auto-seed or update default admin if admin@docmind.ai tries logging in
    if (email.toLowerCase().trim() === 'admin@docmind.ai') {
      let adminProfile = await prisma.profile.findUnique({ where: { email: 'admin@docmind.ai' } });
      const hashedPassword = await bcrypt.hash('admin1234', 12);
      if (!adminProfile) {
        await prisma.profile.create({
          data: {
            email: 'admin@docmind.ai',
            fullName: 'System Administrator',
            password: hashedPassword,
            role: 'ADMIN',
            plan: 'ENTERPRISE',
          },
        });
      } else if (adminProfile.role !== 'ADMIN') {
        await prisma.profile.update({
          where: { email: 'admin@docmind.ai' },
          data: { role: 'ADMIN', plan: 'ENTERPRISE', password: hashedPassword },
        });
      }
    }

    const profile = await prisma.profile.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!profile || !profile.password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, profile.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(profile);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        plan: profile.plan,
        avatarUrl: profile.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { email, name, googleId, avatarUrl } = req.body;

    if (!email || !googleId) {
      return res.status(400).json({ error: 'Invalid Google auth data' });
    }

    let profile = await prisma.profile.findUnique({ where: { email } });

    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          email,
          fullName: name,
          avatarUrl,
          googleId,
        },
      });
    } else if (!profile.googleId) {
      profile = await prisma.profile.update({
        where: { email },
        data: { googleId, avatarUrl: avatarUrl || profile.avatarUrl },
      });
    }

    const token = generateToken(profile);

    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        plan: profile.plan,
        avatarUrl: profile.avatarUrl,
      },
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// POST /api/auth/guest
// Creates (or reuses) a shared guest account and returns a real JWT token.
// This gives guests full API access including PDF uploads, chat, analytics, etc.
router.post('/guest', async (req, res) => {
  try {
    const guestEmail = 'guest@docmind.ai';

    // Upsert: find or create the shared guest profile
    const profile = await prisma.profile.upsert({
      where: { email: guestEmail },
      update: {}, // don't change anything on existing guest account
      create: {
        email: guestEmail,
        fullName: 'Guest Explorer',
        // No password — guest account is not accessible via normal login
      },
    });

    // Issue a short-lived token (24h) so guests' data doesn't persist too long
    const token = generateToken(profile, '24h');

    res.json({
      message: 'Guest session created',
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        plan: profile.plan,
        avatarUrl: profile.avatarUrl,
        isGuest: true,
      },
    });
  } catch (error) {
    console.error('Guest auth error:', error);
    res.status(500).json({ error: 'Failed to create guest session' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const profile = await prisma.profile.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, fullName: true, role: true, plan: true, avatarUrl: true, createdAt: true },
    });
    if (!profile) return res.status(404).json({ error: 'User not found' });
    res.json({ user: profile });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
