/**
 * @file reportHandler.js
 * @description /reports API에 대한 비지니스 로직을 처리합니다.
 * 트랜잭셔널 아웃박스 패턴을 사용하여 데이터 정합성을 보장합니다.
 */

const logger = require('../../core/utils/logger');
const pool = require('../../core/repositories/pool');
const apiReceiveLogRepository = require('../../core/repositories/apiReceiveLogRepository');
const deviceRepository = require('../../core/repositories/deviceRepository');
const deviceStatusLogRepository = require('../../core/repositories/deviceStatusLogRepository');
const reportPublishLogRepository = require('../../core/repositories/reportPublishLogRepository');
const config = require('../../config');

const REPORT_ROUTING_KEY = config.rabbitmq.NAMES.REPORT_ROUTING_KEY;

/**
 * 단말기 제원 정보 보고를 처리합니다.
 * @param {import('express').Request} req - Express 요청 객체
 * @param {import('express').Response} res - Express 응답 객체
 * @param {import('express').NextFunction} next - 다음 미들웨어 함수
 */
const handleDeviceInfoReport = async (req, res, next) => {

    const systemName = req.externalSystem?.system_name;
    let client;

    try {

        client = await pool.getClient();

        logger.debug(`🚀 [ExternalService][ReportHandler] 단말기 제원 정보 처리 시작 (System: ${systemName}, Path: ${req.path})...`);

        const { externalSystem } = req;
        const { deviceList } = req.body;

        // --- 트랜잭션 시작 ---
        await client.query('BEGIN');
        logger.debug('🚀 [ExternalService][ReportHandler] DB 트랜잭션 시작...');

        // 1. API 수신 로그를 기록합니다.
        const apiReceiveLogId = await apiReceiveLogRepository.create(
            {
                externalSystemId: externalSystem.id,
                requestPath: req.path,
                requestBody: req.body,
            },
            client
        );
        logger.debug(`✅ [ExternalService][ReportHandler] API 수신 로그 기록 완료 (api_receive_log ID: ${apiReceiveLogId}).`);

        // 2. 단말기 제원 정보를 일괄 등록/수정합니다.
        await deviceRepository.upsertDevices(externalSystem.id, deviceList, client);
        logger.debug(`✅ [ExternalService][ReportHandler] 단말기 제원 정보 DB 저장 완료 (${deviceList.length}건).`)

        // 3. 중앙 서비스로 보낼 보고 메시지를 아웃박스(report_publish_logs)에 저장합니다.
        await reportPublishLogRepository.create(
            {
                type: 'DEVICE_INFO',
                externalSystemName: systemName,
                apiReceiveLogId,
                routingKey: REPORT_ROUTING_KEY,
                rawMessage: { deviceList },                
            },
            client
        );
        logger.debug('✅ [ExternalService][ReportHandler] 보고 정보 아웃박스 기록 완료.');

        // --- 트랜잭션 커밋 ---
        await client.query('COMMIT');
        logger.info('✅ [ExternalService][ReportHandler] DB 트랜잭션 커밋 완료.');
        
        logger.info(`✅ [ExternalService][ReportHandler] 외부 시스템(${systemName})으로부터 단말기 제원 정보 ${deviceList.length}건 처리 완료.`);
        res.status(200).json({ message: '단말기 제원 정보 처리 완료.' });

    } catch (err) {

        // --- 오류 발생 시 롤백 ---
        if (client) {
            await client.query('ROLLBACK');
            logger.warn('🔔 [ExternalService][ReportHandler] DB 트랜잭션 롤백.');
        }
        logger.error(`🚨 [ExternalService][ReportHandler] 단말기 제원 정보 처리 오류 (System: ${systemName}, Path: ${req.path}): ${err.message}`);
        next(err);

    } finally {

        // --- 사용한 클라이언트 반환 ---
        if (client) {
            client.release();
            logger.debug('✅ [ExternalService][ReportHandler] DB 클라이언트 반환 완료.');
        }        

    }

};

/**
 * 단말기 상태 정보 보고를 처리합니다.
 * @param {import('express').Request} req - Express 요청 객체
 * @param {import('express').Response} res - Express 응답 객체
 * @param {import('express').NextFunction} next - 다음 미들웨어 함수
 */
const handleDeviceStatusReport = async (req, res, next) => {

    const systemName = req.externalSystem?.system_name;
    let client;

    try {

        client = await pool.getClient();
        logger.debug(`🚀 [ExternalService][ReportHandler] 단말기 상태 정보 처리 시작 (System: ${systemName}, Path: ${req.path}).`);

        const { externalSystem } = req;
        const { deviceList } = req.body;

        // --- 트랜잭션 시작 ---
        await client.query('BEGIN');
        logger.debug(`✅ [ExternalService][ReportHandler] DB 트랜잭션 시작.`);

        // 1. API 수신 로그를 기록합니다.
        const apiReceiveLogId = await apiReceiveLogRepository.create(
            {
                externalSystemId: externalSystem.id,
                requestPath: req.path,
                requestBody: req.body,
            },
            client
        );
        logger.debug(`✅ [ExternalService][ReportHandler] API 수신 로그 기록 완료 (api_receive_log ID: ${apiReceiveLogId}).`);

        // 2. 단말기 상태 정보를 일괄 등록/수정합니다.
        await deviceStatusLogRepository.createBulk(externalSystem.id, deviceList, client);
        logger.debug(`✅ [ExternalService][ReportHandler] 단말기 상태 정보 DB 저장 완료 (${deviceList.length}건).`);

        // 3. 중앙 서비스로 보낼 보고 메시지를 아웃박스(report_publish_logs)에 저장합니다.
        await reportPublishLogRepository.create(
            {
                type: 'DEVICE_STATUS',
                externalSystemName: systemName,
                apiReceiveLogId,
                routingKey: REPORT_ROUTING_KEY,
                rawMessage: { deviceList },                
            },
            client
        );
        logger.debug('✅ [ExternalService][ReportHandler] 보고 정보 아웃박스 기록 완료.');

        // --- 트랜잭션 커밋 ---
        await client.query('COMMIT');
        logger.debug('✅ [ExternalService][ReportHandler] DB 트랜잭션 커밋 완료.');
        
        logger.info(`✅ [ExternalService][ReportHandler] 외부 시스템(${systemName})으로부터 단말기 상태 정보 ${deviceList.length}건 처리 완료.`);
        res.status(200).json({ message: '단말기 상태 정보 처리 완료.' });

    } catch (err) {

        // --- 오류 발생 시 롤백 ---
        if (client) {
            await client.query('ROLLBACK');
            logger.warn('🔔 [ExternalService][ReportHandler] DB 트랜잭션 롤백.');
        }
        logger.error(`🚨 [ExternalService][ReportHandler] 단말기 상태 정보 처리 오류 (System: ${systemName}, Path: ${req.path}): ${err.message}`);        
        next(err);

    } finally {

        // --- 사용한 클라이언트 반환 ---
        if (client) {
            client.release();
            logger.debug('✅ [ExternalService][ReportHandler] DB 클라이언트 반환 완료.');
        }        

    }

};

/**
 * 재난 정보 결과 보고를 처리합니다.
 * @param {import('express').Request} req - Express 요청 객체
 * @param {import('express').Response} res - Express 응답 객체
 * @param {import('express').NextFunction} next - 다음 미들웨어 함수
 */
const handleDisasterResultReport = async (req, res, next) => {

    const systemName = req.externalSystem?.system_name;
    let client;

    try {

        client = await pool.getClient();
        logger.debug(`🚀 [ExternalService][ReportHandler] 재난 정보 결과 보고 처리 시작 (System: ${systemName}, Path: ${req.path})...`);

        const { externalSystem } = req;
        const { identifier, reportList } = req.body;

        // --- 트랜잭션 시작 ---
        await client.query('BEGIN');
        logger.debug(`🚀 [ExternalService][ReportHandler] DB 트랜잭션 시작...`);

        // 1. API 수신 로그를 기록합니다.
        const apiReceiveLogId = await apiReceiveLogRepository.create(
            {
                externalSystemId: externalSystem.id,
                requestPath: req.path,
                requestBody: req.body,
            },
            client
        );
        logger.debug(`✅ [ExternalService][ReportHandler] API 수신 로그 기록 완료 (api_receive_log ID: ${apiReceiveLogId}).`);

        // 2. 중앙 서비스로 보낼 보고 메시지를 아웃박스(report_publish_logs)에 저장합니다.
        await reportPublishLogRepository.create(
            {
                type: 'DISASTER_RESULT',
                externalSystemName: externalSystem.system_name,
                apiReceiveLogId,
                routingKey: REPORT_ROUTING_KEY,
                rawMessage: { identifier, reportList },                
            },
            client
        );
        logger.debug('✅ [ExternalService][ReportHandler] 보고 정보 아웃박스 기록 완료.');

        // --- 트랜잭션 커밋 ---
        await client.query('COMMIT');
        logger.debug('✅ [ExternalService][ReportHandler] DB 트랜잭션 커밋 완료.');
        
        logger.info(`✅ [ExternalService][ReportHandler] 외부 시스템(${systemName})으로부터 재난[${identifier}] 결과 ${reportList.length}건 처리 완료.`);
        res.status(200).json({ message: '재난 정보 처리 결과가 성공적으로 처리되었습니다.' });

    } catch (err) {

        // --- 오류 발생 시 롤백 ---
        if (client) {
            await client.query('ROLLBACK');
            logger.warn('🔔 [ExternalService][ReportHandler] DB 트랜잭션 롤백.');
        }
        logger.error(`🚨 [ExternalService][ReportHandler] 재난 정보 결과 보고 처리 오류 (System: ${systemName}, Path: ${req.path}): ${err.message}`);  
        next(err);

    } finally {

        // --- 사용한 클라이언트 반환 ---
        if (client) {
            client.release();
            logger.debug('✅ [ExternalService][ReportHandler] DB 클라이언트 반환 완료.');
        }        

    }

};

module.exports = {
    handleDeviceInfoReport,
    handleDeviceStatusReport,
    handleDisasterResultReport,
};

