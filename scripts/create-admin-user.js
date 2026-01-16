import 'dotenv/config';
import bcrypt from 'bcrypt';
import { initializeDatabase, query, run, closeDb } from '../src/db/database.js';

/**
 * Create Admin User Script
 * Creates an admin user with specified credentials
 */

const createAdminUser = async () => {
  try {
    console.log('[Admin Setup] Initializing database...');
    await initializeDatabase();
    
    console.log('[Admin Setup] Starting admin user creation...');

    const username = 'Shashi';
    const password = 'Naruto@02';
    const email = 'shashi@admin.com';
    const fullName = 'Shashi Admin';

    // Check if user already exists
    const existingUser = await query(
      'SELECT * FROM users WHERE username = ? OR email_id = ?',
      [username, email]
    );

    if (existingUser.length > 0) {
      console.log('[Admin Setup] User already exists:');
      console.log(`  Username: ${existingUser[0].username}`);
      console.log(`  Email: ${existingUser[0].email_id}`);
      console.log(`  User ID: ${existingUser[0].id}`);
      console.log('\n[Admin Setup] No action needed.');
      return;
    }

    // Hash password
    console.log('[Admin Setup] Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    console.log('[Admin Setup] Creating user...');
    const userResult = await run(
      `INSERT INTO users (username, email_id, full_name, password_hash) 
       VALUES (?, ?, ?, ?)`,
      [username, email, fullName, passwordHash]
    );

    const userId = userResult.lastInsertRowid;
    console.log(`[Admin Setup] User created with ID: ${userId}`);

    // Create demo account with 1 crore balance
    console.log('[Admin Setup] Creating demo account...');
    await run(
      `INSERT INTO demo_accounts (user_id, balance) 
       VALUES (?, ?)`,
      [userId, 10000000.00]
    );

    console.log('[Admin Setup] Demo account created with ₹1,00,00,000 balance');

    console.log('\n✅ Admin user created successfully!');
    console.log('═'.repeat(60));
    console.log('Admin Credentials:');
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log(`  Email: ${email}`);
    console.log(`  User ID: ${userId}`);
    console.log(`  Demo Balance: ₹1,00,00,000`);
    console.log('═'.repeat(60));
    console.log('\nYou can now login and access scheduler endpoints:');
    console.log('  POST /api/auth/login');
    console.log('  POST /api/scheduler/execute (admin only)');
    console.log('  GET  /api/scheduler/due (admin only)');
    console.log('  GET  /api/scheduler/failures (admin only)');
    console.log('  GET  /api/scheduler/statistics (admin only)');

  } catch (error) {
    console.error('[Admin Setup] Error:', error.message);
    process.exit(1);
  } finally {
    closeDb();
    process.exit(0);
  }
};

// Run the script
createAdminUser();
