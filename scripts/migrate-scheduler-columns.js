import dotenv from 'dotenv';
import { initializeDatabase, getDatabase } from '../src/db/database.js';

// Load environment variables
dotenv.config();

async function migrateSchedulerColumns() {
  console.log('[Migration] Starting scheduler columns migration...');
  
  try {
    // Initialize database connection
    await initializeDatabase();
    const db = getDatabase();
    
    // Check if columns already exist
    const [columns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transactions' 
        AND COLUMN_NAME IN ('next_execution_date', 'execution_count', 'last_execution_date', 'failure_reason', 'is_locked', 'locked_at')
    `);
    
    const existingColumns = columns.map(col => col.COLUMN_NAME);
    console.log('[Migration] Existing scheduler columns:', existingColumns);
    
    // Add missing columns
    const alterStatements = [];
    
    if (!existingColumns.includes('execution_count')) {
      alterStatements.push(`
        ALTER TABLE transactions 
        ADD COLUMN execution_count INT NOT NULL DEFAULT 0,
        ADD CONSTRAINT chk_execution_count CHECK (execution_count >= 0)
      `);
    }
    
    if (!existingColumns.includes('next_execution_date')) {
      alterStatements.push(`
        ALTER TABLE transactions 
        ADD COLUMN next_execution_date VARCHAR(10)
      `);
    }
    
    if (!existingColumns.includes('last_execution_date')) {
      alterStatements.push(`
        ALTER TABLE transactions 
        ADD COLUMN last_execution_date VARCHAR(10)
      `);
    }
    
    if (!existingColumns.includes('failure_reason')) {
      alterStatements.push(`
        ALTER TABLE transactions 
        ADD COLUMN failure_reason TEXT
      `);
    }
    
    if (!existingColumns.includes('is_locked')) {
      alterStatements.push(`
        ALTER TABLE transactions 
        ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT FALSE
      `);
    }
    
    if (!existingColumns.includes('locked_at')) {
      alterStatements.push(`
        ALTER TABLE transactions 
        ADD COLUMN locked_at BIGINT
      `);
    }
    
    // Execute ALTER statements
    if (alterStatements.length === 0) {
      console.log('[Migration] ✅ All scheduler columns already exist. No migration needed.');
      process.exit(0);
    }
    
    console.log(`[Migration] Adding ${alterStatements.length} missing columns...`);
    
    for (const statement of alterStatements) {
      await db.query(statement);
      console.log('[Migration] ✅ Executed:', statement.trim().substring(0, 50) + '...');
    }
    
    // Add indexes
    console.log('[Migration] Adding indexes...');
    
    try {
      await db.query(`
        CREATE INDEX idx_transactions_next_execution 
        ON transactions(next_execution_date, status)
      `);
      console.log('[Migration] ✅ Created index: idx_transactions_next_execution');
    } catch (error) {
      if (error.code === 'ER_DUP_KEYNAME') {
        console.log('[Migration] ℹ️ Index idx_transactions_next_execution already exists');
      } else {
        throw error;
      }
    }
    
    try {
      await db.query(`
        CREATE INDEX idx_transactions_locked 
        ON transactions(is_locked, locked_at)
      `);
      console.log('[Migration] ✅ Created index: idx_transactions_locked');
    } catch (error) {
      if (error.code === 'ER_DUP_KEYNAME') {
        console.log('[Migration] ℹ️ Index idx_transactions_locked already exists');
      } else {
        throw error;
      }
    }
    
    // Verify all columns exist
    const [verifyColumns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'transactions' 
        AND COLUMN_NAME IN ('next_execution_date', 'execution_count', 'last_execution_date', 'failure_reason', 'is_locked', 'locked_at')
      ORDER BY COLUMN_NAME
    `);
    
    console.log('\n[Migration] ✅ Migration completed successfully!');
    console.log('[Migration] Scheduler columns in transactions table:');
    verifyColumns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}`);
    });
    
    process.exit(0);
    
  } catch (error) {
    console.error('[Migration] ❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateSchedulerColumns();
