import { Request, Response } from 'express';
import { Pool } from 'pg';
import createHealthRouter, { healthReadyHandler } from './health';
import request from 'supertest';
import app from '../index';
import { closePool } from '../db/client';

// Mock fetch for Stellar check
global.fetch = jest.fn();

afterAll(async () => {
    await closePool();
});

describe('Health Router', () => {
    let mockPool: jest.Mocked<Pool>;
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
        mockPool = {
            query: jest.fn(),
        } as unknown as jest.Mocked<Pool>;

        jsonMock = jest.fn();
        statusMock = jest.fn().mockReturnValue({ json: jsonMock });

        mockReq = {};
        mockRes = {
            status: statusMock,
            json: jsonMock,
        };

        jest.clearAllMocks();
    });

    it('should return 200 when both DB and Stellar are up', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
    });

    it('should return 503 when DB is down', async () => {
        (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('Connection timeout'));

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Database is down' });
        expect(global.fetch).not.toHaveBeenCalled(); // DB checked first
    });

    it('should return 503 when Stellar Horizon is down', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Stellar Horizon is down' });
    });

    it('should return 503 when Stellar Horizon returns non-OK status', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

        const handler = healthReadyHandler(mockPool);
        await handler(mockReq as Request, mockRes as Response);

        expect(statusMock).toHaveBeenCalledWith(503);
        expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Stellar Horizon is down' });
    });

    it('should create returning router instance', () => {
        const router = createHealthRouter(mockPool);
        expect(router).toBeDefined();
        expect(typeof router.get).toBe('function');
    });
});

describe('API Version Prefix Consistency tests', () => {
    it('should resolve /health without API prefix', async () => {
        const res = await request(app).get('/health');
        expect([200, 503]).toContain(res.status);
    });

    it('should resolve api routes with API_VERSION_PREFIX', async () => {
        const prefix = process.env.API_VERSION_PREFIX ?? '/api/v1';
        const res = await request(app).get(`${prefix}/overview`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('name', 'Stellar RevenueShare (Revora) Backend');
    });

    it('should return 404 for api routes without prefix', async () => {
        const res = await request(app).get('/overview');
        expect(res.status).toBe(404);
    });
    
    it('should correctly scope protected endpoints under the prefix', async () => {
        const prefix = process.env.API_VERSION_PREFIX ?? '/api/v1';
        // Hit milestone validation route (requires auth)
        const res = await request(app).post(`${prefix}/vaults/vault-1/milestones/milestone-1/validate`);
        expect(res.status).toBe(401);
    });
    
    it('should 404 for protected endpoints if prefix is lacking', async () => {
        const res = await request(app).post('/vaults/vault-1/milestones/milestone-1/validate');
        expect(res.status).toBe(404);
    });
});

describe('JWT Claim Validation tests', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jwtLib = require('jsonwebtoken');
    const SECRET = 'test-secret-key-that-is-at-least-32-characters-long!';
    const PREFIX = process.env.API_VERSION_PREFIX ?? '/api/v1';

    beforeAll(() => { process.env.JWT_SECRET = SECRET; });
    afterEach(() => { process.env.JWT_SECRET = SECRET; });

    function sign(payload: object, opts: object = {}): string {
        return jwtLib.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '1h', ...opts });
    }

    it('should return 200 and user claims for a valid token', async () => {
        const token = sign({ sub: 'user-abc', email: 'user@example.com' });
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.user.sub).toBe('user-abc');
        expect(res.body.user.email).toBe('user@example.com');
    });

    it('should return 401 when Authorization header is missing', async () => {
        const res = await request(app).get(`${PREFIX}/me`);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
        expect(res.body.message).toMatch(/Authorization header missing/i);
    });

    it('should return 401 for non-Bearer authorization scheme', async () => {
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', 'Basic dXNlcjpwYXNz');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
        expect(res.body.message).toMatch(/Bearer/i);
    });

    it('should return 401 with "Token has expired" for an expired token', async () => {
        const token = sign({ sub: 'user-abc' }, { expiresIn: '-1s' });
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Token has expired');
    });

    it('should return 401 when sub claim is missing', async () => {
        const token = jwtLib.sign({ email: 'no-sub@example.com' }, SECRET, { algorithm: 'HS256' });
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
        expect(res.body.message).toMatch(/subject.*sub/i);
    });

    it('should return 401 when iat claim is in the future', async () => {
        // Craft token manually so iat is guaranteed to be in the future.
        // jsonwebtoken's noTimestamp + manual iat is unreliable across versions.
        const crypto = require('crypto');
        const futureIat = Math.floor(Date.now() / 1000) + 7200; // 2h ahead, beyond 30s tolerance
        const futureExp = futureIat + 3600; // exp also in future so jwt.verify passes
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({ sub: 'user-abc', iat: futureIat, exp: futureExp })).toString('base64url');
        const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
        const token = `${header}.${body}.${sig}`;
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
        expect(res.body.message).toMatch(/iat.*future/i);
    });

    it('should return 401 when nbf claim is in the future', async () => {
        const futureNbf = Math.floor(Date.now() / 1000) + 7200;
        const token = jwtLib.sign(
            { sub: 'user-abc', nbf: futureNbf },
            SECRET,
            { algorithm: 'HS256', expiresIn: '1h' },
        );
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
        expect(res.body.message).toMatch(/not yet valid|nbf/i);
    });

    it('should return 401 for a tampered token (invalid signature)', async () => {
        const token = sign({ sub: 'user-abc' });
        const parts = token.split('.');
        const fakePayload = Buffer.from(
            JSON.stringify({ sub: 'attacker', iat: Math.floor(Date.now() / 1000) })
        ).toString('base64url');
        const tampered = `${parts[0]}.${fakePayload}.${parts[2]}`;
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', `Bearer ${tampered}`);
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/signature/i);
    });

    it('should return 401 for a token with invalid format', async () => {
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', 'Bearer not.a.valid.jwt.token');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 500 when JWT_SECRET is not configured', async () => {
        delete process.env.JWT_SECRET;
        const res = await request(app).get(`${PREFIX}/me`).set('Authorization', 'Bearer some.dummy.token');
        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/configuration/i);
    });
});
