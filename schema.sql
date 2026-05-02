-- 🚀 BioTrack Pro Database Schema
-- Run this in your MySQL Workbench or phpMyAdmin

CREATE DATABASE IF NOT EXISTS biotrack_db;
USE biotrack_db;

-- 1. Employees Table
CREATE TABLE employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    machine_id VARCHAR(50) UNIQUE NOT NULL, -- The ID from ZKTeco Machine (e.g., 101)
    name VARCHAR(100) NOT NULL,
    role VARCHAR(100),
    department VARCHAR(50),
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20),
    salary_rate DECIMAL(10, 2), -- Hourly or Daily Rate
    salary_type ENUM('hourly', 'daily') DEFAULT 'hourly',
    status ENUM('active', 'on_leave', 'terminated') DEFAULT 'active',
    joined_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Raw Logs (Direct from Machine)
CREATE TABLE raw_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    machine_user_id VARCHAR(50) NOT NULL,
    punch_time DATETIME NOT NULL,
    device_sn VARCHAR(100), -- Serial Number of the machine
    is_processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Attendance Table (Processed)
CREATE TABLE attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    date DATE NOT NULL,
    in_time DATETIME,
    out_time DATETIME,
    total_hours DECIMAL(5, 2),
    status ENUM('present', 'absent', 'late', 'half_day') DEFAULT 'present',
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE KEY unique_attendance (employee_id, date)
);

-- 4. Payroll Table (15-Day Cycle)
CREATE TABLE payroll (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    cycle_start DATE NOT NULL,
    cycle_end DATE NOT NULL,
    total_hours DECIMAL(10, 2),
    base_salary DECIMAL(10, 2),
    deductions DECIMAL(10, 2) DEFAULT 0,
    net_salary DECIMAL(10, 2),
    status ENUM('pending', 'paid') DEFAULT 'pending',
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- 5. Admins/Users for Login
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT, -- Link to employee profile if applicable
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'employee') NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- 🚀 Dummy Admin Data
-- Password is 'admin123' (You should hash it in production)
INSERT INTO users (email, password, role) VALUES ('admin@biotrack.com', 'admin123', 'admin');
