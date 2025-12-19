# 📚 Integration Guide: Confidence-Based Decision System

## نحوه استفاده در Sniper Bot

این راهنما نحوه integration سیستم جدید Confidence-Based Routing را در `sniper-bot.ts` توضیح می‌دهد.

---

## 🎯 خلاصه تغییرات مورد نیاز

### 1. Import های جدید

در ابتدای `sniper-bot.ts` اضافه کنید:

```typescript
// در بخش imports
import { getConfidenceRouter, TokenContext } from './decision/confidenceRouter';
import { getQuickRejectOptimizer } from './decision/quickReject';
import { handleTokenDetectionWithConfidenceRouter } from './decision/integrationExample';
```

### 2. تغییر در `handleLogNotification`

**قبل (خط ~518-780):**
```typescript
async function handleLogNotification(logInfo: any, source: string) {
  // ... existing code ...
  
  // بررسی security
  const security = await runEnhancedSecurityChecks(...);
  if (!security.ok) {
    logger.info(`[SKIP] Security issues`);
    return;
  }
  
  // خرید
  if (AUTO_BUY) {
    const buySig = await buyWithPumpSdk(...);
    // ...
  }
}
```

**بعد (با Confidence Router):**
```typescript
async function handleLogNotification(logInfo: any, source: string) {
  // ... existing code تا extractTransactionInfo ...
  
  const info = await extractTransactionInfo(parsedTx, connection);
  if (!info) return;
  
  const { newPoolTokenMint, solAmount, tokenAmount, poolAddress } = info;
  
  // دریافت metadata
  const tokenMetadata = await getTokenMetadata(newPoolTokenMint);
  const solPrice = await getSolPriceUSD();
  const totalLiquidityUSD = 2 * solAmount * solPrice;
  
  // ✨ NEW: استفاده از Confidence Router
  const decision = await handleTokenDetectionWithConfidenceRouter(
    connection,
    newPoolTokenMint,
    creatorAddress, // باید از transaction استخراج شود
    tokenMetadata,
    {
      liquidityUSD: totalLiquidityUSD,
      solAmount: solAmount,
      tokenAmount: tokenAmount
    }
  );
  
  // بررسی نتیجه
  if (!decision.shouldBuy) {
    logger.info(
      `[SKIP] ${tokenMetadata.symbol} - ${decision.reason} ` +
      `(confidence: ${(decision.confidence * 100).toFixed(1)}%, ` +
      `latency: ${decision.latency}ms)`
    );
    return;
  }
  
  logger.info(
    `[APPROVED] ${tokenMetadata.symbol} - ${decision.reason} ` +
    `(confidence: ${(decision.confidence * 100).toFixed(1)}%, ` +
    `latency: ${decision.latency}ms)`
  );
  
  // ادامه با خرید
  if (AUTO_BUY) {
    const mintPubkey = new PublicKey(newPoolTokenMint);
    const buySig = await buyWithPumpSdk(mintPubkey, { solAmount, tokenAmount });
    // ... rest of existing code ...
  }
}
```

---

## 📊 Performance Monitoring

برای monitoring عملکرد سیستم جدید:

```typescript
// در main() یا هر جای مناسب
setInterval(() => {
  logPerformanceStats(connection);
}, 60000); // هر 1 دقیقه
```

خروجی نمونه:
```
=== Performance Stats ===
Router:
  Total Decisions: 150
  Method Distribution:
    Quick Rules: 72.0%
    Fast Classifier: 20.0%
    DQN: 5.3%
    Conservative: 2.7%
  Avg Latency: 85.32ms

Quick Reject:
  Total Checks: 150
  Rejections: 108 (72.0%)
  Cache Hit Rate: 68.5%
  Avg Latency: 4.21ms
========================
```

---

## 🎛️ تنظیمات (Optional)

### تنظیم Confidence Thresholds

```typescript
// در ابتدای main() یا بعد از initialization
const router = getConfidenceRouter(connection);

// می‌توانید thresholds را تنظیم کنید
// (فعلاً در کد hard-coded هستند، در آینده قابل تنظیم خواهند بود)
```

### تنظیم Quick Reject Thresholds

```typescript
const quickReject = getQuickRejectOptimizer();

// تنظیم thresholds سفارشی
quickReject.setThresholds({
  minLiquidity: 2000,    // $2,000 به جای $1,000
  maxSlippage: 95,       // 95% به جای 99%
  maxTopHolderPercent: 90,
  minBuyerCount: 2
});
```

---

## 🧪 Testing

### 1. Test با یک token

```typescript
// در یک فایل تست یا console
import { handleTokenDetectionWithConfidenceRouter } from './decision/integrationExample';

const result = await handleTokenDetectionWithConfidenceRouter(
  connection,
  'TOKEN_MINT_ADDRESS',
  'CREATOR_ADDRESS',
  { name: 'Test', symbol: 'TEST', decimals: 9 },
  {
    liquidityUSD: 5000,
    solAmount: 10,
    tokenAmount: 1000000
  }
);

console.log(result);
// {
//   shouldBuy: true,
//   reason: 'Low risk - approved for trading',
//   confidence: 0.87,
//   latency: 156
// }
```

### 2. Benchmark Latency

```typescript
const iterations = 100;
const latencies: number[] = [];

for (let i = 0; i < iterations; i++) {
  const start = Date.now();
  await handleTokenDetectionWithConfidenceRouter(...);
  latencies.push(Date.now() - start);
}

const avg = latencies.reduce((a, b) => a + b) / latencies.length;
const p90 = latencies.sort()[Math.floor(iterations * 0.9)];

console.log(`Avg Latency: ${avg.toFixed(2)}ms`);
console.log(`P90 Latency: ${p90}ms`);
```

---

## 🔄 Migration Strategy

### مرحله 1: Parallel Testing (توصیه می‌شود)

ابتدا هر دو سیستم را به صورت موازی اجرا کنید:

```typescript
// اجرای هر دو سیستم
const [oldDecision, newDecision] = await Promise.all([
  runEnhancedSecurityChecks(...), // سیستم قدیمی
  handleTokenDetectionWithConfidenceRouter(...) // سیستم جدید
]);

// مقایسه نتایج
logger.info(`Old: ${oldDecision.isApproved}, New: ${newDecision.shouldBuy}`);

// فعلاً از سیستم قدیمی استفاده کنید
if (!oldDecision.isApproved) {
  return;
}

// ادامه...
```

### مرحله 2: A/B Testing

```typescript
// 50% از tokens با سیستم جدید
const useNewSystem = Math.random() < 0.5;

if (useNewSystem) {
  const decision = await handleTokenDetectionWithConfidenceRouter(...);
  if (!decision.shouldBuy) return;
} else {
  const security = await runEnhancedSecurityChecks(...);
  if (!security.ok) return;
}
```

### مرحله 3: Full Migration

بعد از اطمینان از عملکرد، کاملاً به سیستم جدید مهاجرت کنید.

---

## 📈 نتایج مورد انتظار

### Performance

| معیار | قبل | بعد | بهبود |
|-------|-----|-----|-------|
| Avg Latency | 800ms | 80-150ms | **5-10x** |
| P90 Latency | 1500ms | 250ms | **6x** |
| Quick Reject | N/A | <10ms | **New** |

### Method Distribution

```
Quick Rules:     70-80% tokens (1-10ms)
Fast Classifier: 15-20% tokens (50-200ms)
DQN:            3-5% tokens (100-300ms)
Conservative:   1-2% tokens (100ms)
```

### Accuracy

- **حفظ 95-98%** دقت فعلی
- **کاهش false positives** با confidence metrics
- **بهبود decision quality** با multi-level routing

---

## 🐛 Troubleshooting

### مشکل: Latency بالا

```typescript
// بررسی stats
const stats = router.getStats();
console.log(stats.avgLatency); // باید <200ms باشد

// اگر بالاست، بررسی کنید:
// 1. آیا cache فعال است؟
const rejectStats = quickReject.getStats();
console.log(rejectStats.cacheHitRate); // باید >60% باشد

// 2. آیا اکثر tokens از Quick Rules استفاده می‌کنند؟
console.log(stats.methodPercentages.quickRules); // باید >70% باشد
```

### مشکل: خیلی محافظه‌کارانه

```typescript
// اگر خیلی زیاد reject می‌شود:
// 1. بررسی Quick Reject thresholds
quickReject.setThresholds({
  minLiquidity: 500, // کاهش از 1000
  maxSlippage: 99    // افزایش از 95
});

// 2. بررسی confidence thresholds در router
// (فعلاً hard-coded، در آینده قابل تنظیم)
```

### مشکل: خیلی ریسک‌پذیر

```typescript
// اگر خیلی زیاد approve می‌شود:
// 1. افزایش Quick Reject thresholds
quickReject.setThresholds({
  minLiquidity: 2000,
  maxSlippage: 90,
  maxTopHolderPercent: 85
});
```

---

## 📝 Checklist Integration

- [ ] Import های جدید اضافه شد
- [ ] `handleTokenDetectionWithConfidenceRouter` فراخوانی می‌شود
- [ ] Performance monitoring راه‌اندازی شد
- [ ] Thresholds تنظیم شد (optional)
- [ ] Parallel testing انجام شد
- [ ] Latency benchmarks اجرا شد
- [ ] Production deployment

---

## 🔗 فایل‌های مرتبط

- `src/decision/confidenceRouter.ts` - Router اصلی
- `src/decision/confidenceMetrics.ts` - محاسبه confidence
- `src/decision/quickReject.ts` - Quick rejection
- `src/decision/integrationExample.ts` - مثال integration
- `src/rl/conditionalDQN.ts` - DQN شرطی

---

**تاریخ:** دسامبر 2025  
**نسخه:** 6.1.0  
**وضعیت:** آماده برای Integration
