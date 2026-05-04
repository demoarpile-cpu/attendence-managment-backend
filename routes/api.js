
const express = require('express');
const router = express.Router();

// Controllers
const authController = require('../controllers/auth');
const employeeController = require('../controllers/employee');
const attendanceController = require('../controllers/attendance');
const payrollController = require('../controllers/payroll');
const profileController = require('../controllers/profile');
const settingsController = require('../controllers/settings');

const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Multer Storage Config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (mimetype && extname) return cb(null, true);
        cb(new Error('Only JPG and PNG images are allowed'));
    }
});

// ================= AUTH =================
router.post('/login', authController.login);

// ================= PROFILE (Protected) =================
router.get('/profile', auth, profileController.getProfile);
router.put('/profile', auth, profileController.updateProfile);

// ================= EMPLOYEES =================
router.get('/employees', auth, employeeController.getAllEmployees);
router.post('/employees', auth, upload.single('profileImage'), employeeController.addEmployee);
router.get('/employees/:id', auth, employeeController.getEmployeeById);

router.put('/employees/:id', auth, upload.single('profileImage'), employeeController.updateEmployee);
router.delete('/employees/:id', auth, employeeController.deleteEmployee);

// ================= ATTENDANCE =================
router.get('/attendance', auth, attendanceController.getAttendance);
router.put('/attendance/:id', auth, attendanceController.updateAttendance);
router.post('/attendance/manual', auth, attendanceController.addManualAttendance);
router.post('/attendance/bulk', auth, attendanceController.bulkMarkAttendance);
router.post('/attendance/process', auth, attendanceController.processLogs);
router.get('/attendance/holidays', auth, attendanceController.getPublicHolidays);

// ================= PAYROLL =================
router.get('/payroll', auth, payrollController.getPayrollHistory);
router.post('/payroll/generate', auth, payrollController.generatePayroll);
router.patch('/payroll/:id', auth, payrollController.updatePayrollStatus);

// ================= STATS =================
router.get('/stats/dashboard', auth, attendanceController.getDashboardStats);

// ================= SETTINGS =================
router.get('/settings', auth, settingsController.getSettings);
router.put('/settings', auth, settingsController.updateSettings);

module.exports = router;
