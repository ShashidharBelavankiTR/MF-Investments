import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { userModel } from '../models/user.model.js';
import { demoAccountModel } from '../models/demoAccount.model.js';
import { demoService } from '../services/demo.service.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export const authController = {
  /**
   * Register new user with demo account
   */
  async register(req, res, next) {
    try {
      const { fullName, emailId, password } = req.body;

      // Validate required fields
      if (!fullName || !emailId || !password) {
        return res.status(400).json({
          success: false,
          message: 'All fields are required',
          errors: {
            fullName: !fullName ? 'Full name is required' : undefined,
            emailId: !emailId ? 'Email is required' : undefined,
            password: !password ? 'Password is required' : undefined
          }
        });
      }

      // Validate full name length
      if (fullName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Full name must be at least 2 characters',
          errors: { fullName: 'Full name must be at least 2 characters' }
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format',
          errors: { emailId: 'Invalid email format' }
        });
      }

      // Validate password strength
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters',
          errors: { password: 'Password must be at least 8 characters' }
        });
      }

      // Check if email already exists (optional but recommended)
      if (await userModel.emailExists(emailId)) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered',
          errors: { emailId: 'Email already registered' }
        });
      }

      // Hash password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Create user with demo account
      const user = await userModel.create({
        fullName: fullName.trim(),
        emailId: emailId.trim().toLowerCase(),
        passwordHash
      });

      // Get demo account
      const demoAccount = await demoAccountModel.findByUserId(user.id);

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, emailId: user.emailId },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user.id,
            fullName: user.fullName,
            emailId: user.emailId
          },
          demoAccount: {
            balance: demoAccount.balance
          },
          token
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Login user
   */
  async login(req, res, next) {
    try {
      const { emailId, password } = req.body;

      // Validate required fields
      if (!emailId || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required',
          errors: {
            emailId: !emailId ? 'Email is required' : undefined,
            password: !password ? 'Password is required' : undefined
          }
        });
      }

      // Find user by email
      const user = await userModel.findByEmail(emailId);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Get demo account (create if doesn't exist)
      let demoAccount = await demoAccountModel.findByUserId(user.id);
      
      if (!demoAccount) {
        // Create demo account for existing user
        const { run } = await import('../db/database.js');
        await run(
          `INSERT INTO demo_accounts (user_id, balance) VALUES (?, ?)`,
          [user.id, 10000000.00]
        );
        demoAccount = await demoAccountModel.findByUserId(user.id);
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, emailId: user.email_id },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      // Fetch and update portfolio with latest NAVs on login
      let portfolioSummary = null;
      let lastNavUpdate = null;
      try {
        const portfolio = await demoService.getPortfolio(user.id);
        portfolioSummary = portfolio.summary;
        
        // Get timestamp of latest NAV update if holdings exist
        if (portfolio.holdings && portfolio.holdings.length > 0) {
          lastNavUpdate = portfolio.holdings[0]?.last_nav_date || new Date().toISOString().split('T')[0];
        }
      } catch (error) {
        console.error('[Auth] Failed to fetch portfolio on login:', error.message);
        // Continue with login even if portfolio fetch fails
      }

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            fullName: user.full_name,
            emailId: user.email_id
          },
          demoAccount: {
            balance: demoAccount.balance
          },
          portfolio: portfolioSummary ? {
            totalInvested: portfolioSummary.totalInvested,
            totalCurrent: portfolioSummary.totalCurrent,
            totalReturns: portfolioSummary.totalReturns,
            returnsPercentage: portfolioSummary.returnsPercentage,
            lastNavUpdate
          } : null,
          token
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get current user profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.userId;

      const user = await userModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get demo account (create if doesn't exist)
      let demoAccount = await demoAccountModel.findByUserId(userId);
      
      if (!demoAccount) {
        // Create demo account for existing user
        const { run } = await import('../db/database.js');
        await run(
          `INSERT INTO demo_accounts (user_id, balance) VALUES (?, ?)`,
          [userId, 10000000.00]
        );
        demoAccount = await demoAccountModel.findByUserId(userId);
      }

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            fullName: user.full_name,
            emailId: user.email_id,
            createdAt: user.created_at
          },
          demoAccount: {
            balance: demoAccount.balance,
            createdAt: demoAccount.created_at
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }
};
