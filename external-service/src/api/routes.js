/**
 * @file routes.js
 * @description API 엔드포인트 라우팅을 설정합니다.
 * Express.js의 Router를 사용하여 경로와 핸들러를 연결합니다.
 */

const express = require('express');
const authMiddleware = require('./middlewares/auth');
const reportHandler = require('./handlers/reportHandler');
const {
    validateDeviceInfoReport,
    validateDeviceStatusReport,
    validateDisasterResultReport,
} = require('./validators/reportValidator');
const handleValidationErrors = require('./middlewares/validator');

// 새로운 Router 객체를 생성합니다.
const router = express.Router();

// --- 보고(Report) 관련 API 라우트 ---
// '/reports' 경로 아래의 모든 라우트는 API 키 인증을 필요로 합니다.
const reportRouter = express.Router();
reportRouter.use(authMiddleware);

// POST /api/reports/device-info : 단말기 제원 정보 보고
reportRouter.post('/device-info', validateDeviceInfoReport, handleValidationErrors, reportHandler.handleDeviceInfoReport);

// POST /api/reports/device-status : 단말기 상태 정보 보고
reportRouter.post('/device-status', validateDeviceStatusReport, handleValidationErrors, reportHandler.handleDeviceStatusReport);

// POST /api/reports/disaster-result : 재난 정보 결과 보고
reportRouter.post('/disaster-result', validateDisasterResultReport, handleValidationErrors, reportHandler.handleDisasterResultReport);

// '/api' 경로 아래에 '/reports' 라우터를 연결합니다.
router.use('/reports', reportRouter);

module.exports = router;