/**
 * @file messageBrokerService.js
 * @description RabbitMQ 메시지 브로커와의 상호작용을 관리합니다.
 * '트랜잭셔널 인박스' 패턴으로 재난 정보를 수신하고, '아웃박스'의 보고 내용을 발행합니다.
 */

const amqp = require('amqplib');
const logger = require('../utils/logger');
const config = require('../../config');
const externalSystemRepository = require('../repositories/externalSystemRepository');
const disasterTransmitLogRepository = require('../repositories/disasterTransmitLogRepository');
const mqReceiveLogRepository = require('../repositories/mqReceiveLogRepository');
const pool = require('../repositories/pool');

let connection = null;
let channel = null;

const {
    URL: RABBITMQ_URL,
    NAMES: {
        DISASTER_EXCHANGE, 
        DISASTER_QUEUE, 
        REPORT_EXCHANGE,
        DISASTER_DLQ,
        DISASTER_DLX,
        DISASTER_RETRY_EXCHANGE,
        DISASTER_WAIT_QUEUE,
    },
    RETRY_DELAY,
    MAX_RETRIES,    
} = config.rabbitmq;

/**
 * RabbitMQ 서버에 연결하고 채널, Exchange, Queue를 설정합니다.
 */
async function start() {

    logger.info('🚀 [ExternalService][MessageBroker] RabbitMQ 연결 및 설정 시작...');
    
    try {

        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        logger.info('🔌 [ExternalService][MessageBroker] RabbitMQ 연결 완료.');

        connection.on('error', (err) => {
            logger.error(`🚨 [ExternalService][RabbitMQ] 연결 오류 발생: ${err.message}`);
        });

        connection.on('close', () => {
            logger.error('🚨 [ExternalService][RabbitMQ] 연결 끊김. 5초 후 재연결 시도 예정.');
            // 연결이 닫히면, 재연결을 위해 변수를 초기화합니다.
            connection = null;
            channel = null;
            setTimeout(() => this.start(), 5000);
        }); 

        // --- 1. 보고 정보 발행(Outbound)용 Exchange ---
        await channel.assertExchange(REPORT_EXCHANGE, 'direct', { durable: true });
        logger.debug(`✅ [ExternalService][MessageBroker] Exchange 생성/확인: ${REPORT_EXCHANGE} (direct).`);

        // --- 2. 재난 정보 수신(Inbound)용 Exchange 및 Queue 설정 ---

        // 2-1. 메인 Exchange
        await channel.assertExchange(DISASTER_EXCHANGE, 'topic', { durable: true });
        logger.debug(`✅ [ExternalService][MessageBroker] Exchange 생성/확인: ${DISASTER_EXCHANGE} (topic).`);

        // 2-2. 최종 실패(Dead Letter)용 Exchange 및 Queue
        // (MAX_RETRIES 초과 시 메시지가 최종적으로 안착하는 곳)
        await channel.assertExchange(DISASTER_DLX, 'direct', { durable: true });
        logger.debug(`✅ [ExternalService][MessageBroker] Exchange 생성/확인: ${DISASTER_DLX} (direct).`);
        await channel.assertQueue(DISASTER_DLQ, { durable: true });
        await channel.bindQueue(DISASTER_DLQ, DISASTER_DLX, '#');
        logger.debug(`✅ [ExternalService][MessageBroker] Queue 생성/바인딩: ${DISASTER_DLQ} -> ${DISASTER_DLX} (#).`);

        // 2-3. 재시도(Retry)용 Exchange 및 'Wait' Queue
        // (메시지가 RETRY_DELAY 동안 대기하는 곳)
        await channel.assertExchange(DISASTER_RETRY_EXCHANGE, 'topic', { durable: true });
        logger.debug(`✅ [ExternalService][MessageBroker] Exchange 생성/확인: ${DISASTER_RETRY_EXCHANGE} (topic).`);
        await channel.assertQueue(DISASTER_WAIT_QUEUE, {
            durable: true,
            arguments: {
                // 메시지가 RETRY_DELAY 동안 대기 후,
                'x-message-ttl': RETRY_DELAY,
                // 지정된 Exchange(REPORT_EXCHANGE)로 자동 라우팅(Dead Letter)됩니다.
                'x-dead-letter-exchange': DISASTER_EXCHANGE,
            }
        });
        await channel.bindQueue(DISASTER_WAIT_QUEUE, DISASTER_RETRY_EXCHANGE, '#');
        logger.debug(`✅ [ExternalService][MessageBroker] Queue 생성/바인딩: ${DISASTER_WAIT_QUEUE} -> ${DISASTER_RETRY_EXCHANGE} (#).`);

        // 2-4. 메인 Queue
        // (메시지를 실제 소비(consume)하는 큐)
        await channel.assertQueue(DISASTER_QUEUE, {
            durable: true,
            exclusive: false,
            arguments: {
                // 이 큐에서 NACK(최종 실패) 처리된 메시지는 DISASTER_DLX 이동합니다.
                'x-dead-letter-exchange': DISASTER_DLX,
            }
        });
        // 메인 Exchange와 메인 Queue를 바인딩합니다.
        await channel.bindQueue(DISASTER_QUEUE, DISASTER_EXCHANGE, 'disaster.*');
        logger.debug(`✅ [ExternalService][MessageBroker] Queue 생성/바인딩: ${DISASTER_QUEUE} -> ${DISASTER_EXCHANGE} (disaster.*).`);

        logger.info('✅ [ExternalService][MessageBroker] Exchange/Queue 설정 완료.');

        // 재난 정보 수신 시작
        channel.consume(DISASTER_QUEUE, _consumeDisasterMessage, { noAck: false }); // 수동 ACK 모드
        logger.info(`🚀 [ExternalService][MessageBroker] "${DISASTER_QUEUE}" 큐 소비 시작...`);
 
    } catch (err) {

        logger.error(`🚨 [ExternalService][MessageBroker] RabbitMQ 시작 오류 발생: ${err.message}`);
        setTimeout(() => start(), 5000);
        throw err;

    }  

}

/**
 * 재난 정보 큐로부터 메시지를 받아 처리하는 소비자(consumer) 함수입니다. (인박스 패턴)
 * @param {import('amqplib').ConsumeMessage | null} msg - RabbitMQ로부터 받은 메시지 객체
 */
async function _consumeDisasterMessage(msg) {
    
    if (!msg) {
        return;
    }

    let mqReceiveLogId;
    const messageString = msg.content.toString();
    const routingKey = msg.fields.routingKey; // 예: 'disaster.HTW'
    const retryCount = (msg.properties.headers['x-retry-count'] || 0);
    const deliveryTag = msg.fields?.deliveryTag;
    let identifier = 'N/A';
    let client;

    logger.debug(`⬅️ [ExternalService][MessageBroker] 메시지 수신 (Tag: ${deliveryTag}, Retry: ${retryCount}).`);

    try {

        // --- 1단계: 먼저 메시지 기록 (독립적인 작업) ---
        // 만약 이 단계에서 DB 오류가 발생하면, 외부 catch 블록으로 이동하여 메시지를 DLQ로 보냅니다.
        mqReceiveLogId = await mqReceiveLogRepository.create(messageString);
        logger.debug(`✅ [ExternalService][MessageBroker] 메시지 인박스 기록 완료 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId}).`);

        // --- 2단계: 메시지 처리 (별도의 트랜잭션) ---
        // 이 단계부터는 메시지가 DB에 기록된 것이 보장됩니다.
        client = await pool.getClient();
        try {
            
            // 1.  트랜잭션을 시작합니다.
            await client.query('BEGIN');
            logger.debug(`🚀 [ExternalService][MessageBroker] DB 트랜잭션 시작 (mq_receive_log ID: ${mqReceiveLogId})...`);

            // 2. 메시지 내용을 파싱하고 처리합니다.
            const messageContent = JSON.parse(messageString);
            identifier = messageContent.identifier;

            logger.debug(`🚀 [ExternalService][MessageBroker] 재난 정보 처리 시작 (Identifier: ${identifier}, Event: ${messageContent.eventCode})...`);

            // 3. 해당 재난 코드를 구독하는 활성 시스템 목록을 조회합니다.
            const subscribedSystems = await externalSystemRepository.findBySubscribedEventCode(messageContent.eventCode);
            logger.debug(`✅ [ExternalService][MessageBroker] 구독 시스템 조회 완료 (${subscribedSystems.length}개).`);

            if (subscribedSystems.length > 0) {
                // 4. 각 시스템에 대한 발신 로그(아웃박스) 데이터를 준비합니다.
                const logsToCreate = subscribedSystems.map((system) => ({
                    mqReceiveLogId,
                    externalSystemId: system.id,
                    identifier,
                    rawMessage: messageContent,
                }));

                // 5. 재난 정보 아웃박스(disaster_transmit_logs)에 일괄 기록합니다.
                await disasterTransmitLogRepository.createBulk(logsToCreate, client);
                logger.info(`✅ [ExternalService][MessageBroker] 재난 정보 [${identifier}] 발신 로그 ${subscribedSystems.length}개 생성 완료.`);
            }

            // 6. 인박스 로그 상태를 'SUCCESS'로 업데이트합니다.
            await mqReceiveLogRepository.updateStatus(mqReceiveLogId, 'SUCCESS', null, client);
            logger.debug('✅ [ExternalService][MessageBroker] 인박스 상태 SUCCESS 업데이트 완료.');

            // 7. 트랜잭션을 커밋합니다.
            await client.query('COMMIT');
            logger.debug('✅ [ExternalService][MessageBroker] DB 트랜잭션 커밋 완료.');

            // 8. 모든 DB 작업이 성공적으로 완료되었으므로, 큐에서 메시지를 안전하게 제거합니다.
            channel.ack(msg);

        } catch (dbErr) {

            // 오류 발생 시 트랜잭션 롤백합니다.
            if (client) {
                await client.query('ROLLBACK');
                logger.warn('🔔 [ExternalService][MessageBroker] DB 트랜잭션 롤백.');
            }            
            logger.warn(`🔔 [ExternalService][MessageBroker] DB 오류 발생 (Identifier: ${identifier}): ${dbErr.message}. 재시도 시작.`);
            // 재시도 로직을 타기 위해 이 오류를 바깥쪽 catch로 던집니다.
            throw dbErr;

        } finally {

            // 사용한 클라이언트를 반환합니다.
            if (client) {
                client.release();
            }

        }    

    } catch (err) {

        // --- 3단계: 오류 처리 및 재시도 로직 ---
        logger.error(`🚨 [ExternalService][MessageBroker] 재난 메시지 최종 처리 오류 (Identifier: ${identifier}, mq_receive_log ID: ${mqReceiveLogId}, Retry: ${retryCount}): ${err.message}`);

        if (retryCount < MAX_RETRIES) {
            // [재시도]
            try {
                // 1. 재시도 횟수를 1 증가시켜 재시도 Exchange로 메시지를 보냅니다.
                // Tocpic Exchange이므로 원본 라우팅 키를 그대로 사용합니다.
                channel.publish(DISASTER_RETRY_EXCHANGE, routingKey, msg.content, {
                    headers: {
                        'x-retry-count': retryCount + 1
                    },
                    persistent: true
                });
                // 2. 원본 메시지는 ACK 처리하여 큐에서 처리합니다.
                channel.ack(msg);
                logger.warn(`🔔 [ExternalService][MessageBroker] 재시도 큐 발행 완료 (Identifier: ${identifier}, Next Retry: ${retryCount + 1}/${MAX_RETRIES}). 원본 ACK.`);
            } catch (publishErr) {
                logger.error(`🚨🚨 [ExternalService][MessageBroker] 재시도 큐 발행 실패 (Identifier: ${identifier}): ${publishErr.message}. NACK 처리 (DLQ 이동).`);
                if (channel) {
                    channel.nack(msg, false, false); // DLQ로 이동
                }                
            }            

        } else {
            // [최종 실패]
            logger.error(`🚨 [ExternalService][MessageBroker] 최대 재시도(${MAX_RETRIES}) 초과 (Identifier: ${identifier}). NACK 처리 (DLQ 이동).`);
            if (channel) {
                channel.nack(msg, false, false); // DLQ로 이동
            }        
            if (mqReceiveLogId) {
                try {
                    await mqReceiveLogRepository.updateStatus(mqReceiveLogId, 'FAILED', `[Final Failed] ${err.message}`);
                    logger.debug('🚨 [ExternalService][MessageBroker] 인박스 상태 FAILED 업데이트 완료.');
                } catch (updateErr) {
                    logger.error(`🚨🚨 [ExternalService][MessageBroker] 최종 상태 FAILED 업데이트 실패 (mq_receive_log ID: ${mqReceiveLogId}): ${updateErr.message}`);
                }
            }
        }
    
    }

}

/**
 * 외부 시스템에서 수신한 보고 정보(를 RabbitMQ에 발행(publish)하여 central-service로 전달합니다. (reportPublishWorker에 의해 호출됨)
 * @param {object} payload - 발행할 보고 메시지 객체
 * @param {string} routingKey - 메시지를 보낼 라우팅 키
 */
function publishReport(payload, routingKey) {

    logger.debug(`➡️ [ExternalService][MessageBroker] 보고 정보 발행 시작 (Key: ${routingKey}).`);

    if (!channel) {
        const err = new Error('RabbitMQ 채널 없음. 보고 발행 불가.');
        logger.error(`🚨 [ExternalService][MessageBroker] ${err.message}`);
        throw err; // 오류를 던져 워커가 재시도하도록 합니다.
    }

    try {
        channel.publish(REPORT_EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), { persistent: true });
        logger.info(`✅ [ExternalService][MessageBroker] 보고 정보 발행 완료 (${REPORT_EXCHANGE} -> ${routingKey})`);
    } catch (err) {
        logger.error(`🚨 [ExternalService][MessageBroker] 보고 정보 발행 오류 (Exchange: ${REPORT_EXCHANGE}, Key: ${routingKey}): ${err.message}`);
        throw err; // 오류를 던져 워커가 재시도하도록 합니다.
    }

}

/**
 * RabbitMQ 연결을 안전하게 종료합니다.
 */
async function disconnect() {

    logger.info('🔌 [ExternalService][MessageBroker] RabbitMQ 연결 종료 시작.');
    
    try {
        if (channel) {
            await channel.close();
        }
        if (connection) {
            await connection.close();
        }
        logger.info('✅ [ExternalService][MessageBroker] RabbitMQ 연결 종료 완료.');
    } catch (err) {
        logger.error(`🚨 [ExternalService][MessageBroker] RabbitMQ 연결 종료 중 오류 발생: ${err.message}`);
    }

}

module.exports = {
    start,
    publishReport,
    disconnect,
};
