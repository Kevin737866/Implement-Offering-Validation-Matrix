import { Request, Response } from 'express';
import { Pool } from 'pg';
import createHealthRouter, { healthReadyHandler } from './health';
import request from 'supertest';
import app, { shutdown, setServer } from '../index';
import * as dbClient from '../db/client';
import * as http from 'http';

// Mock fetch for Stellar check
global.fetch = jest.fn();

afterAll(async () => {
    // Guard against pool already being ended by the graceful shutdown tests
    try { await dbClient.closePool(); } catch (_) { /* already ended - safe to ignore */ }
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

/**
 * @section Graceful Shutdown Completeness
 *
 * @dev Strategy:
 *  - Uses jest.spyOn on the real imported `dbClient` module to override `closePool`,
 *    avoiding the `jest.doMock` + dynamic import trap (modules are already bound at load time).
 *  - Injects a real `net.Server` listening on port 0 into the index module's exported
 *    `server` reference so the `server.close()` code path is exercised deterministically.
 *  - Mocks `process.exit` to prevent the test runner from terminating.
 *
 * Security paths covered:
 *  1. Happy path — clean server+DB close → exits 0
 *  2. Timeout path — stalled closePool triggers forced exit 1 after 10 s
 *  3. Error path — closePool rejection logs error and exits 1
 *  4. No-server path — server undefined (test env) skips server.close(), still exits 0
 */
describe('Graceful Shutdown Completeness', () => {
    let mockExit: jest.SpyInstance;
    let mockConsoleLog: jest.SpyInstance;
    let mockConsoleError: jest.SpyInstance;
    let closePoolSpy: jest.SpyInstance;
    let fakeServer: http.Server;

    beforeEach((done) => {
        // Prevent process.exit from killing the test runner
        mockExit = jest.spyOn(process, 'exit').mockImplementation((_code?: number | string | null | undefined) => undefined as never);
        mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
        mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Create a real http.Server listening on a random port so server.close() resolves immediately
        fakeServer = app.listen(0, done);
    });

    afterEach((done) => {
        jest.restoreAllMocks();
        if (fakeServer.listening) {
            fakeServer.close(done);
        } else {
            done();
        }
    });

    it('should stop HTTP server and close DB pool, then exit with 0', async () => {
        // Spy on real closePool to resolve successfully
        closePoolSpy = jest.spyOn(dbClient, 'closePool').mockResolvedValue(undefined);

        // Use setServer() to inject into module's internal let variable
        setServer(fakeServer);

        await shutdown('SIGTERM');

        expect(closePoolSpy).toHaveBeenCalledTimes(1);
        expect(mockConsoleLog).toHaveBeenCalledWith('[server] HTTP server closed.');
        expect(mockConsoleLog).toHaveBeenCalledWith('[server] Graceful shutdown complete.');
        expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should forcibly exit with 1 when shutdown times out (stalled closePool)', async () => {
        jest.useFakeTimers();

        // closePool never resolves — simulates a hanging DB connection
        closePoolSpy = jest.spyOn(dbClient, 'closePool').mockImplementation(() => new Promise(() => {}));

        setServer(fakeServer);

        // Fire shutdown without awaiting (it will stall on closePool)
        shutdown('SIGINT');

        // Advance past the 10 s hard-timeout threshold
        jest.advanceTimersByTime(11000);

        expect(mockConsoleError).toHaveBeenCalledWith(
            expect.stringContaining('timeout exceeded')
        );
        expect(mockExit).toHaveBeenCalledWith(1);

        jest.useRealTimers();
    });

    it('should exit with 1 when closePool throws during shutdown', async () => {
        closePoolSpy = jest.spyOn(dbClient, 'closePool').mockRejectedValue(
            new Error('Fatal DB Close Failure')
        );

        setServer(fakeServer);

        await shutdown('SIGTERM');

        expect(mockConsoleError).toHaveBeenCalledWith(
            '[server] Error during shutdown:',
            expect.any(Error)
        );
        expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should skip server.close() and still exit cleanly when server is undefined', async () => {
        // Validates the branch where the process was started in test mode (no server bound)
        closePoolSpy = jest.spyOn(dbClient, 'closePool').mockResolvedValue(undefined);

        // Validate branch where server was never started (test mode)
        setServer(undefined);

        await shutdown('SIGTERM');

        // server.close() log must NOT appear — that branch was skipped
        expect(mockConsoleLog).not.toHaveBeenCalledWith('[server] HTTP server closed.');
        expect(mockConsoleLog).toHaveBeenCalledWith('[server] Graceful shutdown complete.');
        expect(mockExit).toHaveBeenCalledWith(0);
    });
});
