/**
 * @file createDatabase.js
 * @description .env 파일의 설정에 따라 PostgreSQL 데이터베이스를 생성합니다.
 * 데이터베이스가 이미 존재하면 조용히 종료됩니다.
 * 이 스크립트는 'postgres'와 같은 기본 데이터베이스에 최고 관리자 권한으로 연결하여 실행해야 합니다.
 */

const { Client } = require('pg');
const format = require('pg-format');

async function createDatabase() {

    // 1. .env 파일에서 필요한 환경 변수를 가져옵니다.
    // DFPG* 변수: DB 생성을 위한 최고 관리자 계정 정보
    // PG* 변수: 새로 생성할 애플리케이션 DB 정보
    const client = new Client({
        host: process.env.DFPGHOST,
        port: parseInt(process.env.DFPGPORT, 10),
        user: process.env.DFPGUSER,
        password: process.env.DFPGPASSWORD,
        database: process.env.DFPGDATABASE,
    });
    const newDbName = process.env.PGDATABASE;
    const newDbUser = process.env.PGUSER;

    if (!newDbName || !newDbUser) {
        console.error('🚨 [CentralService][DBCreate] .env 파일에 PGDATABASE 또는 PGUSER 설정 누락. 스크립트 종료.');
        return;
    }
    
    try {        

        // 2. 관리자 계정으로 PostgreSQL 서버에 접속합니다.
        await client.connect();
        console.log(`🔌 [CentralService][DBCreate] PostgreSQL (${process.env.DFPGDATABASE} DB) 최고 관리자 연결 성공`);

        // 3. 생성하려는 데이터베이스가 이미 존재하는지 확인합니다.
        const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [newDbName]);
        
        if (rows.length > 0) {
            // 이미 데이터베이스가 존재하는 경우
            console.warn(`🔔 [CentralService][DBCreate] 데이터베이스 '${newDbName}' 이미 존재.`);
        } else {
            // 4. 데이터베이스가 존재하지 않는 경우, 새로 생성합니다.
            console.log(`🚀 [CentralService][DBCreate] 데이터베이스 '${newDbName}'을(를) 생성 시작...`);
            // SQL Injection을 방지하기 위해 pg-format으로 식별자를 안전하게 포맷팅합니다.
            const createDbQuery = format('CREATE DATABASE %I WITH OWNER = %I', newDbName, newDbUser);
            await client.query(createDbQuery);
            console.log(`✅ [CentralService][DBCreate] 데이터베이스 '${newDbName}' 생성 완료 (소유자: ${newDbUser}).`);

        }

    } catch (err) {

        console.error(`🚨 [CentralService][DBCreate] 데이터베이스 생성 중 오류 발생: ${err.message}`);
        process.exit(1);

    } finally {

        // 5. 모든 작업이 끝나면 클라이언트 연결을 안전하게 종료합니다.
        await client.end();
        console.log(`🔌 [CentralService][DBCreate] PostgreSQL 연결 종료.`);

    }

}

createDatabase();