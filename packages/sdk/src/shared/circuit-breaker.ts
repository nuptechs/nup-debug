// ============================================================
// Circuit Breaker — Fail-fast pattern for unreliable downstream calls
// ============================================================

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening. Default: 5 */
  failureThreshold: number;
  /** Milliseconds to stay open before transitioning to half-open. Default: 30000 */
  resetTimeoutMs: number;
  /** Attempts allowed in half-open state. Default: 1 */
  halfOpenMaxAttempts: number;
}

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

export class CircuitOpenError extends Error {
  constructor(message = 'Circuit breaker is open') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 1,
};

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures: number = 0;
  private successes: number = 0;
  private totalFailures: number = 0;
  private lastFailureTime?: number;
  private halfOpenAttempts: number = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Wrap an async operation with circuit breaker protection. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldTransitionToHalfOpen()) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenAttempts = 0;
      } else {
        throw new CircuitOpenError();
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        throw new CircuitOpenError('Circuit breaker is half-open and max attempts reached');
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    // Check for automatic transition when querying state
    if (this.state === CircuitState.OPEN && this.shouldTransitionToHalfOpen()) {
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenAttempts = 0;
    }
    return this.state;
  }

  getStats(): {
    failures: number;
    successes: number;
    state: CircuitState;
    lastFailure?: number;
  } {
    return {
      failures: this.totalFailures,
      successes: this.successes,
      state: this.getState(),
      lastFailure: this.lastFailureTime,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = undefined;
  }

  private onSuccess(): void {
    this.successes++;

    if (this.state === CircuitState.HALF_OPEN) {
      // Recovery confirmed — close the circuit
      this.state = CircuitState.CLOSED;
      this.consecutiveFailures = 0;
      this.halfOpenAttempts = 0;
    } else {
      // Reset consecutive failures on any success in closed state
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during probe — reopen
      this.state = CircuitState.OPEN;
      this.halfOpenAttempts = 0;
    } else if (
      this.state === CircuitState.CLOSED &&
      this.consecutiveFailures >= this.config.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
    }
  }

  private shouldTransitionToHalfOpen(): boolean {
    if (!this.lastFailureTime) return false;
    return Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs;
  }
}
