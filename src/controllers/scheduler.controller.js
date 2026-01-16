import { schedulerService } from '../services/scheduler.service.js';
import { transactionModel } from '../models/transaction.model.js';
import { executionLogModel } from '../models/executionLog.model.js';

/**
 * Scheduler Controller
 * API endpoints for manual scheduler triggering and monitoring
 */
export const schedulerController = {
  /**
   * POST /api/scheduler/execute
   * Manually trigger scheduler to execute due transactions
   */
  async execute(req, res) {
    try {
      const { targetDate } = req.body;
      
      // Validate date format if provided
      if (targetDate) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(targetDate)) {
          return res.status(400).json({
            error: 'Invalid date format. Use YYYY-MM-DD'
          });
        }
      }

      console.log(`[Scheduler Controller] Manual execution triggered for date: ${targetDate || 'today'}`);
      
      const result = await schedulerService.executeDueTransactions(targetDate);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('[Scheduler Controller] Execute error:', error);
      res.status(500).json({
        error: 'Failed to execute scheduler',
        message: error.message
      });
    }
  },

  /**
   * GET /api/scheduler/due
   * Get list of due transactions without executing
   */
  async getDueTransactions(req, res) {
    try {
      const targetDate = req.query.date || null;
      
      // Validate date format if provided
      if (targetDate) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(targetDate)) {
          return res.status(400).json({
            error: 'Invalid date format. Use YYYY-MM-DD'
          });
        }
      }

      const dueTransactions = await transactionModel.findDueTransactions(targetDate);
      
      res.json({
        success: true,
        date: targetDate || new Date().toISOString().split('T')[0],
        count: dueTransactions.length,
        transactions: dueTransactions
      });
    } catch (error) {
      console.error('[Scheduler Controller] Get due transactions error:', error);
      res.status(500).json({
        error: 'Failed to fetch due transactions',
        message: error.message
      });
    }
  },

  /**
   * GET /api/scheduler/logs/:transactionId
   * Get execution logs for a specific transaction
   */
  async getExecutionLogs(req, res) {
    try {
      const { transactionId } = req.params;
      
      if (!transactionId || isNaN(transactionId)) {
        return res.status(400).json({
          error: 'Invalid transaction ID'
        });
      }

      // Verify transaction exists and belongs to user
      const transaction = await transactionModel.findById(parseInt(transactionId));
      
      if (!transaction) {
        return res.status(404).json({
          error: 'Transaction not found'
        });
      }

      // Note: In production, add authentication check here
      // if (transaction.user_id !== req.user.id) {
      //   return res.status(403).json({ error: 'Unauthorized' });
      // }

      const logs = await executionLogModel.findByTransactionId(parseInt(transactionId));
      
      res.json({
        success: true,
        transactionId: parseInt(transactionId),
        count: logs.length,
        logs
      });
    } catch (error) {
      console.error('[Scheduler Controller] Get execution logs error:', error);
      res.status(500).json({
        error: 'Failed to fetch execution logs',
        message: error.message
      });
    }
  },

  /**
   * GET /api/scheduler/failures
   * Get recent failed executions
   */
  async getRecentFailures(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      
      if (limit < 1 || limit > 500) {
        return res.status(400).json({
          error: 'Invalid limit. Must be between 1 and 500'
        });
      }

      const failures = await executionLogModel.findRecentFailures(limit);
      
      res.json({
        success: true,
        count: failures.length,
        failures
      });
    } catch (error) {
      console.error('[Scheduler Controller] Get failures error:', error);
      res.status(500).json({
        error: 'Failed to fetch execution failures',
        message: error.message
      });
    }
  },

  /**
   * GET /api/scheduler/statistics
   * Get execution statistics for a date range
   */
  async getStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          error: 'startDate and endDate query parameters required (YYYY-MM-DD)'
        });
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      const stats = await executionLogModel.getStatistics(startDate, endDate);
      
      res.json({
        success: true,
        period: {
          start: startDate,
          end: endDate
        },
        statistics: stats
      });
    } catch (error) {
      console.error('[Scheduler Controller] Get statistics error:', error);
      res.status(500).json({
        error: 'Failed to fetch execution statistics',
        message: error.message
      });
    }
  },

  /**
   * POST /api/scheduler/unlock/:transactionId
   * Manually unlock a stuck transaction
   */
  async unlockTransaction(req, res) {
    try {
      const { transactionId } = req.params;
      
      if (!transactionId || isNaN(transactionId)) {
        return res.status(400).json({
          error: 'Invalid transaction ID'
        });
      }

      const transaction = await transactionModel.findById(parseInt(transactionId));
      
      if (!transaction) {
        return res.status(404).json({
          error: 'Transaction not found'
        });
      }

      if (!transaction.is_locked) {
        return res.status(400).json({
          error: 'Transaction is not locked'
        });
      }

      await transactionModel.unlock(parseInt(transactionId));
      
      console.log(`[Scheduler Controller] Manually unlocked transaction ${transactionId}`);
      
      res.json({
        success: true,
        message: `Transaction ${transactionId} unlocked successfully`
      });
    } catch (error) {
      console.error('[Scheduler Controller] Unlock transaction error:', error);
      res.status(500).json({
        error: 'Failed to unlock transaction',
        message: error.message
      });
    }
  }
};
