/**
 * @file app.js
 * @description Express.js 애플리케이션을 생성하고 미들웨어를 설정합니다.
 * API 라우팅 및 오류 처리를 담당합니다.
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./core/utils/logger');
const apiRoutes = require('./api/routes');
const { initializeOriginManager } = require('./core/utils/originManager');

// Express 애플리케이션을 생성합니다.
const app = express();

// --- 1. 미들웨어(Middleware) 설정 ---

// CORS(Cross-Origin Resource Sharing) 미들웨어 설정
// originManager가 DB에서 허용된 Origin 목록을 동적으로 관리합니다.
app.use(cors({ origin: initializeOriginManager, credentials: true }));
logger.info('✅ [ExternalService][APP] 동적 CORS 미들웨어가 설정되었습니다.');

// JSON 요청 본문을 파싱하기 위한 미들웨어
app.use(express.json());

// URL-encoded 요청 본문을 파싱하기 위한 미들웨어
app.use(express.urlencoded({ extended: true }));

// HTTP 요청 로깅을 위한 morgan 미들웨어 설정
// 프로덕션 환경에서는 'combined' 포맷, 개발 환경에서는 'dev' 포맷을 사용합니다.
const morganFormat = config.isProduction ? 'combined': 'dev';
app.use(morgan(morganFormat, {
    // 로그 스트림을 winston 로거와 연결하여 파일 및 콘솔에 모두 출력합니다.
    stream: {
        write: (message) => logger.http(message.trim()),
    },
}));
logger.info('✅ [ExternalService][APP] HTTP 로깅(Morgan) 설정 완료.');

// --- 2. API 라우팅 설정 ---

// '/api' 경로로 들어오는 모든 요청을 apiRoutes에서 처리하도록 위임합니다.
app.use('/api', apiRoutes);

// --- 3. 오류 처리 미들웨어 ---

// 404 Not Found 오류 처리 미들웨어
// 위에서 정의한 라우트 중 어느 것에도 해당하지 않는 요청을 처리합니다.
app.use((req, res, next) => {
    res.status(404).json({ error: '요청하신 경로를 찾을 수 없습니다.' });
});

// 전역 에러 처리 미들웨어: 라우트 핸들러에서 발생한 에러를 최종적으로 처리합니다.
app.use((err, req, res, next) => {
    const statusCode = err.status || 500;
    logger.error(`🚨 [ExternalService][App] 전역 오류 발생 (Status: ${statusCode}, Path: ${req.path}, Method: ${req.method}): ${err.message}`, { stack: err.stack });
    res.status(statusCode).json({ error: '서버 내부 오류 발생.' });
});

module.exports = app;