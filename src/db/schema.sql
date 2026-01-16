-- AMC Master table (curated list of fund houses)
CREATE TABLE IF NOT EXISTS amc_master (
    fund_house VARCHAR(255) PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    logo_url TEXT,
    created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000)
);

-- API Cache table for MFapi.in responses
CREATE TABLE IF NOT EXISTS api_cache (
    cache_key VARCHAR(255) PRIMARY KEY,
    response_json LONGTEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    INDEX idx_api_cache_expires_at (expires_at)
);

-- Seed the AMC Master table with top 3 fund houses
INSERT IGNORE INTO amc_master (fund_house, display_name, display_order) VALUES
    ('SBI Mutual Fund', 'SBI Mutual Fund', 1),
    ('ICICI Prudential Mutual Fund', 'ICICI Prudential Mutual Fund', 2),
    ('HDFC Mutual Fund', 'HDFC Mutual Fund', 3);

-- Users table for demo account holders
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email_id VARCHAR(255) NOT NULL,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    INDEX idx_users_username (username),
    INDEX idx_users_email (email_id)
);

-- Demo accounts table (one per user, fixed starting balance)
CREATE TABLE IF NOT EXISTS demo_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    balance DECIMAL(15,2) NOT NULL DEFAULT 1000000.00,
    created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_user_id CHECK (user_id > 0),
    CONSTRAINT chk_balance CHECK (balance >= 0),
    INDEX idx_demo_accounts_user_id (user_id)
);

-- Transactions table for SIP, STP, Lump Sum, SWP
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    scheme_code INT NOT NULL,
    scheme_name VARCHAR(500) NOT NULL,
    transaction_type ENUM('SIP', 'STP', 'LUMP_SUM', 'SWP') NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    units DECIMAL(15,4),
    nav DECIMAL(15,4),
    frequency ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'),
    start_date VARCHAR(10),
    end_date VARCHAR(10),
    installments INT,
    execution_count INT NOT NULL DEFAULT 0,
    next_execution_date VARCHAR(10),
    last_execution_date VARCHAR(10),
    status ENUM('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'SUCCESS',
    failure_reason TEXT,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at BIGINT,
    executed_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_trans_user_id CHECK (user_id > 0),
    CONSTRAINT chk_amount CHECK (amount > 0),
    CONSTRAINT chk_nav CHECK (nav IS NULL OR nav > 0),
    CONSTRAINT chk_installments CHECK (installments IS NULL OR installments > 0),
    CONSTRAINT chk_execution_count CHECK (execution_count >= 0),
    INDEX idx_transactions_user_id (user_id),
    INDEX idx_transactions_status (status),
    INDEX idx_transactions_next_execution (next_execution_date, status),
    INDEX idx_transactions_locked (is_locked, locked_at)
);

-- Holdings table for user's mutual fund portfolio
CREATE TABLE IF NOT EXISTS holdings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    scheme_code INT NOT NULL,
    scheme_name VARCHAR(500) NOT NULL,
    total_units DECIMAL(15,4) NOT NULL DEFAULT 0,
    invested_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    current_value DECIMAL(15,2),
    last_nav DECIMAL(15,4),
    last_nav_date VARCHAR(10),
    created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    UNIQUE KEY unique_user_scheme (user_id, scheme_code),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_hold_user_id CHECK (user_id > 0),
    CONSTRAINT chk_total_units CHECK (total_units >= 0),
    CONSTRAINT chk_invested_amount CHECK (invested_amount >= 0),
    CONSTRAINT chk_current_value CHECK (current_value IS NULL OR current_value >= 0),
    CONSTRAINT chk_last_nav CHECK (last_nav IS NULL OR last_nav > 0),
    INDEX idx_holdings_user_id (user_id)
);

-- Execution logs table for scheduler audit trail
CREATE TABLE IF NOT EXISTS execution_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL,
    execution_date VARCHAR(10) NOT NULL,
    status ENUM('SUCCESS', 'FAILED', 'SKIPPED') NOT NULL,
    amount DECIMAL(15,2),
    units DECIMAL(15,4),
    nav DECIMAL(15,4),
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    failure_reason TEXT,
    execution_duration_ms INT,
    executed_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    INDEX idx_execution_logs_transaction_id (transaction_id),
    INDEX idx_execution_logs_execution_date (execution_date),
    INDEX idx_execution_logs_status (status)
);
