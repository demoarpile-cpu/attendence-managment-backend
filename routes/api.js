const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const employeeController = require('../controllers/employee');
const attendanceController = require('../controllers/attendance');
const payrollController = require('../controllers/payroll');
const profileController = require('../controllers/profile');
const settingsController = require('../controllers/settings');
const authController = require('../controllers/auth');

// Auth
router.post('/login', authController.login);

// Profile
router.get('/profile', auth, profileController.getProfile);
router.put('/profile', auth, profileController.updateProfile);

// Employees
router.get('/employees', auth, employeeController.getAllEmployees);
router.get('/employees/:id', auth, employeeController.getEmployeeById);
router.post('/employees', auth, employeeController.addEmployee);
router.put('/employees/:id', auth, employeeController.updateEmployee);
router.delete('/employees/:id', auth, employeeController.deleteEmployee);

// Attendance
router.get('/attendance', auth, attendanceController.getAttendance);
router.post('/attendance/manual', auth, attendanceController.addManualAttendance);
router.post('/attendance/bulk', auth, attendanceController.bulkMarkAttendance);
router.put('/attendance/:id', auth, attendanceController.updateAttendance);
router.get('/attendance/stats', auth, attendanceController.getDashboardStats);
router.get('/stats/dashboard', auth, attendanceController.getDashboardStats);
router.get('/attendance/holidays', auth, attendanceController.getPublicHolidays);

// Payroll
router.get('/payroll', auth, payrollController.getPayrollHistory);
router.post('/payroll/generate', auth, payrollController.generatePayroll);
router.get('/payroll/:id', auth, payrollController.getPayrollById);
router.patch('/payroll/:id', auth, payrollController.updatePayrollStatus);

// Settings
router.get('/settings', auth, settingsController.getSettings);
router.put('/settings', auth, settingsController.updateSettings);

// Debug route
router.get('/debug-db', async (req, res) => {
    try {
        const db = require('../config/db');
        const [emp] = await db.execute('DESCRIBE employees');
        const [pay] = await db.execute('DESCRIBE payroll');
        const [user] = await db.execute('DESCRIBE users');
        res.json({ employees: emp, payroll: pay, users: user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
