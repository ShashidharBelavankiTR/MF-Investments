import { query, run } from '../db/database.js';

/**
 * Execution Log Model
 * Manages audit trail for scheduler transaction executions
 */
export const executionLogModel = {
  /**
   * Create execution log entry
   * @param {object} logData - Execution details
   */
  async create({
    transactionId,
    executionDate,
    status,
    amount = null,
    units = null,
    nav = null,
    balanceBefore = null,
    balanceAfter = null,
    failureReason = null,
    executionDurationMs = null
  }) {
    const executedAt = Date.now();
    
    const result = await run(
      `INSERT INTO execution_logs 
       (transaction_id, execution_date, status, amount, units, nav, 
        balance_before, balance_after, failure_reason, execution_duration_ms, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transactionId,
        executionDate,
        status,
        amount,
        units,
        nav,
        balanceBefore,
        balanceAfter,
        failureReason,
        executionDurationMs,
        executedAt
      ]
    );

    console.log(`[Execution Log] Created log entry for transaction ${transactionId}:`, { status, executionDate });
    
    return {
      id: result.lastInsertRowid,
      transactionId,
      executionDate,
      status,
      amount,
      units,
      nav,
      balanceBefore,
      balanceAfter,
      failureReason,
      executionDurationMs,
      executedAt
    };
  },

  /**
   * Get execution logs for a transaction
   * @param {number} transactionId - Transaction ID
   * @returns {Array} Array of execution log entries
   */
  async findByTransactionId(transactionId) {
    const results = await query(
      `SELECT * FROM execution_logs 
       WHERE transaction_id = ?
       ORDER BY executed_at DESC`,
      [transactionId]
    );
    return results;
  },

  /**
   * Get recent failed executions
   * @param {number} limit - Maximum number of results
   * @returns {Array} Array of failed execution logs
   */
  async findRecentFailures(limit = 50) {
    const results = await query(
      `SELECT el.*, t.scheme_name, t.transaction_type, t.user_id
       FROM execution_logs el
       JOIN transactions t ON el.transaction_id = t.id
       WHERE el.status = 'FAILED'
       ORDER BY el.executed_at DESC
       LIMIT ${parseInt(limit)}`,
      []
    );
    return results;
  },

  /**
   * Get execution statistics
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {object} Execution statistics
   */
  async getStatistics(startDate, endDate) {
    const results = await query(
      `SELECT 
         status,
         COUNT(*) as count,
         SUM(amount) as total_amount,
         AVG(execution_duration_ms) as avg_duration_ms
       FROM execution_logs
       WHERE execution_date BETWEEN ? AND ?
       GROUP BY status`,
      [startDate, endDate]
    );
    
    const stats = {
      SUCCESS: { count: 0, totalAmount: 0, avgDurationMs: 0 },
      FAILED: { count: 0, totalAmount: 0, avgDurationMs: 0 },
      SKIPPED: { count: 0, totalAmount: 0, avgDurationMs: 0 }
    };
    
    results.forEach(row => {
      stats[row.status] = {
        count: row.count,
        totalAmount: row.total_amount || 0,
        avgDurationMs: row.avg_duration_ms || 0
      };
    });
    
    return stats;
  }
};
