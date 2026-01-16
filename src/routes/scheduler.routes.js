import express from 'express';
import { schedulerController } from '../controllers/scheduler.controller.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * Scheduler Routes
 * API endpoints for SIP/STP/SWP automated execution
 * All routes require authentication and admin role
 */

// POST /api/scheduler/execute - Manually trigger scheduler (ADMIN ONLY)
router.post('/execute', authenticateToken, requireAdmin, schedulerController.execute);

// GET /api/scheduler/due - List due transactions (ADMIN ONLY)
router.get('/due', authenticateToken, requireAdmin, schedulerController.getDueTransactions);

// GET /api/scheduler/logs/:transactionId - Get execution history (USER CAN VIEW OWN)
router.get('/logs/:transactionId', authenticateToken, schedulerController.getExecutionLogs);

// GET /api/scheduler/failures - Get recent failed executions (ADMIN ONLY)
router.get('/failures', authenticateToken, requireAdmin, schedulerController.getRecentFailures);

// GET /api/scheduler/statistics - Get execution statistics (ADMIN ONLY)
router.get('/statistics', authenticateToken, requireAdmin, schedulerController.getStatistics);

// POST /api/scheduler/unlock/:transactionId - Manually unlock stuck transaction (ADMIN ONLY)
router.post('/unlock/:transactionId', authenticateToken, requireAdmin, schedulerController.unlockTransaction);

export default router;
