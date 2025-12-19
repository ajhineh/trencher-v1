.# 🧪 Testing Guide: فاز 1 بهینه‌سازی

## فایل‌های Test ایجاد شده

### 1. `test/decision/confidenceMetrics.test.ts`
- **20+ test cases**
- تست محاسبه confidence
- تست helper functions (isHighConfidence, isMediumConfidence, isLowConfidence)
- تست edge cases
- تست با risk scores مختلف

### 2. `test/decision/quickReject.test.ts`
- **15+ test cases**
- تست rejection logic
- تست cache mechanism
- تست stats tracking
- تست custom thresholds
- تست performance (<10ms)

### 3. `test/rl/conditionalDQN.test.ts`
- **25+ test cases**
- تست bypass logic
- تست quick decision
- تست usage stats
- تست confidence threshold
- تست performance

---

## اجرای Tests

### روش 1: اجرای تمام tests

```bash
npm test
```

### روش 2: اجرای tests خاص

```bash
# فقط confidence metrics
npm test -- confidenceMetrics.test.ts

# فقط quick reject
npm test -- quickReject.test.ts

# فقط conditional DQN
npm test -- conditionalDQN.test.ts
```

### روش 3: اجرای با coverage

```bash
npm test -- --coverage
```

---

## نتایج مورد انتظار

### Coverage Target

| فایل | Target Coverage |
|------|----------------|
| confidenceMetrics.ts | >90% |
| confidenceRouter.ts | >80% |
| quickReject.ts | >85% |
| conditionalDQN.ts | >85% |

### Performance Benchmarks

| Test | Target |
|------|--------|
| QuickReject latency | <10ms |
| ConditionalDQN bypass | <10ms |
| ConditionalDQN bypass rate | 60-70% |

---

## مثال خروجی

```
PASS  test/decision/confidenceMetrics.test.ts
  ConfidenceMetrics
    calculateConfidence
      ✓ should calculate high confidence for low risk (5ms)
      ✓ should calculate lower confidence for medium risk (3ms)
      ✓ should calculate high confidence for critical risk (2ms)
      ✓ should penalize confidence for many warnings (4ms)
      ✓ should handle inconsistent risk factors (3ms)
      ✓ should return valid confidence range (0-1) (8ms)
    isHighConfidence
      ✓ should return true for confidence >= 0.85 (1ms)
      ✓ should return true for confidence > 0.85 (1ms)
      ✓ should return false for confidence < 0.85 (1ms)
    ...

PASS  test/decision/quickReject.test.ts
  QuickRejectOptimizer
    quickReject
      ✓ should reject token with low liquidity (3ms)
      ✓ should reject token with high slippage (2ms)
      ✓ should pass token with good metrics (4ms)
      ✓ should be fast (<10ms for most cases) (45ms)
    Cache
      ✓ should use cache for repeated checks (8ms)
      ✓ should clear cache when requested (2ms)
    ...

PASS  test/rl/conditionalDQN.test.ts
  ConditionalDQNAgent
    selectActionConditional
      ✓ should bypass DQN for high confidence (8ms)
      ✓ should use DQN for low confidence (125ms)
      ✓ should use DQN when confidence equals threshold (118ms)
    Usage Stats
      ✓ should track total calls (245ms)
      ✓ should calculate bypass rate correctly (320ms)
    Performance
      ✓ should have fast bypass latency (<10ms) (52ms)
      ✓ should achieve target bypass rate (60-70%) (1.2s)
    ...

Test Suites: 3 passed, 3 total
Tests:       60 passed, 60 total
Snapshots:   0 total
Time:        3.456s
```

---

## Troubleshooting

### مشکل: Tests fail به دلیل missing dependencies

```bash
npm install --save-dev @types/jest jest ts-jest
```

### مشکل: TypeScript errors

```bash
# مطمئن شوید tsconfig.json صحیح است
npm run build
```

### مشکل: Tests timeout

```typescript
// در test file، افزایش timeout:
jest.setTimeout(10000); // 10 seconds
```

---

## Integration Tests (مرحله بعدی)

برای integration tests، نیاز به:

1. **Mock Connection**: برای تست بدون نیاز به RPC واقعی
2. **Mock Data**: داده‌های نمونه برای tokens
3. **End-to-End Flow**: تست کامل از detection تا decision

مثال:

```typescript
// test/integration/confidenceRouter.integration.test.ts

describe('Confidence Router Integration', () => {
  it('should handle complete token detection flow', async () => {
    const mockConnection = createMockConnection();
    const router = new ConfidenceRouter(mockConnection);
    
    const decision = await router.route(
      'MOCK_TOKEN_MINT',
      mockTokenContext
    );
    
    expect(decision.action).toBeDefined();
    expect(decision.latency).toBeLessThan(200);
  });
});
```

---

## Performance Benchmarks (مرحله بعدی)

```typescript
// test/benchmarks/latency.benchmark.ts

describe('Latency Benchmarks', () => {
  it('should measure average latency', async () => {
    const iterations = 1000;
    const latencies: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await router.route(tokenMint, context);
      latencies.push(Date.now() - start);
    }
    
    const avg = latencies.reduce((a, b) => a + b) / iterations;
    const p90 = latencies.sort()[Math.floor(iterations * 0.9)];
    const p99 = latencies.sort()[Math.floor(iterations * 0.99)];
    
    console.log(`Avg: ${avg.toFixed(2)}ms`);
    console.log(`P90: ${p90}ms`);
    console.log(`P99: ${p99}ms`);
    
    expect(avg).toBeLessThan(200);
    expect(p90).toBeLessThan(300);
  });
});
```

---

**تاریخ:** دسامبر 2025  
**نسخه:** 6.1.0  
**وضعیت:** Unit Tests Complete, Integration Tests Pending
