import { transactionModel } from '../models/transaction.model.js';
import { executionLogModel } from '../models/executionLog.model.js';
import { demoAccountModel } from '../models/demoAccount.model.js';
import { holdingModel } from '../models/holding.model.js';
import { mfApiService } from './mfapi.service.js';

/**
 * Scheduler Service
 * Handles automated execution of PENDING SIP/STP/SWP transactions
 */
export const schedulerService = {
  /**
   * Execute all due transactions for a given date
   * @param {string} targetDate - Date in YYYY-MM-DD format (default: today)
   * @returns {object} Execution summary
   */
  async executeDueTransactions(targetDate = null) {
    const startTime = Date.now();
    
    // Default to today if no target date provided
    if (!targetDate) {
      const today = new Date();
      targetDate = today.toISOString().split('T')[0];
    }

    console.log(`[Scheduler] Starting execution for date: ${targetDate}`);
    
    // Release any stale locks first
    await transactionModel.releaseStaleAccess();
    
    // Fetch due transactions
    const dueTransactions = await transactionModel.findDueTransactions(targetDate);
    
    if (dueTransactions.length === 0) {
      console.log('[Scheduler] No due transactions found');
      return {
        targetDate,
        totalDue: 0,
        executed: 0,
        failed: 0,
        skipped: 0,
        details: [],
        durationMs: Date.now() - startTime
      };
    }

    console.log(`[Scheduler] Found ${dueTransactions.length} due transactions`);
    
    const results = {
      targetDate,
      totalDue: dueTransactions.length,
      executed: 0,
      failed: 0,
      skipped: 0,
      details: [],
      durationMs: 0
    };

    // Process each transaction
    for (const transaction of dueTransactions) {
      const execResult = await this.executeScheduledTransaction(transaction, targetDate);
      
      if (execResult.status === 'SUCCESS') {
        results.executed++;
      } else if (execResult.status === 'FAILED') {
        results.failed++;
      } else if (execResult.status === 'SKIPPED') {
        results.skipped++;
      }
      
      results.details.push(execResult);
    }

    results.durationMs = Date.now() - startTime;
    
    console.log(`[Scheduler] Execution complete:`, {
      executed: results.executed,
      failed: results.failed,
      skipped: results.skipped,
      totalDurationMs: results.durationMs
    });
    
    return results;
  },

  /**
   * Execute a single scheduled transaction
   * @param {object} transaction - Transaction to execute
   * @param {string} executionDate - Date of execution (YYYY-MM-DD)
   * @returns {object} Execution result
   */
  async executeScheduledTransaction(transaction, executionDate) {
    const startTime = Date.now();
    let logData = {
      transactionId: transaction.id,
      executionDate,
      status: 'FAILED',
      failureReason: null,
      amount: transaction.amount,
      units: null,
      nav: null,
      balanceBefore: null,
      balanceAfter: null,
      executionDurationMs: 0
    };

    try {
      console.log(`[Scheduler] Executing transaction ${transaction.id} (${transaction.transaction_type})`);
      
      // Attempt to acquire lock
      const lockAcquired = await transactionModel.lockForExecution(transaction.id);
      
      if (!lockAcquired) {
        console.log(`[Scheduler] Transaction ${transaction.id} is already locked (concurrency prevention)`);
        logData.status = 'SKIPPED';
        logData.failureReason = 'Transaction already locked by another process';
        logData.executionDurationMs = Date.now() - startTime;
        
        await executionLogModel.create(logData);
        
        return {
          transactionId: transaction.id,
          status: 'SKIPPED',
          message: 'Already locked',
          durationMs: logData.executionDurationMs
        };
      }

      try {
        // Check stop conditions before executing
        const shouldStop = await this.checkStopConditions(transaction, executionDate);
        
        if (shouldStop.shouldStop) {
          console.log(`[Scheduler] Transaction ${transaction.id} reached stop condition:`, shouldStop.reason);
          
          // Cancel the transaction
          await transactionModel.updateExecutionStatus(transaction.id, {
            status: 'CANCELLED',
            nextExecutionDate: null,
            failureReason: shouldStop.reason
          });
          
          logData.status = 'SKIPPED';
          logData.failureReason = shouldStop.reason;
          logData.executionDurationMs = Date.now() - startTime;
          await executionLogModel.create(logData);
          
          await transactionModel.unlock(transaction.id);
          
          return {
            transactionId: transaction.id,
            status: 'SKIPPED',
            message: shouldStop.reason,
            durationMs: logData.executionDurationMs
          };
        }

        // Get current balance for audit trail
        const account = await demoAccountModel.findByUserId(transaction.user_id);
        logData.balanceBefore = account ? account.balance : 0;

        // Execute based on transaction type
        let executionResult;
        
        switch (transaction.transaction_type) {
          case 'SIP':
            executionResult = await this.executeSIP(transaction);
            break;
          case 'SWP':
            executionResult = await this.executeSWP(transaction);
            break;
          case 'STP':
            executionResult = await this.executeSTP(transaction);
            break;
          default:
            throw new Error(`Unsupported transaction type: ${transaction.transaction_type}`);
        }

        // Update log data with execution results
        logData.units = executionResult.units;
        logData.nav = executionResult.nav;
        logData.balanceAfter = executionResult.balanceAfter;
        logData.status = 'SUCCESS';
        logData.failureReason = null;

        // Update transaction status and advance schedule
        const nextExecutionDate = this.calculateNextExecutionDate(
          executionDate,
          transaction.frequency
        );

        await transactionModel.updateExecutionStatus(transaction.id, {
          status: 'PENDING', // Keep PENDING for recurring transactions
          nextExecutionDate,
          lastExecutionDate: executionDate,
          executionCount: transaction.execution_count + 1,
          failureReason: null
        });

        console.log(`[Scheduler] Transaction ${transaction.id} executed successfully. Next execution: ${nextExecutionDate}`);

      } catch (error) {
        // Execution failed
        console.error(`[Scheduler] Transaction ${transaction.id} failed:`, error.message);
        
        logData.status = 'FAILED';
        logData.failureReason = error.message;
        
        // Update transaction with failure reason but keep PENDING for retry
        await transactionModel.updateExecutionStatus(transaction.id, {
          status: 'PENDING',
          failureReason: error.message
        });
      } finally {
        // Always unlock and log
        await transactionModel.unlock(transaction.id);
        
        logData.executionDurationMs = Date.now() - startTime;
        await executionLogModel.create(logData);
      }

      return {
        transactionId: transaction.id,
        status: logData.status,
        message: logData.failureReason || 'Executed successfully',
        durationMs: logData.executionDurationMs
      };

    } catch (error) {
      console.error(`[Scheduler] Unexpected error for transaction ${transaction.id}:`, error);
      
      // Attempt to unlock if error occurred before unlock
      try {
        await transactionModel.unlock(transaction.id);
      } catch (unlockError) {
        console.error(`[Scheduler] Failed to unlock transaction ${transaction.id}:`, unlockError);
      }
      
      return {
        transactionId: transaction.id,
        status: 'FAILED',
        message: error.message,
        durationMs: Date.now() - startTime
      };
    }
  },

  /**
   * Execute SIP transaction
   */
  async executeSIP(transaction) {
    // Get current NAV
    const navData = await mfApiService.getLatestNAV(transaction.scheme_code);
    
    if (!navData || !navData.nav) {
      throw new Error(`NAV not available for scheme ${transaction.scheme_code}`);
    }

    const nav = parseFloat(navData.nav);
    const amount = parseFloat(transaction.amount);
    
    // Check balance
    const account = await demoAccountModel.findByUserId(transaction.user_id);
    if (!account || account.balance < amount) {
      throw new Error(`Insufficient balance. Required: ₹${amount}, Available: ₹${account.balance || 0}`);
    }

    // Calculate units
    const units = amount / nav;

    // Deduct balance
    await demoAccountModel.updateBalance(transaction.user_id, account.balance - amount);

    // Update holdings
    const existingHolding = await holdingModel.findByUserAndScheme(
      transaction.user_id,
      transaction.scheme_code
    );

    if (existingHolding) {
      await holdingModel.updateUnits(
        existingHolding.id,
        existingHolding.units + units
      );
    } else {
      await holdingModel.create({
        userId: transaction.user_id,
        schemeCode: transaction.scheme_code,
        schemeName: transaction.scheme_name,
        units
      });
    }

    const newBalance = account.balance - amount;

    return {
      units,
      nav,
      balanceAfter: newBalance
    };
  },

  /**
   * Execute SWP transaction
   */
  async executeSWP(transaction) {
    // Get current NAV
    const navData = await mfApiService.getLatestNAV(transaction.scheme_code);
    
    if (!navData || !navData.nav) {
      throw new Error(`NAV not available for scheme ${transaction.scheme_code}`);
    }

    const nav = parseFloat(navData.nav);
    const amount = parseFloat(transaction.amount);
    
    // Calculate units to redeem
    const unitsToRedeem = amount / nav;

    // Check holdings
    const holding = await holdingModel.findByUserAndScheme(
      transaction.user_id,
      transaction.scheme_code
    );

    if (!holding || holding.units < unitsToRedeem) {
      throw new Error(`Insufficient units. Required: ${unitsToRedeem.toFixed(4)}, Available: ${holding?.units || 0}`);
    }

    // Update holdings
    await holdingModel.updateUnits(holding.id, holding.units - unitsToRedeem);

    // Credit balance
    const account = await demoAccountModel.findByUserId(transaction.user_id);
    const newBalance = account.balance + amount;
    await demoAccountModel.updateBalance(transaction.user_id, newBalance);

    return {
      units: unitsToRedeem,
      nav,
      balanceAfter: newBalance
    };
  },

  /**
   * Execute STP transaction
   * Note: Current implementation doesn't have source_scheme_code field.
   * This is a placeholder for future STP implementation.
   */
  async executeSTP(transaction) {
    throw new Error('STP execution not yet implemented. Requires source_scheme_code field in schema.');
  },

  /**
   * Calculate next execution date based on frequency
   * @param {string} currentDate - Current execution date (YYYY-MM-DD)
   * @param {string} frequency - DAILY, WEEKLY, MONTHLY, QUARTERLY
   * @returns {string} Next execution date (YYYY-MM-DD)
   */
  calculateNextExecutionDate(currentDate, frequency) {
    const current = new Date(currentDate);
    let next;

    switch (frequency) {
      case 'DAILY':
        next = new Date(current);
        next.setDate(current.getDate() + 1);
        break;
        
      case 'WEEKLY':
        next = new Date(current);
        next.setDate(current.getDate() + 7);
        break;
        
      case 'MONTHLY':
        next = new Date(current);
        next.setMonth(current.getMonth() + 1);
        break;
        
      case 'QUARTERLY':
        next = new Date(current);
        next.setMonth(current.getMonth() + 3);
        break;
        
      default:
        throw new Error(`Unsupported frequency: ${frequency}`);
    }

    return next.toISOString().split('T')[0];
  },

  /**
   * Check if transaction should stop (end conditions reached)
   * @param {object} transaction - Transaction to check
   * @param {string} executionDate - Current execution date
   * @returns {object} { shouldStop: boolean, reason: string }
   */
  async checkStopConditions(transaction, executionDate) {
    // Check installments limit
    if (transaction.installments && transaction.execution_count >= transaction.installments) {
      return {
        shouldStop: true,
        reason: `Installments completed (${transaction.execution_count}/${transaction.installments})`
      };
    }

    // Check end date
    if (transaction.end_date) {
      const endDate = new Date(transaction.end_date);
      const execDate = new Date(executionDate);
      
      if (execDate > endDate) {
        return {
          shouldStop: true,
          reason: `End date reached (${transaction.end_date})`
        };
      }
    }

    return { shouldStop: false, reason: null };
  }
};
