const { explainError, sentence } = require('../../src/errors');
const info = (over) => Object.assign({ message: '', status: undefined, retry: 0, code: '' }, over);

describe('sentence()', () => {
	test.each([
		['limit too large', 'limit too large.'], ['Already ends.', 'Already ends.'], ['Really?', 'Really?'], ['Stop!', 'Stop!'],
		['  padded  ', 'padded.'], ['', ''], ['   ', '']
	])('%p -> %p', (a, b) => expect(sentence(a)).toBe(b));
});

describe('explainError()', () => {
	test('the reported case: HTTP 400 ace_upstream is shown, not retried, with the API\'s reason and a reference', () => {
		const ex = explainError(info({ status: 400, code: 'ace_upstream', message: 'limit must be <= 1000' }));
		expect(ex).toEqual({
			retryable: false,
			title: 'This chart can’t be shown',
			reason: 'limit must be <= 1000.',
			hint: 'Try a shorter time period or a different measurement.',
			tech: 'HTTP 400 · ace_upstream'
		});
	});

	test.each([[400], [401], [403], [404], [422]])('HTTP %i is a client error: not retryable', (status) => {
		expect(explainError(info({ status, message: 'x' })).retryable).toBe(false);
	});

	test.each([[429], [500], [502], [503], [504]])('HTTP %i is worth retrying', (status) => {
		expect(explainError(info({ status, message: 'x' })).retryable).toBe(true);
	});

	test('a network failure (no status) is worth retrying', () => {
		const ex = explainError(info({ message: 'Failed to fetch' }));
		expect(ex.retryable).toBe(true);
		expect(ex.tech).toBe('');
	});

	test('period problems suggest a shorter period; selection problems suggest another measurement', () => {
		['ace_too_many', 'ace_bad_range'].forEach((code) =>
			expect(explainError(info({ status: 400, code, message: 'x' })).hint).toBe('Try a shorter time period.'));
		['ace_bad_fields', 'ace_bad_family', 'ace_bad_asset', 'ace_bad_resolution'].forEach((code) =>
			expect(explainError(info({ status: 400, code, message: 'x' })).hint).toBe('Try a different measurement or data set.'));
		expect(explainError(info({ status: 400, code: 'something_new', message: 'x' })).hint).toBe('Try a shorter time period or a different measurement.');
	});

	test('with no message from the server there is still an explanation', () => {
		expect(explainError(info({ status: 400 })).reason).toBe('The data service rejected the request.');
	});

	test('the technical reference combines whatever is known', () => {
		expect(explainError(info({ status: 400 })).tech).toBe('HTTP 400');
		expect(explainError(info({ code: 'ace_upstream' })).tech).toBe('ace_upstream');
		expect(explainError(info({ status: 400, code: 'ace_upstream' })).tech).toBe('HTTP 400 · ace_upstream');
	});
});
