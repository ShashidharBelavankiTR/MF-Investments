import { query, queryOne, run } from '../db/database.js';
import { saveDatabase } from '../db/database.js';

export const transactionModel = {
  /**
   * Create a new transaction
   */
  async create({
    userId,
    schemeCode,
    schemeName,
    transactionType,
    amount,
    units,
    nav,
    frequency,
    startDate,
    endDate,
    installments,
    status = 'SUCCESS',
    nextExecutionDate = null
  }) {
    const result = await run(
      `INSERT INTO transactions 
       (user_id, scheme_code, scheme_name, transaction_type, amount, units, nav, 
        frequency, start_date, end_date, installments, status, next_execution_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, schemeCode, schemeName, transactionType, amount, units, nav,
       frequency, startDate, endDate, installments, status, nextExecutionDate]
    );
    
    return {
      id: result.lastInsertRowid,
      userId,
      schemeCode,
      schemeName,
      transactionType,
      amount,
      units,
      nav,
      frequency,
      startDate,
      endDate,
      installments,
      status,
      nextExecutionDate
    };
  },

  /**
   * Get all transactions for a user
   */
  async findByUserId(userId, limit = 50, offset = 0) {
    // Convert to integers to prevent SQL injection
    const safeLimit = parseInt(limit) || 50;
    const safeOffset = parseInt(offset) || 0;
    
    const results = await query(
      `SELECT * FROM transactions 
       WHERE user_id = ? 
       ORDER BY executed_at DESC 
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [userId]
    );
    return results;
  },

  /**
   * Get transaction by ID
   */
  async findById(id) {
    return await queryOne(
      `SELECT * FROM transactions WHERE id = ?`,
      [id]
    );
  },

  /**
   * Get transactions by scheme
   */
  async findByScheme(userId, schemeCode) {
    return await query(
      `SELECT * FROM transactions 
       WHERE user_id = ? AND scheme_code = ? 
       ORDER BY executed_at DESC`,
      [userId, schemeCode]
    );
  },

  /**
   * Get transaction count by user
   */
  async countByUserId(userId) {
    const result = await queryOne(
      `SELECT COUNT(*) as count FROM transactions WHERE user_id = ?`,
      [userId]
    );
    return result ? result.count : 0;
  },

  /**
   * Update transaction status
   */
  async updateStatus(id, status) {
    await run(
      `UPDATE transactions SET status = ? WHERE id = ?`,
      [status, id]
    );
  },

  /**
   * Get active systematic plans (SIP, STP, SWP) for a user
   */
  async findActiveSystematicPlans(userId) {
    console.log('[Transaction Model] findActiveSystematicPlans - userId:', userId);
    const results = await query(
      `SELECT * FROM transactions 
       WHERE user_id = ? 
       AND transaction_type IN ('SIP', 'STP', 'SWP')
       AND status = 'SUCCESS'
       ORDER BY transaction_type, executed_at DESC`,
      [userId]
    );
    console.log('[Transaction Model] Found', results.length, 'active systematic plans for userId:', userId);
    return results;
  },

  /**
   * Find due transactions for scheduler execution
   * @param {string} targetDate - Date string in YYYY-MM-DD format (default: today)
   * @returns {Array} Array of transactions due for execution
   */
  async findDueTransactions(targetDate = null) {
    if (!targetDate) {
      const today = new Date();
      targetDate = today.toISOString().split('T')[0];
    }

    console.log(`[Transaction Model] Finding due transactions for date: ${targetDate}`);
    
    const results = await query(
      `SELECT * FROM transactions 
       WHERE status = 'PENDING'
       AND next_execution_date IS NOT NULL
       AND next_execution_date <= ?
       AND is_locked = 0
       AND (last_execution_date IS NULL OR last_execution_date < ?)
       ORDER BY next_execution_date ASC, created_at ASC`,
      [targetDate, targetDate]
    );
    
    console.log(`[Transaction Model] Found ${results.length} due transactions`);
    return results;
  },

  /**
   * Lock a transaction for execution
   * @param {number} transactionId - Transaction ID to lock
   * @returns {boolean} True if lock acquired, false if already locked
   */
  async lockForExecution(transactionId) {
    const lockedAt = Date.now();
    
    const result = await run(
      `UPDATE transactions 
       SET is_locked = 1, locked_at = ?
       WHERE id = ? AND is_locked = 0`,
      [lockedAt, transactionId]
    );
    
    const success = result.changes > 0;
    console.log(`[Transaction Model] Lock ${success ? 'acquired' : 'failed'} for transaction ${transactionId}`);
    return success;
  },

  /**
   * Unlock a transaction after execution
   * @param {number} transactionId - Transaction ID to unlock
   */
  async unlock(transactionId) {
    await run(
      `UPDATE transactions 
       SET is_locked = 0, locked_at = NULL
       WHERE id = ?`,
      [transactionId]
    );
    console.log(`[Transaction Model] Unlocked transaction ${transactionId}`);
  },

  /**
   * Update execution status and details
   * @param {number} transactionId - Transaction ID
   * @param {object} params - Execution details
   */
  async updateExecutionStatus(transactionId, { 
    status, 
    nextExecutionDate = null, 
    lastExecutionDate = null,
    executionCount = null,
    failureReason = null 
  }) {
    const updates = [];
    const values = [];

    updates.push('status = ?');
    values.push(status);

    if (nextExecutionDate !== null) {
      updates.push('next_execution_date = ?');
      values.push(nextExecutionDate);
    }

    if (lastExecutionDate !== null) {
      updates.push('last_execution_date = ?');
      values.push(lastExecutionDate);
    }

    if (executionCount !== null) {
      updates.push('execution_count = ?');
      values.push(executionCount);
    }

    if (failureReason !== null) {
      updates.push('failure_reason = ?');
      values.push(failureReason);
    }

    values.push(transactionId);

    await run(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    console.log(`[Transaction Model] Updated execution status for transaction ${transactionId}:`, { status, nextExecutionDate, executionCount });
  },

  /**
   * Increment execution count
   * @param {number} transactionId - Transaction ID
   */
  async incrementExecutionCount(transactionId) {
    await run(
      `UPDATE transactions 
       SET execution_count = execution_count + 1
       WHERE id = ?`,
      [transactionId]
    );
  },

  /**
   * Release stale locks (older than 5 minutes)
   */
  async releaseStaleAccess() {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    const result = await run(
      `UPDATE transactions 
       SET is_locked = 0, locked_at = NULL
       WHERE is_locked = 1 AND locked_at < ?`,
      [fiveMinutesAgo]
    );
    
    if (result.changes > 0) {
      console.log(`[Transaction Model] Released ${result.changes} stale locks`);
    }
    
    return result.changes;
  }
};
