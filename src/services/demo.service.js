import { demoAccountModel } from '../models/demoAccount.model.js';
import { transactionModel } from '../models/transaction.model.js';
import { holdingModel } from '../models/holding.model.js';
import mfApiService from './mfapi.service.js';

const isTestEnv = process.env.NODE_ENV === 'test';
const log = (...args) => {
  if (!isTestEnv) console.log(...args);
};
const logError = (...args) => {
  if (!isTestEnv) console.error(...args);
};

export const demoService = {
  /**
   * Execute a transaction (SIP, STP, Lump Sum, SWP)
   */
  async executeTransaction({
    userId,
    schemeCode,
    transactionType,
    amount,
    frequency,
    startDate,
    endDate,
    installments
  }) {
    // Get current balance and ensure it's a number
    const currentBalance = parseFloat(await demoAccountModel.getBalance(userId));
    
    // Ensure numeric values are numbers
    amount = parseFloat(amount);
    schemeCode = parseInt(schemeCode);
    
    log('[Demo Service] executeTransaction - userId:', userId, 'currentBalance:', currentBalance, 'amount:', amount);
    
    if (!currentBalance && currentBalance !== 0) {
      throw new Error('Demo account not found');
    }

    // Get fund details from API
    const fundDetails = await mfApiService.getSchemeDetails(schemeCode);
    if (!fundDetails || !fundDetails.meta) {
      throw new Error('Invalid scheme code');
    }

    const schemeName = fundDetails.meta.scheme_name;
    const latestNav = parseFloat(fundDetails.latestNAV?.nav || 0);
    
    if (!latestNav) {
      throw new Error('NAV not available for this scheme');
    }

    // Validate transaction based on type
    if (transactionType === 'LUMP_SUM' || transactionType === 'SIP' || transactionType === 'STP') {
      // Validate SIP/STP frequency
      if (transactionType === 'SIP' || transactionType === 'STP') {
        if (!frequency) {
          throw new Error('Frequency is required for SIP/STP transactions');
        }
        const validFrequencies = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'];
        if (!validFrequencies.includes(frequency)) {
          throw new Error('Invalid frequency. Must be DAILY, WEEKLY, MONTHLY, or QUARTERLY');
        }
      }

      // Purchase transactions - check sufficient balance
      if (amount <= 0) {
        throw new Error('Amount must be greater than zero');
      }

      if (currentBalance < amount) {
        throw new Error('Insufficient demo balance');
      }

      // Calculate units
      const units = amount / latestNav;

      // Determine transaction status and next execution date based on start date
      let transactionStatus = 'SUCCESS';
      let nextExecutionDate = null;
      
      // For SIP/STP transactions with future start date, set status to PENDING
      if ((transactionType === 'SIP' || transactionType === 'STP') && startDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to start of day
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        
        if (start > today) {
          transactionStatus = 'PENDING';
          nextExecutionDate = startDate; // Set next execution to start date
        }
      }

      // Create transaction record
      const transaction = await transactionModel.create({
        userId,
        schemeCode,
        schemeName,
        transactionType,
        amount,
        units,
        nav: latestNav,
        frequency: transactionType === 'LUMP_SUM' ? null : frequency,
        startDate: transactionType === 'LUMP_SUM' ? null : startDate,
        endDate: transactionType === 'LUMP_SUM' ? null : endDate,
        installments: transactionType === 'LUMP_SUM' ? null : installments,
        status: transactionStatus,
        nextExecutionDate: nextExecutionDate
      });

      // Update demo balance only if transaction is executed immediately (not pending)
      let newBalance = currentBalance;
      if (transactionStatus === 'SUCCESS') {
        newBalance = currentBalance - amount;
        log('[Demo Service] Updating balance - old:', currentBalance, 'new:', newBalance, 'deducted:', amount);
        await demoAccountModel.updateBalance(userId, newBalance);
      } else {
        log('[Demo Service] Transaction pending - balance not updated yet');
      }

      // Update or create holding only if transaction is executed immediately (not pending)
      if (transactionStatus === 'SUCCESS') {
        const existingHolding = await holdingModel.findByScheme(userId, schemeCode);
        
        if (existingHolding) {
          await holdingModel.upsert({
            userId,
            schemeCode,
            schemeName,
            units: existingHolding.total_units + units,
            investedAmount: existingHolding.invested_amount + amount,
            currentValue: (existingHolding.total_units + units) * latestNav,
            lastNav: latestNav,
            lastNavDate: fundDetails.latestNAV?.date
          });
        } else {
          await holdingModel.upsert({
            userId,
            schemeCode,
            schemeName,
            units,
            investedAmount: amount,
            currentValue: units * latestNav,
            lastNav: latestNav,
            lastNavDate: fundDetails.latestNAV?.date
          });
        }
      } else {
        log('[Demo Service] Transaction pending - holdings not updated yet');
      }

      return {
        transaction,
        newBalance,
        holding: transactionStatus === 'SUCCESS' ? await holdingModel.findByScheme(userId, schemeCode) : null
      };
    } else if (transactionType === 'SWP') {
      // Withdrawal transaction - check sufficient units
      if (amount <= 0) {
        throw new Error('Amount must be greater than zero');
      }

      const holding = await holdingModel.findByScheme(userId, schemeCode);
      if (!holding) {
        throw new Error('No holdings found for this scheme');
      }

      const requiredUnits = amount / latestNav;
      
      if (holding.total_units < requiredUnits) {
        throw new Error('Insufficient units for withdrawal');
      }

      // Determine transaction status based on start date
      let transactionStatus = 'SUCCESS';
      
      // For SWP transactions with future start date, set status to PENDING
      if (startDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to start of day
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        
        if (start > today) {
          transactionStatus = 'PENDING';
        }
      }

      // Create transaction record
      const transaction = await transactionModel.create({
        userId,
        schemeCode,
        schemeName,
        transactionType,
        amount,
        units: -requiredUnits, // Negative for withdrawal
        nav: latestNav,
        frequency,
        startDate,
        endDate,
        installments,
        status: transactionStatus
      });

      // Update demo balance and holdings only if transaction is executed immediately (not pending)
      let newBalance = currentBalance;
      if (transactionStatus === 'SUCCESS') {
        // Update demo balance (credit)
        newBalance = currentBalance + amount;
        await demoAccountModel.updateBalance(userId, newBalance);

        // Update holding (remove units)
        await holdingModel.removeUnits(userId, schemeCode, requiredUnits, amount);
      } else {
        log('[Demo Service] SWP transaction pending - balance and holdings not updated yet');
      }

      return {
        transaction,
        newBalance,
        holding: transactionStatus === 'SUCCESS' ? await holdingModel.findByScheme(userId, schemeCode) : holding
      };
    } else {
      throw new Error('Invalid transaction type');
    }
  },

  /**
   * Get portfolio summary
   */
  async getPortfolio(userId) {
    log('[Demo Service] getPortfolio - userId:', userId);
    const holdings = await holdingModel.findByUserId(userId);
    log('[Demo Service] Retrieved', holdings.length, 'holdings for userId:', userId);
    const balance = await demoAccountModel.getBalance(userId);
    
    let navUnavailable = false;
    let lastSuccessfulUpdate = null;
    
    // Update current values with latest NAV
    const updatedHoldings = await Promise.all(
      holdings.map(async (holding) => {
        // Convert string values to numbers
        const totalUnits = parseFloat(holding.total_units);
        const investedAmount = parseFloat(holding.invested_amount);
        const currentValueFromDb = parseFloat(holding.current_value || 0);
        
        try {
          // Fetch latest NAV and scheme details
          const latestData = await mfApiService.getLatestNAV(holding.scheme_code);
          if (latestData && latestData.data && latestData.data[0]) {
            const latestNav = parseFloat(latestData.data[0].nav);
            const currentValue = totalUnits * latestNav;
            
            // Get scheme category from meta data
            const schemeCategory = latestData.meta?.scheme_category || null;
            
            // Track last successful NAV date
            if (!lastSuccessfulUpdate || latestData.data[0].date > lastSuccessfulUpdate) {
              lastSuccessfulUpdate = latestData.data[0].date;
            }
            
            await holdingModel.updateCurrentValue(
              userId, 
              holding.scheme_code, 
              latestNav, 
              latestData.data[0].date
            );
            
            // Calculate invested NAV (average purchase price per unit)
            const investedNav = totalUnits > 0 ? investedAmount / totalUnits : 0;
            
            return {
              ...holding,
              scheme_category: schemeCategory,  // Add scheme_category
              total_units: totalUnits,
              invested_amount: investedAmount,
              invested_nav: investedNav,
              created_at: holding.created_at,
              last_nav: latestNav,
              last_nav_date: latestData.data[0].date,
              current_value: currentValue,
              returns: currentValue - investedAmount,
              returns_percentage: ((currentValue - investedAmount) / investedAmount) * 100
            };
          }
        } catch (error) {
          logError(`Failed to update NAV for scheme ${holding.scheme_code}:`, error.message);
          navUnavailable = true;
          
          // Use last known NAV date from database
          if (holding.last_nav_date && (!lastSuccessfulUpdate || holding.last_nav_date > lastSuccessfulUpdate)) {
            lastSuccessfulUpdate = holding.last_nav_date;
          }
        }
        
        // Calculate invested NAV (average purchase price per unit)
        const investedNav = totalUnits > 0 ? investedAmount / totalUnits : 0;
        
        // Recalculate current value using last known NAV even in error cases
        const lastKnownNav = parseFloat(holding.last_nav || 0);
        const recalculatedCurrentValue = totalUnits * lastKnownNav;
        
        return {
          ...holding,
          scheme_category: null,  // Add null scheme_category for error cases
          total_units: totalUnits,
          invested_amount: investedAmount,
          invested_nav: investedNav,
          created_at: holding.created_at,
          current_value: recalculatedCurrentValue,
          returns: recalculatedCurrentValue - investedAmount,
          returns_percentage: investedAmount > 0 
            ? ((recalculatedCurrentValue - investedAmount) / investedAmount) * 100 
            : 0
        };
      })
    );

    const totalInvested = updatedHoldings.reduce((sum, h) => sum + parseFloat(h.invested_amount || 0), 0);
    const totalCurrent = updatedHoldings.reduce((sum, h) => sum + parseFloat(h.current_value || 0), 0);
    const totalReturns = totalCurrent - totalInvested;

    return {
      balance,
      holdings: updatedHoldings,
      summary: {
        totalInvested,
        totalCurrent,
        totalReturns,
        returnsPercentage: totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0
      },
      navStatus: {
        unavailable: navUnavailable,
        lastUpdate: lastSuccessfulUpdate
      }
    };
  },

  /**
   * Get transaction history
   */
  async getTransactions(userId, limit = 50, offset = 0) {
    log('[Demo Service] getTransactions - userId:', userId, 'limit:', limit, 'offset:', offset);
    const transactions = await transactionModel.findByUserId(userId, limit, offset);
    log('[Demo Service] Retrieved', transactions.length, 'transactions for userId:', userId);
    return transactions;
  },

  /**
   * Get active systematic plans (SIP, STP, SWP)
   */
  async getSystematicPlans(userId) {
    log('[Demo Service] getSystematicPlans - userId:', userId);
    const plans = await transactionModel.findActiveSystematicPlans(userId);
    log('[Demo Service] Retrieved', plans.length, 'systematic plans for userId:', userId);
    return plans;
  }
};
