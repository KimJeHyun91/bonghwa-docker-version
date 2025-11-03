/**
 * @file logger.js
 * @description winston을 사용한 중앙 로깅 모듈입니다.
 * 콘솔과 파일에 모두 로그를 기록합니다.
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../../config');

// 로그 파일이 저장될 디렉터리 설정
const logDir = 'logs';

// winston에서 사용할 로그 레벨 정의
// (error: 0, warn: 1, info: 2, debug: 3)
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

// 로그 레벨에 따른 색상 정의 (콘솔 출력용)
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
};

winston.addColors(colors);

// 모든 로그에 적용될 공통 포맷 정의
const baseFormat = winston.format.combine(
    // 로그 시간 기록 (YYYY-MM-DD HH:mm:ss 형식)
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    // 여러 인자를 하나의 문자열로 합쳐줍니다. 예: logger.info('info', { meta: 'data' })
    winston.format.splat(),
    // 최종 로그 출력 형태를 정의합니다.
    winston.format.printf((info) => {
        return `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`;
    })
);

// 콘솔 출력용 포맷 (공통 포맷에 색상 추가)
const consoleFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    baseFormat
);

// 로거 인스턴스 생성
const logger = winston.createLogger({
    format: baseFormat,
    levels,
    level: config.log.LEVEL,
    transports: [
        // 1. 콘솔에 로그를 출력하는 Transport
        new winston.transports.Console({
            format: consoleFormat,
        }),
        // 2. 'info' 레벨 이상의 모든 로그를 날짜별 파일에 기록하는 Transport
        new DailyRotateFile({
            level: 'info',
            datePattern: 'YYYY-MM-DD',
            dirname: logDir,
            filename: '%DATE%.log', // 파일명 예: 2025-09-22.log
            maxSize: '20m', // 파일 최대 크기 (20MB)
            maxFiles: '14d', // 14일치 로그 파일 보관
            zippedArchive: true, // 오래된 로그는 압축하여 보관
        }),
        // 3. 'error' 레벨 로그만 별도의 파일에 기록하는 Transport
        new DailyRotateFile({
            level: 'error',
            datePattern: 'YYYY-MM-DD',
            dirname: path.join(logDir, 'error'), // error 로그는 별도 디렉터리에 저장
            filename: '%DATE%.error.log', // 파일명 예: 2025-09-22.error.log
            maxSize: '20m',
            maxFiles: '30d',
            zippedArchive: true,
        }),
    ],
    // 처리되지 않은 예외(Uncaught Exception) 발생 시 로그 기록
    exceptionHandlers: [
        new DailyRotateFile({
            level: 'error',
            datePattern: 'YYYY-MM-DD',
            dirname: path.join(logDir, 'exception'),
            filename: '%DATE%.exception.log',
        }),
        new winston.transports.Console({
            format: consoleFormat,
        }),
    ],
    // 처리되지 않은 Promise 거부(Unhandled Rejection)도 로깅
    rejectionHandlers: [
        new DailyRotateFile({
            level: 'error',
            datePattern: 'YYYY-MM-DD',
            dirname: path.join(logDir, 'rejection'),
            filename: '%DATE%.rejection.log',
        }),
        new winston.transports.Console({
            format: consoleFormat,
        }),
    ],
});

module.exports = logger;