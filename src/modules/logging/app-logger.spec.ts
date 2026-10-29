import { AppLogger } from './app-logger';
import { runWithRequestId } from './request-context';

describe('AppLogger', () => {
  it('друкує requestId з AsyncLocalStorage на кожному рядку', () => {
    const chunks: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    });
    const logger = new AppLogger('Test');
    runWithRequestId('req-123', () => logger.warn('hello'));
    logger.warn('outside');
    spy.mockRestore();

    const first = JSON.parse(chunks[0]);
    const second = JSON.parse(chunks[1]);
    expect(first.requestId).toBe('req-123');
    expect(first.msg).toBe('hello');
    expect(second.requestId).toBeNull();
  });
});
