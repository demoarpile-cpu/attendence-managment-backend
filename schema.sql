-- ==========================================================
-- BioTrack Pro — Complete Database Schema v2.1
-- ==========================================================
-- Final updated version with ALL fields for signature, 
-- UIF, advance payments, and multi-admin isolation.
-- ==========================================================

CREATE DATABASE IF NOT EXISTS biotrack_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE biotrack_db;

-- ==========================================================
-- TABLE 1: employees
-- Core staff/admin profile table
-- ==========================================================
CREATE TABLE IF NOT EXISTS employees (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    machine_id        VARCHAR(50) UNIQUE,                          -- ZKTeco biometric machine ID
    custom_id         VARCHAR(50) DEFAULT '',                      -- Human readable ID (EMP001)
    name              VARCHAR(100) NOT NULL,
    role              ENUM('admin','employee') DEFAULT 'employee',
    department        VARCHAR(100) DEFAULT 'General',
    shift             ENUM('Morning Shift','Evening Shift','Night Shift') DEFAULT 'Morning Shift',
    email             VARCHAR(150) UNIQUE,
    phone             VARCHAR(30) DEFAULT '',
    salary_rate       DECIMAL(10,2) DEFAULT 0.00,
    salary_type       ENUM('hourly','daily') DEFAULT 'hourly',
    status            ENUM('active','on_leave','terminated') DEFAULT 'active',
    joined_date       DATE,
    photo             LONGTEXT,                                    -- Profile image URL
    uif_number        VARCHAR(50) DEFAULT '',                      -- UIF Registration
    is_uif_registered TINYINT(1) DEFAULT 1,                       -- 1 = Yes, 0 = No
    advance_balance   DECIMAL(10,2) DEFAULT 0.00,                 -- Current debt/advance
    signature         LONGTEXT,                                    -- Base64 E-Signature
    created_by        INT,                                         -- Admin who added this record
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ==========================================================
-- TABLE 2: users
-- Login credentials
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT,
    email       VARCHAR(150) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    role        ENUM('admin','employee') NOT NULL,
    name        VARCHAR(100) DEFAULT '',
    photo       LONGTEXT,
    created_by  INT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- ==========================================================
-- TABLE 3: raw_logs
-- Biometric machine records
-- ==========================================================
CREATE TABLE IF NOT EXISTS raw_logs (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    machine_user_id VARCHAR(50) NOT NULL,
    punch_time      DATETIME NOT NULL,
    device_sn       VARCHAR(100) DEFAULT '',
    is_processed    TINYINT(1) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_machine_user (machine_user_id),
    INDEX idx_punch_time (punch_time)
);

-- ==========================================================
-- TABLE 4: attendance
-- Processed daily logs
-- ==========================================================
CREATE TABLE IF NOT EXISTS attendance (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    employee_id   INT NOT NULL,
    date          DATE NOT NULL,
    in_time       DATETIME,
    out_time      DATETIME,
    total_hours   DECIMAL(10,2) DEFAULT 0.00,
    status        ENUM('present','absent','late','half_day') DEFAULT 'present',
    marked_by     INT,                                            -- Admin who manually marked
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_attendance (employee_id, date),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ==========================================================
-- TABLE 5: payroll
-- Salary cycle records
-- ==========================================================
CREATE TABLE IF NOT EXISTS payroll (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    employee_id       INT NOT NULL,
    cycle_start       DATE NOT NULL,
    cycle_end         DATE NOT NULL,
    total_hours       DECIMAL(10,2) DEFAULT 0.00,
    gross_earnings    DECIMAL(10,2) DEFAULT 0.00,
    base_salary       DECIMAL(10,2) DEFAULT 0.00,                 -- Legacy support
    deductions        DECIMAL(10,2) DEFAULT 0.00,
    uif_amount        DECIMAL(10,2) DEFAULT 0.00,                 -- 1% deduction
    advance_deduction DECIMAL(10,2) DEFAULT 0.00,                 -- Advance repayment
    overtime          DECIMAL(10,2) DEFAULT 0.00,
    net_salary        DECIMAL(10,2) DEFAULT 0.00,
    status            ENUM('pending','paid') DEFAULT 'pending',
    generated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE KEY unique_payroll_cycle (employee_id, cycle_start, cycle_end)
);

-- ==========================================================
-- TABLE 6: public_holidays
-- ==========================================================
CREATE TABLE IF NOT EXISTS public_holidays (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    holiday_name  VARCHAR(150) NOT NULL,
    holiday_date  DATE NOT NULL UNIQUE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- TABLE 7: settings
-- ==========================================================
CREATE TABLE IF NOT EXISTS settings (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    machine_ip      VARCHAR(50) DEFAULT NULL,
    machine_port    INT DEFAULT 4370,
    machine_alias   VARCHAR(100) DEFAULT 'Main Entrance',
    sync_interval   INT DEFAULT 30,
    late_deduction  TINYINT(1) DEFAULT 1,
    salary_cycle    VARCHAR(50) DEFAULT '15 Days Cycle',
    ot_multiplier   DECIMAL(4,2) DEFAULT 1.50,
    business_name   VARCHAR(150) DEFAULT 'BioTrack Pro',
    business_address TEXT,
    business_phone  VARCHAR(50) DEFAULT '',
    business_email  VARCHAR(150) DEFAULT '',
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ==========================================================
-- TABLE 8: audit_logs
-- ==========================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    admin_id    INT,
    action      VARCHAR(100) NOT NULL,
    target_id   INT,
    details     JSON,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- SEED DATA
-- ==========================================================

-- Default Settings
INSERT IGNORE INTO settings (id, business_name, business_address) 
VALUES (1, 'BioTrack Pro', '123 Business Park, Cape Town');

-- Admin Login: admin@biotrack.com / admin123
INSERT IGNORE INTO users (id, email, password, role, name)
VALUES (1, 'admin@biotrack.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lkmG', 'admin', 'System Admin');
