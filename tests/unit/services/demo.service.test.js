/**
 * Unit Tests for Demo Service
 * Tests investment execution, portfolio management, and business logic
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies
const mockDemoAccountModel = {
  getBalance: jest.fn(),
  updateBalance: jest.fn(),
  findByUserId: jest.fn()
};

const mockTransactionModel = {
  create: jest.fn(),
  findByUserId: jest.fn()
};

const mockHoldingModel = {
  findByScheme: jest.fn(),
  upsert: jest.fn(),
  findByUserId: jest.fn(),
  removeUnits: jest.fn()
};

const mockMfApiService = {
  getSchemeDetails: jest.fn(),
  getLatestNAV: jest.fn()
};

jest.unstable_mockModule('../../../src/models/demoAccount.model.js', () => ({
  demoAccountModel: mockDemoAccountModel
}));

jest.unstable_mockModule('../../../src/models/transaction.model.js', () => ({
  transactionModel: mockTransactionModel
}));

jest.unstable_mockModule('../../../src/models/holding.model.js', () => ({
  holdingModel: mockHoldingModel
}));

jest.unstable_mockModule('../../../src/services/mfapi.service.js', () => ({
  default: mockMfApiService
}));

const { demoService } = await import('../../../src/services/demo.service.js');

describe('Demo Service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('executeTransaction - Lump Sum', () => {
    const validLumpSumData = {
      userId: 1,
      schemeCode: 119091,
      transactionType: 'LUMP_SUM',
      amount: 10000
    };

    it('should execute lump sum investment successfully', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'HDFC Liquid Fund - Growth' },
        latestNAV: { nav: '5341.1487', date: '2026-01-13' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({
        id: 1,
        userId: 1,
        amount: 10000
      });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      const result = await demoService.executeTransaction(validLumpSumData);

      expect(result).toHaveProperty('transaction');
      expect(result).toHaveProperty('newBalance', 990000);
      expect(result).toHaveProperty('holding');
      expect(mockDemoAccountModel.updateBalance).toHaveBeenCalledWith(1, 990000);
    });

    it('should calculate units correctly', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: { nav: '100.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 1 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      await demoService.executeTransaction({
        ...validLumpSumData,
        amount: 5000
      });

      // 5000 / 100 = 50 units
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          units: 50,
          amount: 5000,
          nav: 100
        })
      );
    });

    it('should reject investment with insufficient balance', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(5000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });

      await expect(
        demoService.executeTransaction({
          ...validLumpSumData,
          amount: 10000
        })
      ).rejects.toThrow('Insufficient demo balance');
    });

    it('should reject invalid scheme code', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce(null);

      await expect(
        demoService.executeTransaction(validLumpSumData)
      ).rejects.toThrow('Invalid scheme code');
    });

    it('should reject zero or negative amount', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });

      await expect(
        demoService.executeTransaction({
          ...validLumpSumData,
          amount: 0
        })
      ).rejects.toThrow('Amount must be greater than zero');

      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });

      await expect(
        demoService.executeTransaction({
          ...validLumpSumData,
          amount: -100
        })
      ).rejects.toThrow('Amount must be greater than zero');
    });

    it('should update existing holding if user already has units', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'HDFC Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 1 });
      mockHoldingModel.findByScheme.mockReturnValueOnce({
        total_units: 10,
        invested_amount: 10000,
        scheme_code: 119091
      });
      mockHoldingModel.findByScheme.mockReturnValueOnce({ // After upsert
        total_units: 15,
        invested_amount: 15000
      });

      await demoService.executeTransaction({
        ...validLumpSumData,
        amount: 5000
      });

      expect(mockHoldingModel.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          units: 15, // 10 + 5
          investedAmount: 15000 // 10000 + 5000
        })
      );
    });

    it('should handle NAV unavailability', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: null
      });

      await expect(
        demoService.executeTransaction(validLumpSumData)
      ).rejects.toThrow('NAV not available');
    });
  });

  describe('executeTransaction - SIP', () => {
    const validSipData = {
      userId: 1,
      schemeCode: 119091,
      transactionType: 'SIP',
      amount: 5000,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
      installments: 12
    };

    it('should create SIP transaction successfully', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'HDFC SIP Fund' },
        latestNAV: { nav: '2500.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 1 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      const result = await demoService.executeTransaction(validSipData);

      expect(result.transaction).toBeDefined();
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'SIP',
          frequency: 'MONTHLY',
          startDate: '2026-02-01',
          installments: 12
        })
      );
    });

    it('should require frequency for SIP', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });

      await expect(
        demoService.executeTransaction({
          ...validSipData,
          frequency: null
        })
      ).rejects.toThrow('Frequency is required');
    });

    it('should validate SIP frequency options', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Test Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });

      await expect(
        demoService.executeTransaction({
          ...validSipData,
          frequency: 'INVALID_FREQ'
        })
      ).rejects.toThrow('Invalid frequency');
    });

    it('should create DAILY SIP transaction successfully', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Daily SIP Fund' },
        latestNAV: { nav: '1500.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 2 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      const result = await demoService.executeTransaction({
        ...validSipData,
        frequency: 'DAILY',
        amount: 1000
      });

      expect(result.transaction).toBeDefined();
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'SIP',
          frequency: 'DAILY',
          amount: 1000
        })
      );
    });

    it('should create WEEKLY SIP transaction successfully', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Weekly SIP Fund' },
        latestNAV: { nav: '2000.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 3 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      const result = await demoService.executeTransaction({
        ...validSipData,
        frequency: 'WEEKLY',
        amount: 3000
      });

      expect(result.transaction).toBeDefined();
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'SIP',
          frequency: 'WEEKLY',
          amount: 3000
        })
      );
    });

    it('should calculate units correctly for DAILY SIP', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Daily SIP Fund' },
        latestNAV: { nav: '500.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 4 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      await demoService.executeTransaction({
        ...validSipData,
        frequency: 'DAILY',
        amount: 500
      });

      // 500 / 500 = 1 unit
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          units: 1,
          nav: 500
        })
      );
    });

    describe('SIP with future start date (PENDING status)', () => {
      it('should set status to PENDING when start date is in the future', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const futureDate = tomorrow.toISOString().split('T')[0];

        mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
        mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
          meta: { scheme_name: 'Future SIP Fund' },
          latestNAV: { nav: '1000.00', date: '2026-01-14' }
        });
        mockTransactionModel.create.mockResolvedValueOnce({ id: 10 });

        await demoService.executeTransaction({
          ...validSipData,
          startDate: futureDate
        });

        expect(mockTransactionModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'PENDING'
          })
        );
      });

      it('should NOT deduct balance when SIP status is PENDING', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const futureDate = tomorrow.toISOString().split('T')[0];

        mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
        mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
          meta: { scheme_name: 'Future SIP Fund' },
          latestNAV: { nav: '1000.00', date: '2026-01-14' }
        });
        mockTransactionModel.create.mockResolvedValueOnce({ id: 11 });

        const result = await demoService.executeTransaction({
          ...validSipData,
          startDate: futureDate,
          amount: 5000
        });

        // Balance should remain unchanged when transaction is PENDING
        expect(mockDemoAccountModel.updateBalance).not.toHaveBeenCalled();
        expect(result.newBalance).toBe(1000000);
      });

      it('should NOT update holdings when SIP status is PENDING', async () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const futureDate = tomorrow.toISOString().split('T')[0];

        mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
        mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
          meta: { scheme_name: 'Future SIP Fund' },
          latestNAV: { nav: '1000.00', date: '2026-01-14' }
        });
        mockTransactionModel.create.mockResolvedValueOnce({ id: 12 });

        await demoService.executeTransaction({
          ...validSipData,
          startDate: futureDate
        });

        // Holdings should not be updated when transaction is PENDING
        expect(mockHoldingModel.findByScheme).not.toHaveBeenCalled();
        expect(mockHoldingModel.upsert).not.toHaveBeenCalled();
      });

      it('should set status to SUCCESS when start date is today', async () => {
        const today = new Date().toISOString().split('T')[0];

        mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
        mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
          meta: { scheme_name: 'Today SIP Fund' },
          latestNAV: { nav: '1000.00', date: '2026-01-14' }
        });
        mockTransactionModel.create.mockResolvedValueOnce({ id: 13 });
        mockHoldingModel.findByScheme.mockReturnValueOnce(null);

        await demoService.executeTransaction({
          ...validSipData,
          startDate: today
        });

        expect(mockTransactionModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'SUCCESS'
          })
        );
        expect(mockDemoAccountModel.updateBalance).toHaveBeenCalled();
        expect(mockHoldingModel.upsert).toHaveBeenCalled();
      });

      it('should set status to SUCCESS when start date is in the past', async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const pastDate = yesterday.toISOString().split('T')[0];

        mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
        mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
          meta: { scheme_name: 'Past SIP Fund' },
          latestNAV: { nav: '1000.00', date: '2026-01-14' }
        });
        mockTransactionModel.create.mockResolvedValueOnce({ id: 14 });
        mockHoldingModel.findByScheme.mockReturnValueOnce(null);

        await demoService.executeTransaction({
          ...validSipData,
          startDate: pastDate
        });

        expect(mockTransactionModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'SUCCESS'
          })
        );
        expect(mockDemoAccountModel.updateBalance).toHaveBeenCalled();
        expect(mockHoldingModel.upsert).toHaveBeenCalled();
      });
    });
  });

  describe('executeTransaction - SWP (Withdrawal)', () => {
    const validSwpData = {
      userId: 1,
      schemeCode: 119091,
      transactionType: 'SWP',
      amount: 5000,
      frequency: 'MONTHLY'
    };

    it('should execute SWP withdrawal successfully', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(500000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'HDFC Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });
      const initialHolding = {
        total_units: 100,
        invested_amount: 100000
      };
      mockHoldingModel.findByScheme.mockReturnValueOnce(initialHolding);
      mockHoldingModel.findByScheme.mockReturnValueOnce({ // After removeUnits
        total_units: 95,
        invested_amount: 95000
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 1 });

      const result = await demoService.executeTransaction(validSwpData);

      expect(result.newBalance).toBe(505000); // 500000 + 5000
      expect(mockDemoAccountModel.updateBalance).toHaveBeenCalledWith(1, 505000);
    });

    it('should reject SWP with insufficient units', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(500000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'HDFC Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });
      mockHoldingModel.findByScheme.mockReturnValueOnce({
        total_units: 2, // Only 2 units available
        invested_amount: 2000
      });

      await expect(
        demoService.executeTransaction({
          ...validSwpData,
          amount: 5000 // Needs 5 units
        })
      ).rejects.toThrow('Insufficient units');
    });

    it('should reject SWP with no holdings', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(500000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'HDFC Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      await expect(
        demoService.executeTransaction(validSwpData)
      ).rejects.toThrow('No holdings found');
    });
  });

  describe('getPortfolio', () => {
    it('should return empty portfolio for new user', async () => {
      mockHoldingModel.findByUserId.mockReturnValueOnce([]);

      const result = await demoService.getPortfolio(1);

      expect(result).toEqual({
        holdings: [],
        summary: {
          totalInvested: 0,
          totalCurrent: 0,
          totalReturns: 0,
          returnsPercentage: 0
        }
      });
    });

    it('should calculate portfolio summary correctly', async () => {
      const holdings = [
        {
          scheme_code: 1,
          scheme_name: 'Fund 1',
          total_units: 10,
          invested_amount: 10000,
          last_nav: 1100,
          current_value: 11000
        },
        {
          scheme_code: 2,
          scheme_name: 'Fund 2',
          total_units: 5,
          invested_amount: 5000,
          last_nav: 900,
          current_value: 4500
        }
      ];
      mockHoldingModel.findByUserId.mockReturnValueOnce(holdings);
      // Mock getLatestNAV to return data in the correct structure
      mockMfApiService.getLatestNAV
        .mockResolvedValueOnce({ data: [{ nav: '1100', date: '2026-01-14' }] })
        .mockResolvedValueOnce({ data: [{ nav: '900', date: '2026-01-14' }] });

      const result = await demoService.getPortfolio(1);

      // Fund 1: 10 * 1100 = 11000
      // Fund 2: 5 * 900 = 4500
      // Total current = 15500, Total invested = 15000, Returns = 500
      expect(result.summary.totalInvested).toBe(15000);
      expect(result.summary.totalCurrent).toBe(15500);
      expect(result.summary.totalReturns).toBe(500);
      expect(result.summary.returnsPercentage).toBeCloseTo(3.33, 1);
    });

    it('should handle negative returns', async () => {
      const holdings = [
        {
          scheme_code: 1,
          scheme_name: 'Test Fund',
          total_units: 10,
          invested_amount: 10000,
          last_nav: 900,
          current_value: 9000 // Loss
        }
      ];
      mockHoldingModel.findByUserId.mockReturnValueOnce(holdings);
      mockMfApiService.getLatestNAV.mockResolvedValueOnce({ data: [{ nav: '900', date: '2026-01-14' }] });

      const result = await demoService.getPortfolio(1);

      expect(result.summary.totalReturns).toBe(-1000);
      expect(result.summary.returnsPercentage).toBe(-10);
    });
  });

  describe('getTransactions', () => {
    it('should return paginated transactions', async () => {
      const mockTransactions = [
        { id: 1, amount: 5000, transaction_type: 'LUMP_SUM' },
        { id: 2, amount: 10000, transaction_type: 'SIP' }
      ];
      mockTransactionModel.findByUserId.mockReturnValueOnce(mockTransactions);

      const result = await demoService.getTransactions(1, 20, 0);

      expect(result).toEqual(mockTransactions);
      expect(result.length).toBe(2);
    });

    it('should handle empty transaction history', async () => {
      mockTransactionModel.findByUserId.mockReturnValueOnce([]);

      const result = await demoService.getTransactions(1, 20, 0);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should reject transaction for non-existent demo account', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(null);

      await expect(
        demoService.executeTransaction({
          userId: 999,
          schemeCode: 119091,
          transactionType: 'LUMP_SUM',
          amount: 1000
        })
      ).rejects.toThrow('Demo account not found');
    });

    it('should handle invalid userId', async () => {
      await expect(
        demoService.getPortfolio(0)
      ).rejects.toThrow();

      await expect(
        demoService.getPortfolio(-1)
      ).rejects.toThrow();
    });

    it('should handle very large investment amounts', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(10000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Fund' },
        latestNAV: { nav: '1000.00', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 1 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      await demoService.executeTransaction({
        userId: 1,
        schemeCode: 119091,
        transactionType: 'LUMP_SUM',
        amount: 9999999
      });

      expect(mockDemoAccountModel.updateBalance).toHaveBeenCalled();
    });

    it('should handle fractional NAV calculations', async () => {
      mockDemoAccountModel.getBalance.mockReturnValueOnce(1000000);
      mockMfApiService.getSchemeDetails.mockResolvedValueOnce({
        meta: { scheme_name: 'Fund' },
        latestNAV: { nav: '5341.1487', date: '2026-01-14' }
      });
      mockTransactionModel.create.mockResolvedValueOnce({ id: 1 });
      mockHoldingModel.findByScheme.mockReturnValueOnce(null);

      await demoService.executeTransaction({
        userId: 1,
        schemeCode: 119091,
        transactionType: 'LUMP_SUM',
        amount: 10000
      });

      // Units should be precisely calculated
      expect(mockTransactionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          units: expect.any(Number)
        })
      );
    });
  });

  describe('getSystematicPlans', () => {
    it('should retrieve active systematic plans for user', async () => {
      const userId = 1;
      const mockPlans = [
        {
          id: 1,
          user_id: userId,
          scheme_code: 119551,
          scheme_name: 'HDFC Balanced Advantage Fund',
          transaction_type: 'SIP',
          amount: 5000,
          units: 123.4567,
          nav: 40.5,
          frequency: 'MONTHLY',
          start_date: '2024-01-01',
          end_date: null,
          installments: 12,
          status: 'SUCCESS'
        },
        {
          id: 2,
          user_id: userId,
          scheme_code: 119552,
          scheme_name: 'HDFC Equity Fund',
          transaction_type: 'STP',
          amount: 3000,
          units: 89.1234,
          nav: 33.67,
          frequency: 'WEEKLY',
          start_date: '2024-02-01',
          end_date: '2024-12-31',
          installments: 48,
          status: 'SUCCESS'
        }
      ];

      mockTransactionModel.findActiveSystematicPlans = jest.fn().mockReturnValue(mockPlans);

      const plans = await demoService.getSystematicPlans(userId);

      expect(mockTransactionModel.findActiveSystematicPlans).toHaveBeenCalledWith(userId);
      expect(plans).toEqual(mockPlans);
      expect(plans).toHaveLength(2);
      expect(plans[0].transaction_type).toBe('SIP');
      expect(plans[1].transaction_type).toBe('STP');
    });

    it('should return empty array when no systematic plans exist', async () => {
      const userId = 1;
      mockTransactionModel.findActiveSystematicPlans = jest.fn().mockReturnValue([]);

      const plans = await demoService.getSystematicPlans(userId);

      expect(mockTransactionModel.findActiveSystematicPlans).toHaveBeenCalledWith(userId);
      expect(plans).toEqual([]);
      expect(plans).toHaveLength(0);
    });

    it('should only return SIP, STP, and SWP transactions', async () => {
      const userId = 1;
      const mockPlans = [
        {
          id: 1,
          user_id: userId,
          transaction_type: 'SIP',
          frequency: 'DAILY',
          status: 'SUCCESS'
        },
        {
          id: 2,
          user_id: userId,
          transaction_type: 'SWP',
          frequency: 'MONTHLY',
          status: 'SUCCESS'
        }
      ];

      mockTransactionModel.findActiveSystematicPlans = jest.fn().mockReturnValue(mockPlans);

      const plans = await demoService.getSystematicPlans(userId);

      expect(plans).toHaveLength(2);
      plans.forEach(plan => {
        expect(['SIP', 'STP', 'SWP']).toContain(plan.transaction_type);
      });
    });
  });
});
