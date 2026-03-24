import { Request, Response } from 'express';
import { Pool } from 'pg';
import { healthReadyHandler } from './health';

// Mock fetch for Stellar check
global.fetch = jest.fn();

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

    /**
     * Test cases for successful health checks
     * @notice These tests verify the health endpoint responds correctly when all services are operational
     */
    describe('Successful Health Checks', () => {
        it('should return 200 when both DB and Stellar are up', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle multiple concurrent health checks', async () => {
            (mockPool.query as jest.Mock).mockResolvedValue({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            const handler = healthReadyHandler(mockPool);
            
            // Execute multiple concurrent health checks
            const promises = Array(5).fill(null).map(() => 
                handler(mockReq as Request, mockRes as Response)
            );
            
            await Promise.all(promises);

            expect(statusMock).toHaveBeenCalledTimes(5);
            expect(statusMock).toHaveBeenLastCalledWith(200);
        });
    });

    /**
     * Test cases for database failure scenarios
     * @notice These tests verify proper error handling when database is unavailable
     */
    describe('Database Failure Scenarios', () => {
        it('should return 503 when DB is down', async () => {
            (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('Connection timeout'));

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(503);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Database is down' });
            expect(global.fetch).not.toHaveBeenCalled(); // DB checked first
        });

        it('should handle database connection refused error', async () => {
            (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(503);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Database is down' });
        });

        it('should handle database query timeout', async () => {
            (mockPool.query as jest.Mock).mockRejectedValueOnce(new Error('Query timeout'));

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(503);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Database is down' });
        });

        it('should handle empty database response', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(503);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Database is down' });
        });
    });

    /**
     * Test cases for Stellar Horizon failure scenarios
     * @notice These tests verify proper error handling when Stellar Horizon is unavailable
     */
    describe('Stellar Horizon Failure Scenarios', () => {
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

        it('should handle Stellar Horizon timeout', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ETIMEDOUT'));

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(503);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Stellar Horizon is down' });
        });

        it('should handle Stellar Horizon DNS resolution failure', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ENOTFOUND'));

            const handler = healthReadyHandler(mockPool);
            await handler(mockReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(503);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'error', message: 'Stellar Horizon is down' });
        });
    });

    /**
     * Test cases for input sanitization edge cases
     * @notice These tests verify that the health endpoint handles malicious inputs safely
     */
    describe('Input Sanitization Edge Cases', () => {
        it('should handle script injection attempts in query parameters', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            // Mock request with malicious query parameters
            const maliciousReq = {
                query: {
                    test: '<script>alert("xss")</script>',
                    payload: 'javascript:alert("xss")',
                    handler: 'onclick="alert("xss")"'
                }
            } as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(maliciousReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle empty string inputs', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const emptyReq = {
                query: { test: '', param: '', value: '' },
                params: { id: '' }
            } as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(emptyReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle null and undefined inputs', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const nullReq = {
                query: { test: null, param: undefined },
                params: { id: null }
            } as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(nullReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle SQL injection attempts', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const sqlInjectionReq = {
                query: {
                    id: "'; DROP TABLE users; --",
                    test: "' OR '1'='1",
                    payload: "'; INSERT INTO users VALUES('hacker'); --"
                }
            } as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(sqlInjectionReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle XSS payload with various encodings', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const xssReq = {
                query: {
                    encoded: '%3Cscript%3Ealert%28%22xss%22%29%3C%2Fscript%3E',
                    html: '<img src="x" onerror="alert(\'xss\')">',
                    vector: '<svg onload="alert(\'xss\')">'
                }
            } as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(xssReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle extremely long input strings', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const longString = 'a'.repeat(10000) + '<script>alert("xss")</script>';
            const longReq = {
                query: { long: longString }
            } as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(longReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });
    });

    /**
     * Test cases for malformed request objects
     * @notice These tests verify robustness when request objects are malformed
     */
    describe('Malformed Request Handling', () => {
        it('should handle request with no properties', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const emptyReq = {} as Partial<Request>;

            const handler = healthReadyHandler(mockPool);
            await handler(emptyReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });

        it('should handle request with circular references', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const circularReq: any = { query: {} };
            circularReq.query.self = circularReq;

            const handler = healthReadyHandler(mockPool);
            await handler(circularReq as Request, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ status: 'ok', db: 'up', stellar: 'up' });
        });
    });

    /**
     * Performance and reliability tests
     * @notice These tests verify the health endpoint performs well under various conditions
     */
    describe('Performance and Reliability', () => {
        it('should respond within acceptable time limits', async () => {
            (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

            const handler = healthReadyHandler(mockPool);
            const startTime = Date.now();
            
            await handler(mockReq as Request, mockRes as Response);
            
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
        });

        it('should handle rapid successive requests', async () => {
            (mockPool.query as jest.Mock).mockResolvedValue({ rows: [{ '?column?': 1 }] });
            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            const handler = healthReadyHandler(mockPool);
            
            // Make 10 rapid requests
            for (let i = 0; i < 10; i++) {
                await handler(mockReq as Request, mockRes as Response);
            }

            expect(statusMock).toHaveBeenCalledTimes(10);
            expect(statusMock).toHaveBeenLastCalledWith(200);
        });
    });
});
