/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 * @description 이 마이그레이션은 central-service에 필요한 초기 테이블과 트리거를 생성합니다.
 */
exports.shorthands = undefined;

/**
 * up 함수: 마이그레이션을 적용할 때(npm run migrate up) 실행됩니다.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {

    console.log('🚀 [CentralService][Migrate] 초기 스키마 마이그레이션 시작...');

    // --- 1. updated_at 자동 업데이트를 위한 트리거 함수 생성 ---
    pgm.createFunction(
        'update_timestamp',
        [],
        {
            returns: 'TRIGGER',
            language: 'plpgsql',
            security: 'DEFINER',
        },
        `
            BEGIN
                -- NEW는 트리거를 발생시킨 행의 새로운 버전을 의미합니다.
                -- 이 행의 updated_at 컬럼을 현재 시간으로 설정합니다.
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
        `
    );
    pgm.sql('GRANT EXECUTE ON FUNCTION update_timestamp() TO PUBLIC;');
    console.log('✅ [CentralService][Migrate] "update_timestamp" 함수 생성 및 권한 부여 성공.');

    // --- 2. TCP 수신 로그 ---
    pgm.createTable('tcp_receive_logs', {
        id: { type: 'bigserial', primaryKey: true },
        inbound_id: { type: 'text' }, // 중앙 시스템에서 온 발신 ID(transMsgId)
        inbound_seq: { type: 'integer' }, // 중앙 시스템에서 온 발신 SEQ(transMsgSeq)
        raw_message: { type : 'jsonb', notNull: true }, // 파싱된 CAP 메시지 객체
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SUCCESS', 'FAILED')" },
        error_message: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createConstraint('tcp_receive_logs', 'unique_tcp_receive_log', {
        unique: ['inbound_id', 'inbound_seq'],
    });
    console.log('✅ [CentralService][Migrate] "tcp_receive_logs" 테이블과 제약조건 생성 성공.');

    // --- 3. 재난 정보 발행 로그 ---
    pgm.createTable('disaster_publish_logs', {
        id: { type: 'bigserial', primaryKey: true },
        tcp_receive_log_id: { type: 'bigint', notNull: true, references: 'tcp_receive_logs', onDelete: 'NO ACTION' },
        routing_key: { type: 'text', notNull: true },
        identifier: { type: 'text', notNull: true, unique: true }, // CAP의 identifier
        event_code: { type: 'text', notNull: true }, // 재난 정보 Event Code
        raw_message: { type: 'jsonb', notNull: true },
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SENT', 'SUCCESS', 'FAILED')"},
        retry_count: { type: 'integer', notNull: true, default: 0 },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('disaster_publish_logs', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp'
    });
    pgm.createIndex('disaster_publish_logs', ['status', 'updated_at']);
    console.log('✅ [CentralService][Migrate] "disaster_publish_logs" 테이블과 트리거, 인덱스 생성 성공.');

    // --- 4. 메시지큐 수신 로그 ---
    pgm.createTable('mq_receive_logs', {
        id: { type: 'bigserial', primaryKey: true },
        raw_message: { type: 'text', notNull: true },
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SUCCESS', 'FAILED')" },
        error_message: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('mq_receive_logs', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('mq_receive_logs', ['status', 'updated_at']);
    console.log('✅ [CentralService][Migrate] "mq_receive_logs" 테이블과 트리거, 인덱스 생성 성공.');

    // --- 5. 보고 정보 발신 로그 ---
    pgm.createTable('report_transmit_logs', {
        id: { type: 'bigserial', primaryKey: true },
        mq_receive_log_id: { type: 'bigint', notNull: true, references: 'mq_receive_logs', onDelete: 'NO ACTION' },
        type: { type: 'text', notNull: true, check: "type IN ('DISASTER_RESULT', 'DEVICE_INFO', 'DEVICE_STATUS')" },
        outbound_id: { type: 'text', notNull: true }, // 게이트 웨이에서 생성한 발신 ID(transMsgId)
        external_system_name: { type: 'text', notNull: true }, // 이 요청을 시작한 외부 시스템명
        raw_message: { type: 'jsonb', notNull: true }, // 파싱된 CAP 메시지 객체
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SENT', 'SUCCESS', 'FAILED')"},
        retry_count: { type: 'integer', notNull: true, default: 0 },
        error_detail: { type: 'text' },
        report_sequence: { type: 'integer', notNull: true, default: 1 },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('report_transmit_logs', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('report_transmit_logs', ['status', 'updated_at']);
    console.log('✅ [CentralService][Migrate] "report_transmit_logs" 테이블과 트리거, 인덱스 생성 성공.');

    console.log('✅ [CentralService][Migrate] [CentralService] 초기 스키마 마이그레이션 완료.');

};

/**
 * down 함수: 마이그레이션을 되돌릴 때(npm run migrate down) 실행됩니다.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {

    console.log('🚀 [CentralService][Migrate] 초기 스키마 마이그레이션 롤백 시작...');

    // 테이블 삭제 (생성의 역순)
    pgm.dropTable('report_transmit_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [CentralService][Migrate] "report_transmit_logs" 테이블 삭제 성공.');

    pgm.dropTable('mq_receive_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [CentralService][Migrate] "mq_receive_logs" 테이블 삭제 성공.');
    
    pgm.dropTable('disaster_publish_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [CentralService][Migrate] "disaster_publish_logs" 테이블 삭제 성공.');

    pgm.dropTable('tcp_receive_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [CentralService][Migrate] "tcp_receive_logs" 테이블 삭제 성공.');

    // 트리거 함수 삭제
    pgm.dropFunction('update_timestamp', [], { ifExists: true, cascade: true } );
    console.log('✅ [CentralService][Migrate] "update_timestamp" 함수 삭제 성공.');

    console.log('✅ [CentralService][Migrate] 초기 스키마 마이그레이션 롤백 완료.');

};
