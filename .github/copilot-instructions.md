# Test Debugging Guidelines

When encountering test failures, please follow these guidelines:

## Investigation Process
1. **Understand the code logic first** - Thoroughly analyze the production code to understand its intended behavior
2. **Examine the failing test** - Review the test case to understand what it's trying to validate
3. **Identify the root cause** - Determine whether the issue is in the test logic or the production code

## Fix Priority
- **Test issues are more likely** - In most cases, test failures are due to incorrect test logic rather than production code bugs
- **Avoid production patches for tests** - Do not modify production code to accommodate specific test scenarios
- **Keep test code contained** - All test-related code, mocks, and utilities must remain within the test files

## Best Practices
- Fix tests by correcting their logic, assertions, or setup
- Ensure tests accurately reflect the expected behavior of the production code
- Maintain test isolation and avoid side effects
- Use proper mocking and stubbing when needed