// ============================================================
// Container — Factory for the correlation engine
// ============================================================

import type { CorrelationConfig } from '@nuptechs-probe/core';
import { CorrelatorPort, DEFAULT_CORRELATION_CONFIG } from '@nuptechs-probe/core';
import { EventCorrelator } from './correlator.js';

export function createCorrelator(config?: Partial<CorrelationConfig>): CorrelatorPort {
  const merged: CorrelationConfig = { ...DEFAULT_CORRELATION_CONFIG, ...config };
  const correlator = new EventCorrelator();
  correlator.initialize(merged);
  return correlator;
}
