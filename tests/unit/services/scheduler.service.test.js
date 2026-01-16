import { jest } from '@jest/globals';

// Create mock implementations
const mockTransactionModel = {
  releaseStaleAccess: jest.fn(),
  findDueTransactions: jest.fn(),
  lockForExecution: jest.fn(),
  unlock: jest.fn(),
  updateExecutionStatus: jest.fn()
};

const mockExecutionLogModel = {
  create: jest.fn()
};

const mockDemoAccountModel = {
  findByUserId: jest.fn(),
  updateBalance: jest.fn()
};

const mockHoldingModel = {
  findByUserAndScheme: jest.fn(),
  create: jest.fn(),
  updateUnits: jest.fn()
};

const mockMfApiService = {
  getLatestNAV: jest.fn()
};

// Mock modules
jest.unstable_mockModule('../../../src/models/transaction.model.js', () => ({
  transactionModel: mockTransactionModel
}));

jest.unstable_mockModule('../../../src/models/executionLog.model.js', () => ({
  executionLogModel: mockExecutionLogModel
}));

jest.unstable_mockModule('../../../src/models/demoAccount.model.js', () => ({
  demoAccountModel: mockDemoAccountModel
}));

jest.unstable_mockModule('../../../src/models/holding.model.js', () => ({
  holdingModel: mockHoldingModel
}));

jest.unstable_mockModule('../../../src/services/mfapi.service.js', () => ({
  mfApiService: mockMfApiService
}));

// Import service after mocking
const { schedulerService } = await import('../../../src/services/scheduler.service.js');

describe('Scheduler Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeDueTransactions', () => {
    it('should return empty result when no transactions are due', async () => {
      mockTransactionModel.releaseStaleAccess.mockResolvedValue(0);
      mockTransactionModel.findDueTransactions.mockResolvedValue([]);

      const result = await schedulerService.executeDueTransactions('2026-01-16');

      expect(result).toEqual({
        targetDate: '2026-01-16',
        totalDue: 0,
        executed: 0,
        failed: 0,
        skipped: 0,
        details: [],
        durationMs: expect.any(Number)
      });
    });

    it('should process all due transactions', async () => {
      const dueTransactions = [
        {
          id: 1,
          user_id: 1,
          transaction_type: 'SIP',
          scheme_code: '123456',
          scheme_name: 'Test Fund',
          amount: 1000,
          frequency: 'MONTHLY',
          execution_count: 0,
          installments: null,
          end_date: null
        }
      ];

      mockTransactionModel.releaseStaleAccess.mockResolvedValue(0);
      mockTransactionModel.findDueTransactions.mockResolvedValue(dueTransactions);
      mockTransactionModel.lockForExecution.mockResolvedValue(true);
      mockTransactionModel.unlock.mockResolvedValue();
      mockTransactionModel.updateExecutionStatus.mockResolvedValue();
      
      mockDemoAccountModel.findByUserId.mockResolvedValue({ id: 1, user_id: 1, balance: 10000000 });
      mockDemoAccountModel.updateBalance.mockResolvedValue();
      
      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      
      mockHoldingModel.findByUserAndScheme.mockResolvedValue(null);
      mockHoldingModel.create.mockResolvedValue({ id: 1 });
      
      mockExecutionLogModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeDueTransactions('2026-01-16');

      expect(result.totalDue).toBe(1);
      expect(result.executed).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('executeScheduledTransaction', () => {
    it('should skip execution if lock cannot be acquired', async () => {
      const transaction = {
        id: 1,
        user_id: 1,
        transaction_type: 'SIP',
        amount: 1000
      };

      mockTransactionModel.lockForExecution.mockResolvedValue(false);
      mockExecutionLogModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeScheduledTransaction(transaction, '2026-01-16');

      expect(result.status).toBe('SKIPPED');
      expect(result.message).toBe('Already locked');
    });

    it('should execute SIP successfully', async () => {
      const transaction = {
        id: 1,
        user_id: 1,
        transaction_type: 'SIP',
        scheme_code: '123456',
        scheme_name: 'Test Fund',
        amount: 1000,
        frequency: 'MONTHLY',
        execution_count: 0,
        installments: null,
        end_date: null
      };

      mockTransactionModel.lockForExecution.mockResolvedValue(true);
      mockTransactionModel.unlock.mockResolvedValue();
      mockTransactionModel.updateExecutionStatus.mockResolvedValue();
      
      mockDemoAccountModel.findByUserId.mockResolvedValue({ 
        id: 1, 
        user_id: 1, 
        balance: 10000000 
      });
      mockDemoAccountModel.updateBalance.mockResolvedValue();
      
      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      
      mockHoldingModel.findByUserAndScheme.mockResolvedValue(null);
      mockHoldingModel.create.mockResolvedValue({ id: 1 });
      
      mockExecutionLogModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeScheduledTransaction(transaction, '2026-01-16');

      expect(result.status).toBe('SUCCESS');
      expect(mockTransactionModel.updateExecutionStatus).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'PENDING',
          nextExecutionDate: '2026-02-16',
          lastExecutionDate: '2026-01-16'
        })
      );
    });

    it('should handle insufficient balance error', async () => {
      const transaction = {
        id: 1,
        user_id: 1,
        transaction_type: 'SIP',
        scheme_code: '123456',
        scheme_name: 'Test Fund',
        amount: 1000,
        frequency: 'MONTHLY',
        execution_count: 0
      };

      mockTransactionModel.lockForExecution.mockResolvedValue(true);
      mockTransactionModel.unlock.mockResolvedValue();
      mockTransactionModel.updateExecutionStatus.mockResolvedValue();
      
      mockDemoAccountModel.findByUserId.mockResolvedValue({ 
        id: 1, 
        user_id: 1, 
        balance: 500 // Insufficient
      });
      
      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      
      mockExecutionLogModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeScheduledTransaction(transaction, '2026-01-16');

      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('Insufficient balance');
      expect(mockTransactionModel.updateExecutionStatus).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'PENDING',
          failureReason: expect.stringContaining('Insufficient balance')
        })
      );
    });

    it('should cancel transaction when installments are completed', async () => {
      const transaction = {
        id: 1,
        user_id: 1,
        transaction_type: 'SIP',
        amount: 1000,
        frequency: 'MONTHLY',
        execution_count: 12,
        installments: 12
      };

      mockTransactionModel.lockForExecution.mockResolvedValue(true);
      mockTransactionModel.unlock.mockResolvedValue();
      mockTransactionModel.updateExecutionStatus.mockResolvedValue();
      
      mockExecutionLogModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeScheduledTransaction(transaction, '2026-01-16');

      expect(result.status).toBe('SKIPPED');
      expect(result.message).toContain('Installments completed');
      expect(mockTransactionModel.updateExecutionStatus).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'CANCELLED',
          nextExecutionDate: null
        })
      );
    });

    it('should cancel transaction when end date is reached', async () => {
      const transaction = {
        id: 1,
        user_id: 1,
        transaction_type: 'SIP',
        amount: 1000,
        frequency: 'MONTHLY',
        execution_count: 5,
        installments: null,
        end_date: '2026-01-15' // Before execution date
      };

      mockTransactionModel.lockForExecution.mockResolvedValue(true);
      mockTransactionModel.unlock.mockResolvedValue();
      mockTransactionModel.updateExecutionStatus.mockResolvedValue();
      
      mockExecutionLogModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeScheduledTransaction(transaction, '2026-01-16');

      expect(result.status).toBe('SKIPPED');
      expect(result.message).toContain('End date reached');
      expect(mockTransactionModel.updateExecutionStatus).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: 'CANCELLED'
        })
      );
    });
  });

  describe('executeSIP', () => {
    it('should execute SIP and update holdings', async () => {
      const transaction = {
        user_id: 1,
        scheme_code: '123456',
        scheme_name: 'Test Fund',
        amount: 1000
      };

      mockDemoAccountModel.findByUserId.mockResolvedValue({ balance: 10000000 });
      mockDemoAccountModel.updateBalance.mockResolvedValue();
      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      mockHoldingModel.findByUserAndScheme.mockResolvedValue(null);
      mockHoldingModel.create.mockResolvedValue({ id: 1 });

      const result = await schedulerService.executeSIP(transaction);

      expect(result.units).toBe(10); // 1000 / 100
      expect(result.nav).toBe(100);
      expect(result.balanceAfter).toBe(10000000 - 1000);
      expect(mockHoldingModel.create).toHaveBeenCalled();
    });

    it('should update existing holdings for SIP', async () => {
      const transaction = {
        user_id: 1,
        scheme_code: '123456',
        scheme_name: 'Test Fund',
        amount: 1000
      };

      const existingHolding = {
        id: 1,
        units: 50
      };

      mockDemoAccountModel.findByUserId.mockResolvedValue({ balance: 10000000 });
      mockDemoAccountModel.updateBalance.mockResolvedValue();
      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      mockHoldingModel.findByUserAndScheme.mockResolvedValue(existingHolding);
      mockHoldingModel.updateUnits.mockResolvedValue();

      const result = await schedulerService.executeSIP(transaction);

      expect(mockHoldingModel.updateUnits).toHaveBeenCalledWith(1, 60); // 50 + 10
    });
  });

  describe('executeSWP', () => {
    it('should execute SWP and credit balance', async () => {
      const transaction = {
        user_id: 1,
        scheme_code: '123456',
        scheme_name: 'Test Fund',
        amount: 1000
      };

      const existingHolding = {
        id: 1,
        units: 50
      };

      mockDemoAccountModel.findByUserId.mockResolvedValue({ balance: 10000000 });
      mockDemoAccountModel.updateBalance.mockResolvedValue();
      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      mockHoldingModel.findByUserAndScheme.mockResolvedValue(existingHolding);
      mockHoldingModel.updateUnits.mockResolvedValue();

      const result = await schedulerService.executeSWP(transaction);

      expect(result.units).toBe(10); // 1000 / 100
      expect(result.nav).toBe(100);
      expect(result.balanceAfter).toBe(10000000 + 1000);
      expect(mockHoldingModel.updateUnits).toHaveBeenCalledWith(1, 40); // 50 - 10
    });

    it('should throw error for insufficient units in SWP', async () => {
      const transaction = {
        user_id: 1,
        scheme_code: '123456',
        amount: 1000
      };

      mockMfApiService.getLatestNAV.mockResolvedValue({ nav: '100.00' });
      mockHoldingModel.findByUserAndScheme.mockResolvedValue({ units: 5 }); // Insufficient

      await expect(schedulerService.executeSWP(transaction))
        .rejects.toThrow('Insufficient units');
    });
  });

  describe('calculateNextExecutionDate', () => {
    it('should calculate next daily execution date', () => {
      const next = schedulerService.calculateNextExecutionDate('2026-01-16', 'DAILY');
      expect(next).toBe('2026-01-17');
    });

    it('should calculate next weekly execution date', () => {
      const next = schedulerService.calculateNextExecutionDate('2026-01-16', 'WEEKLY');
      expect(next).toBe('2026-01-23');
    });

    it('should calculate next monthly execution date', () => {
      const next = schedulerService.calculateNextExecutionDate('2026-01-16', 'MONTHLY');
      expect(next).toBe('2026-02-16');
    });

    it('should calculate next quarterly execution date', () => {
      const next = schedulerService.calculateNextExecutionDate('2026-01-16', 'QUARTERLY');
      expect(next).toBe('2026-04-16');
    });

    it('should throw error for unsupported frequency', () => {
      expect(() => schedulerService.calculateNextExecutionDate('2026-01-16', 'YEARLY'))
        .toThrow('Unsupported frequency: YEARLY');
    });
  });

  describe('checkStopConditions', () => {
    it('should return false when no stop conditions are met', async () => {
      const transaction = {
        execution_count: 5,
        installments: 12,
        end_date: '2026-12-31'
      };

      const result = await schedulerService.checkStopConditions(transaction, '2026-01-16');

      expect(result.shouldStop).toBe(false);
    });

    it('should return true when installments are completed', async () => {
      const transaction = {
        execution_count: 12,
        installments: 12
      };

      const result = await schedulerService.checkStopConditions(transaction, '2026-01-16');

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toContain('Installments completed');
    });

    it('should return true when end date is exceeded', async () => {
      const transaction = {
        execution_count: 5,
        installments: null,
        end_date: '2026-01-15'
      };

      const result = await schedulerService.checkStopConditions(transaction, '2026-01-16');

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toContain('End date reached');
    });
  });
});
