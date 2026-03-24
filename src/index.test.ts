import { Request, Response, NextFunction } from 'express';
import { inputSanitizerMiddleware } from './index';

describe('Input Sanitizer Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
        mockNext = jest.fn();
        jest.clearAllMocks();
    });

    /**
     * Test cases for basic string sanitization
     * @notice These tests verify the core sanitization functionality
     */
    describe('Basic String Sanitization', () => {
        it('should sanitize HTML tags in request body', () => {
            mockReq = {
                body: {
                    name: '<script>alert("xss")</script>',
                    description: '<p>Safe content</p>'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.name).toBe('alert("xss")');
            expect(mockReq.body?.description).toBe('Safe content');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should encode HTML special characters', () => {
            mockReq = {
                body: {
                    content: '<div>&"\'/</div>'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.content).toBe('&lt;div&gt;&amp;&quot;&#x27;&#x2F;&lt;/div&gt;');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should remove JavaScript event handlers', () => {
            mockReq = {
                body: {
                    handler: 'onclick="alert("xss")"',
                    onload: 'onload="function()"'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.handler).toBe('');
            expect(mockReq.body?.onload).toBe('');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should remove javascript: protocol', () => {
            mockReq = {
                body: {
                    url: 'javascript:alert("xss")',
                    safe: 'https://example.com'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.url).toBe('alert("xss")');
            expect(mockReq.body?.safe).toBe('https://example.com');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should trim whitespace from strings', () => {
            mockReq = {
                body: {
                    spaced: '  content with spaces  '
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.spaced).toBe('content with spaces');
            expect(mockNext).toHaveBeenCalled();
        });
    });

    /**
     * Test cases for object and array sanitization
     * @notice These tests verify recursive sanitization works correctly
     */
    describe('Recursive Sanitization', () => {
        it('should sanitize nested objects', () => {
            mockReq = {
                body: {
                    user: {
                        name: '<script>alert("xss")</script>',
                        profile: {
                            bio: '<p>Bio with <em>emphasis</em></p>'
                        }
                    }
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.user?.name).toBe('alert("xss")');
            expect(mockReq.body?.user?.profile?.bio).toBe('Bio with emphasis');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should sanitize arrays', () => {
            mockReq = {
                body: {
                    items: [
                        '<script>alert("xss")</script>',
                        'safe item',
                        '<div>html content</div>'
                    ]
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.items).toEqual([
                'alert("xss")',
                'safe item',
                'html content'
            ]);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should sanitize mixed nested structures', () => {
            mockReq = {
                body: {
                    data: {
                        strings: ['<script>xss</script>', 'safe'],
                        nested: {
                            html: '<div>content</div>',
                            array: [
                                { text: '<span>text</span>' },
                                '<b>bold</b>'
                            ]
                        }
                    }
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.data?.strings).toEqual(['xss', 'safe']);
            expect(mockReq.body?.data?.nested?.html).toBe('content');
            expect(mockReq.body?.data?.nested?.array[0].text).toBe('text');
            expect(mockReq.body?.data?.nested?.array[1]).toBe('bold');
            expect(mockNext).toHaveBeenCalled();
        });
    });

    /**
     * Test cases for query parameter sanitization
     * @notice These tests verify URL parameters are properly sanitized
     */
    describe('Query Parameter Sanitization', () => {
        it('should sanitize query parameters', () => {
            mockReq = {
                query: {
                    search: '<script>alert("xss")</script>',
                    filter: 'category&tag'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.query?.search).toBe('alert("xss")');
            expect(mockReq.query?.filter).toBe('category&amp;tag');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle empty query parameters', () => {
            mockReq = {
                query: {}
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.query).toEqual({});
            expect(mockNext).toHaveBeenCalled();
        });
    });

    /**
     * Test cases for URL parameter sanitization
     * @notice These tests verify route parameters are properly sanitized
     */
    describe('URL Parameter Sanitization', () => {
        it('should sanitize URL parameters', () => {
            mockReq = {
                params: {
                    id: '<script>alert("xss")</script>',
                    name: 'user&company'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.params?.id).toBe('alert("xss")');
            expect(mockReq.params?.name).toBe('user&amp;company');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle empty URL parameters', () => {
            mockReq = {
                params: {}
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.params).toEqual({});
            expect(mockNext).toHaveBeenCalled();
        });
    });

    /**
     * Test cases for edge cases and special values
     * @notice These tests verify robustness with unusual inputs
     */
    describe('Edge Cases', () => {
        it('should handle null and undefined values', () => {
            mockReq = {
                body: {
                    nullValue: null,
                    undefinedValue: undefined,
                    stringValue: 'safe'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.nullValue).toBeNull();
            expect(mockReq.body?.undefinedValue).toBeUndefined();
            expect(mockReq.body?.stringValue).toBe('safe');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle non-string primitive types', () => {
            mockReq = {
                body: {
                    number: 42,
                    boolean: true,
                    zero: 0,
                    falseBoolean: false
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.number).toBe(42);
            expect(mockReq.body?.boolean).toBe(true);
            expect(mockReq.body?.zero).toBe(0);
            expect(mockReq.body?.falseBoolean).toBe(false);
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle empty request body', () => {
            mockReq = {};

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle extremely long strings', () => {
            const longString = 'a'.repeat(10000) + '<script>alert("xss")</script>';
            mockReq = {
                body: {
                    long: longString
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.long).toBe('a'.repeat(10000) + 'alert("xss")');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle circular references', () => {
            const circularReq: any = {
                body: {
                    name: '<script>alert("xss")</script>'
                }
            };
            circularReq.body.self = circularReq.body;

            inputSanitizerMiddleware(circularReq as Request, mockRes as Response, mockNext);

            expect(circularReq.body.name).toBe('alert("xss")');
            expect(mockNext).toHaveBeenCalled();
        });
    });

    /**
     * Test cases for security scenarios
     * @notice These tests verify protection against various attack vectors
     */
    describe('Security Scenarios', () => {
        it('should prevent XSS attacks with multiple vectors', () => {
            mockReq = {
                body: {
                    script: '<script>alert("xss")</script>',
                    img: '<img src="x" onerror="alert(\'xss\')">',
                    svg: '<svg onload="alert(\'xss\')">',
                    iframe: '<iframe src="javascript:alert(\'xss\')"></iframe>',
                    link: '<link rel="stylesheet" href="javascript:alert(\'xss\')">'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.script).toBe('alert("xss")');
            expect(mockReq.body?.img).toBe('<img src="x" onerror="alert(\'xss\')">');
            expect(mockReq.body?.svg).toBe('<svg onload="alert(\'xss\')">');
            expect(mockReq.body?.iframe).toBe('<iframe src="alert(\'xss\')"></iframe>');
            expect(mockReq.body?.link).toBe('<link rel="stylesheet" href="alert(\'xss\')">');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle SQL injection attempts', () => {
            mockReq = {
                body: {
                    query: "'; DROP TABLE users; --",
                    param: "' OR '1'='1",
                    union: "UNION SELECT * FROM passwords"
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.query).toBe("'; DROP TABLE users; --");
            expect(mockReq.body?.param).toBe("' OR '1'='1");
            expect(mockReq.body?.union).toBe('UNION SELECT * FROM passwords');
            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle encoded XSS payloads', () => {
            mockReq = {
                body: {
                    encoded: '%3Cscript%3Ealert%28%22xss%22%29%3C%2Fscript%3E',
                    mixed: 'text<script>alert("xss")</script>more',
                    nested: '<div><span>layer1</span><script>layer2</script></div>'
                }
            };

            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);

            expect(mockReq.body?.encoded).toBe('%3Cscript%3Ealert%28%22xss%22%29%3C%2Fscript%3E');
            expect(mockReq.body?.mixed).toBe('textalert("xss")more');
            expect(mockReq.body?.nested).toBe('<div><span>layer1</span>layer2</div>');
            expect(mockNext).toHaveBeenCalled();
        });
    });

    /**
     * Performance tests
     * @notice These tests verify the middleware performs well under load
     */
    describe('Performance', () => {
        it('should handle large objects efficiently', () => {
            const largeObj: any = {
                data: {}
            };
            
            // Create a large nested object
            for (let i = 0; i < 100; i++) {
                largeObj.data[`item${i}`] = {
                    id: i,
                    content: `<div>Item ${i} with <script>alert('xss')</script> content</div>`,
                    nested: {
                        deep: `<span>Deep content ${i}</span>`
                    }
                };
            }

            mockReq = { body: largeObj };

            const startTime = Date.now();
            inputSanitizerMiddleware(mockReq as Request, mockRes as Response, mockNext);
            const endTime = Date.now();

            expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
            expect(mockNext).toHaveBeenCalled();
            
            // Verify sanitization worked
            expect(mockReq.body?.data?.item0?.content).toBe('Item 0 with alert(\'xss\') content');
        });
    });
});
