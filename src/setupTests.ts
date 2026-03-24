/**
 * Jest Setup File
 * 
 * This file is executed before each test file and sets up the testing environment.
 * It includes global test utilities and mock configurations.
 */

// Extend Jest matchers with custom matchers if needed
// import '@testing-library/jest-dom';

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  // Uncomment to suppress console.log in tests
  // log: jest.fn(),
  // Uncomment to suppress console.warn in tests  
  // warn: jest.fn(),
  // Uncomment to suppress console.error in tests
  // error: jest.fn(),
};

// Set up global test timeout
jest.setTimeout(10000);

// Mock fetch globally for tests that don't need real network requests
global.fetch = jest.fn();

// Setup and teardown hooks
beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
});

afterEach(() => {
  // Reset any global state after each test
  jest.resetModules();
});
