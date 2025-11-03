/**
 * @file messageBrokerService.js
 * @description RabbitMQ와의 연결, 채널 관리, 메시지 발행(publish) 및 구독(consume)을 처리합니다.
 */

const amqp = require('amqplib');
const config = require('../../config');
const logger = require('../utils/logger');
const mqReceiveLogRepository = require('../repositories/mqReceiveLogRepository');
const reportTransmitLogRepository = require('../repositories/reportTransmitLogRepository');
const disasterPublishLogRepository = require('../repositories/disasterPublishLogRepository');
const pool = require('../repositories/pool');

let connection = null;
let channel = null;

const { 
    URL: RABBITMQ_URL,
    NAMES: {
        DISASTER_EXCHANGE,
        REPORT_EXCHANGE,
        REPORT_QUEUE,
        REPORT_DLX,
        REPORT_DLQ,
        REPORT_RETRY_EXCHANGE,
        REPORT_WAIT_QUEUE,
        REPORT_ROUTING_KEY,
    },
    RETRY_DELAY,
    MAX_RETRIES,
} = config.rabbitmq;

/**
 * RabbitMQ 서버에 연결하고 채널, Exchange, Queue를 설정합니다.
 */
async function start() {

    logger.info('🚀 [CentralService][MessageBroker] RabbitMQ 연결 및 설정 시작...');
    
    try {

        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        logger.info('🔌 [CentralService][MessageBroker] RabbitMQ 연결 완료.');

        // --- 1. 재난 정보 발행(Outbound)용 Exchange ---
        await channel.assertExchange(DISASTER_EXCHANGE, 'topic', { durable: true });
        logger.debug(`✅ [CentralService][MessageBroker] Exchange 생성/확인: ${DISASTER_EXCHANGE} (topic)`);

        // --- 2. 보고 정보 수신(Inbound)용 Exchange 및 Queue 설정 ---

        // 2-1. 메인 Exchange
        await channel.assertExchange(REPORT_EXCHANGE, 'direct', { durable: true });
        logger.debug(`✅ [CentralService][MessageBroker] Exchange 생성/확인: ${REPORT_EXCHANGE} (direct)`);

        // 2-2. 최종 실패(Dead Letter)용 Exchange 및 Queue
        // (MAX_RETRIES 초과 시 메시지가 최종적으로 안착하는 곳)
        await channel.assertExchange(REPORT_DLX, 'direct', { durable: true });
        logger.debug(`✅ [CentralService][MessageBroker] Exchange 생성/확인: ${REPORT_DLX} (direct)`);
        await channel.assertQueue(REPORT_DLQ, { durable: true });
        await channel.bindQueue(REPORT_DLQ, REPORT_DLX, REPORT_ROUTING_KEY);
        logger.debug(`✅ [CentralService][MessageBroker] Queue 생성/바인딩: ${REPORT_DLQ} -> ${REPORT_DLX} (${REPORT_ROUTING_KEY})`);

        // 2-3. 재시도(Retry)용 Exchange 및 'Wait' Queue
        // (메시지가 RETRY_DELAY 동안 대기하는 곳)
        await channel.assertExchange(REPORT_RETRY_EXCHANGE, 'direct', { durable: true });
        logger.debug(`✅ [CentralService][MessageBroker] Exchange 생성/확인: ${REPORT_RETRY_EXCHANGE} (direct)`);
        await channel.assertQueue(REPORT_WAIT_QUEUE, {
            durable: true,
            arguments: {
                // 메시지가 RETRY_DELAY 동안 대기 후,
                'x-message-ttl': RETRY_DELAY,
                // 지정된 Exchange(REPORT_EXCHANGE)로 자동 라우팅(Dead Letter)됩니다.
                'x-dead-letter-exchange': REPORT_EXCHANGE,
                'x-dead-letter-routing-key': REPORT_ROUTING_KEY
            }
        });
        await channel.bindQueue(REPORT_WAIT_QUEUE, REPORT_RETRY_EXCHANGE, REPORT_ROUTING_KEY);
        logger.debug(`✅ [CentralService][MessageBroker] Queue 생성/바인딩: ${REPORT_WAIT_QUEUE} -> ${REPORT_RETRY_EXCHANGE} (${REPORT_ROUTING_KEY})`);

        // 2-4. 메인 Queue
        // (메시지를 실제 소비(consume)하는 큐)
        await channel.assertQueue(REPORT_QUEUE, {
            durable: true,
            arguments: {
                // 이 큐에서 NACK(최종 실패) 처리된 메시지는 REPORT_DLX로 이동합니다.
                'x-dead-letter-exchange': REPORT_DLX,
                'x-dead-letter-routing-key': REPORT_ROUTING_KEY
            }
        });
        // 메인 Exchange와 메인 Queue를 바인딩합니다.
        await channel.bindQueue(REPORT_QUEUE, REPORT_EXCHANGE, REPORT_ROUTING_KEY);
        logger.debug(`✅ [CentralService][MessageBroker] Queue 생성/바인딩: ${REPORT_QUEUE} -> ${REPORT_EXCHANGE} (${REPORT_ROUTING_KEY})`);

        logger.info('✅ [CentralService][MessageBroker] Exchange/Queue 설정 완료.');

        // 보고 정부 수신 시작
        channel.consume(REPORT_QUEUE, _consumeReportMessage, { noAck: false }); // 수동 ACK 모드
        logger.info(`🚀 [CentralService][MessageBroker] "${REPORT_QUEUE}" 큐 소비 시작...`);

    } catch (err) {

        logger.error(`🚨 [CentralService][MessageBroker] RabbitMQ 시작 오류 발생: ${err.message}`);
        setTimeout(() => this.start(), 5000);
        throw err;
        
    }
    
    if (connection) {
        connection.on('error', (err) => {
            logger.error(`🚨 [CentralService][RabbitMQ] 연결 오류 발생: ${err.message}`);
        });

        connection.on('close', () => {
            logger.error('🔌 [CentralService][RabbitMQ] 연결 끊김. 5초 후 재연결 시도 예정.');
            // 연결이 닫히면, 재연결을 위해 변수를 초기화합니다.
            connection = null;
            channel = null;
            setTimeout(() => this.start(), 5000);
        });
    }        

}

/**
 * 보고 정보 큐로부터 메시지를 받아 처리하는 소비자(consumer) 함수입니다. (인박스 패턴)
 * @param {import('amqplib').ConsumeMessage | null} msg - RabbitMQ로부터 받은 메시지 객체
 */
async function _consumeReportMessage(msg) {
    
    if (!msg) {
        return;
    }

    let outboundId;
    let mqReceiveLogId;
    const messageString = msg.content.toString();
    const retryCount = (msg.properties.headers['x-retry-count'] || 0);
    const deliveryTag = msg.fields?.deliveryTag;

    logger.debug(`⬅️ [CentralService][MessageBroker] "${REPORT_QUEUE}" 메시지 수신 (Tag: ${deliveryTag}, Retry: ${retryCount})`);

    try {

        // --- 1단계: 먼저 메시지 기록 (독립적인 작업) ---
        // 이 단계가 실패하면 재시도 로직으로 넘어갑니다.
        mqReceiveLogId = await mqReceiveLogRepository.create(messageString);
        logger.debug(`✅ [CentralService][MessageBroker] 메시지 인박스 기록 완료 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId})`);

        // --- 2단계: 메시지 처리 (별도의 트랜잭션) ---
        const client = await pool.getClient();
        try {
            
            // 1.  트랜잭션을 시작합니다.
            await client.query('BEGIN');
            logger.debug(`✅ [CentralService][MessageBroker] DB 트랜잭션 시작 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId})`);

            // 2. 메시지 내용을 파싱하고 처리합니다.
            const messageContent = JSON.parse(messageString);
            logger.debug(`✅ [CentralService][MessageBroker] 메시지 파싱 완료 (Tag: ${deliveryTag}).`);
            const { type, externalSystemName, rawMessage } = messageContent;

            outboundId = `KR.${config.auth.DEST_ID}_${Date.now()}`;

            if (type === 'DISASTER_RESULT') {
                    const identifier = rawMessage.identifier;
                    const exists = await disasterPublishLogRepository.existsByIdentifier(identifier);
                    if (!exists) {
                        throw new Error(`device_publish_logs 테이블에 존재하지 않는 identifier = ${identifier}.`);
                    }
                    outboundId = `${identifier}_RPT_1`;
            }

            logger.debug(`🚀 [CentralService][MessageBroker] 보고 정보 처리 시작 (Type: ${type}, System: ${externalSystemName}, Outbound ID: ${outboundId}, mq_receive_log ID: ${mqReceiveLogId})...`);
            
            // 3. 보고 정보 아웃박스(report_transmit_logs)에 기록합니다.
            await reportTransmitLogRepository.create(mqReceiveLogId, type, outboundId, externalSystemName, rawMessage)
            logger.debug(`✅ [CentralService][MessageBroker] 보고 정보 아웃박스 기록 완료 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId})`);

            // 4. 인박스 로그 상태를 'SUCCESS'로 업데이트합니다.
            await mqReceiveLogRepository.updateStatus(mqReceiveLogId, 'SUCCESS', null, client);
            logger.debug(`✅ [CentralService][MessageBroker] DB 인박스 상태 SUCCESS 업데이트 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId})`);

            // 5. 트랜잭션을 커밋합니다.
            await client.query('COMMIT');
            logger.debug(`✅ [CentralService][MessageBroker] DB 트랜잭션 커밋 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId})`);

            // 6. 모든 DB 작업이 성공적으로 완료되었으므로, 큐에서 메시지를 안전하게 제거합니다.
            channel.ack(msg);
            logger.info(`✅ [CentralService][MessageBroker] 보고 메시지 처리 완료 (ID: ${outboundId}) mq_receive_log ID: ${mqReceiveLogId}). ACK 전송됨.`);

        } catch (dbErr) {

            // DB 트랜잭션 실패시 롤백
            if (client) {
                 try {
                    await client.query('ROLLBACK');
                    logger.warn(`🔔 [CentralService][MessageBroker] DB 트랜잭션 롤백 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId})`)
                } catch (rollbackErr) {
                    logger.error(`🚨🚨 [CentralService][DisasterHandler] DB 트랜잭션 롤백 실패: ${rollbackErr.message}`);
                }                
            }            
            logger.warn(`🔔 [CentralService][MessageBroker] 보고 메시지 처리 중 DB 오류 (Tag: ${deliveryTag}, mq_receive_log ID: ${mqReceiveLogId}): ${dbErr.message}. 재시도 로직 시작.`);
            // 재시도 로직을 타기 위해 이 오류를 바깥쪽 catch로 던집니다.
            throw dbErr;

        } finally {

            // 사용한 DB 클라이언트를 풀에 반환합니다.
            if (client) {
                client.release();
            }

        }    

    } catch (err) {

        // --- 3단계: 오류 처리 및 재시도 로직 ---
        logger.error(`🚨 [CentralService][MessageBroker] 보고 메시지 처리 오류 (mq_receive_log ID: ${mqReceiveLogId}, Tag: ${deliveryTag}, Retry: ${retryCount}): ${err.message}`);

        if (retryCount < MAX_RETRIES) {
            // [재시도]
            try {
                // 1. 재시도 횟수를 1 증가시켜 재시도 Exchange로 메시지를 보냅니다.
                // (이 메시지는 RETRY_DELY 시간 뒤 Wait Queue를 거쳐 메인 Exchange로 돌아옵니다)
                channel.publish(REPORT_RETRY_EXCHANGE, REPORT_ROUTING_KEY, msg.content, {
                    headers: {
                        'x-retry-count': retryCount + 1
                    },
                    persistent: true
                });
                // 2. 원본 메시지는 ACK 처리하여 큐에서 제거합니다. (재시도 큐로 이동했으므로)
                channel.ack(msg);
                logger.warn(`🔔 [CentralService][MessageBroker] 재시도 큐 발행 완료 (mq_receive_log ID: ${mqReceiveLogId}, Tag: ${deliveryTag}, Next Retry: ${retryCount + 1}/${MAX_RETRIES}). 원본 ACK.`);

            } catch (publishErr) {

                logger.err(`🚨🚨 [CentralService][MessageBroker] 재시도 큐 발행 실패: (mq_receive_log ID: ${mqReceiveLogId}, Tag: ${deliveryTag}): ${publishErr.message}. NACK 처리 (DLQ 이동).`);
                // 재시도 발행조차 실패하면, 원본 메시지를 NACK 처리하여 DLQ로 보냅니다.
                channel.nack(msg, false, false);

            }

        } else {

            // [최종 실패]
            logger.error(`🚨 [CentralService][MessageBroker] 최대 재시도(${MAX_RETRIES}) 초과 (mq_receive_log ID: ${mqReceiveLogId}, Tag: ${deliveryTag}). NACK 처리 (DLQ 이동).`);
            // 1. NACK 처리하여 메시지를 Dead Letter Queue(DLQ)로 보냅니다.
            channel.nack(msg, false, false);
            // 2. 로그 상태를 최종 'FAILED'로 업데이트
            if (mqReceiveLogId) {
                try {
                    await mqReceiveLogRepository.updateStatus(mqReceiveLogId, 'FAILED', `[Final Failed] ${err.message}`);
                    logger.debug(`✅ [CentralService][MessageBroker] 인박스 상태 FAILED 업데이트 완료 (mq_receive_log ID: ${mqReceiveLogId})`);
                } catch (updateErr) {
                    logger.error(`🚨🚨 [CentralService][MessageBroker] 인박스 상태 FAILED 업데이트 실패 (mq_receive_log ID: ${mqReceiveLogId}): ${updateErr.message}`);
                }
                
            }

        }
    
    }

}

/**
 * 중앙 시스템에서 수신한 재난 정보(CAP)를 RabbitMQ에 발행(publish)하여 external-service로 전달합니다. (disasterPublishWorker에 의해 호출됨)
 * @param {object} payload - 발행할 보고 메시지 객체
 * @param {string} routingKey - 메시지를 보낼 라우팅 키
 */
function publishDisaster(payload, routingKey) {

    logger.debug(`[CentralService][MessageBroker] 재난 정보 발행 시작 (RoutingKey: ${routingKey}, Identifier: ${payload?.identifier})...`);
    if (!channel) {
        const err = new Error('RabbitMQ 채널이 없음. 재난 정보 발행 불가.');
        logger.error(`🚨 [CentralService][MessageBroker] ${err.message}`);
        throw err; // 오류를 던져 워커가 재시도하도록 합니다.
    }

    try {
        channel.publish(DISASTER_EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), { persistent: true });
        logger.info(`➡️ [CentralService][MessageBroker] 재난 정보 발행 성공 (${DISASTER_EXCHANGE} -> ${routingKey}, Identifier: ${payload?.identifier}).`);
    } catch (err) {
        logger.error(`🚨 [CentralService][MessageBroker] 재난 정보 발행 중 오류 (Exchange: ${DISASTER_EXCHANGE}, RoutingKey: ${routingKey}): ${err.stack}`, payload);
        throw err; // 오류를 던져 워커가 재시도하도록 합니다.
    }

}

/**
 * RabbitMQ 연결을 안전하게 종료합니다.
 */
async function disconnect() {
    logger.info('🔌 [CentralService][MessageBroker] RabbitMQ 연결 종료 시작...');
    try {
        if (channel) {
            await channel.close();
        }
        if (connection) {
            await connection.close();
        }
        logger.info(`✅ [CentralService][MessageBroker] RabbitMQ 연결 종료 완료.`);
    } catch (err) {
        logger.error(`🚨 [CentralService][MessageBroker] RabbitMQ 연결 종료 중 오류 발생: ${err.stack}`);
    }

}

module.exports = {
    start,
    publishDisaster,
    disconnect,
};