
import express from 'express';
import { latencyTracker } from '../performance/latencyTracker';
import { logger } from '../logger';
import { getCrossDEXArbitrage } from '../arbitrage/crossDexArbitrage';
// We would ideally inject dependencies or use a stats service, but simplified access for now 
// Assuming some global state or we just report latency for now.

import { IntelligentTradingSystem } from '../futures/intelligentTradingSystem';

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(express.static('public'));
app.use(express.json()); // Enable JSON body parsing

let tradingSystem: IntelligentTradingSystem | undefined;

app.get('/api/health', (req: any, res: any) => {
  res.json({ status: 'OK', uptime: process.uptime() });
});

app.get('/api/performance', (req: any, res: any) => {
  const stats = latencyTracker.getAllStats();
  res.json({
    timestamp: Date.now(),
    metrics: stats
  });
});

// === SCANNER ENDPOINTS ===

app.post('/api/scanner/toggle', (req: any, res: any) => {
  if (!tradingSystem) return res.status(503).json({ error: 'Trading System not available' });

  const { enabled } = req.body;
  if (enabled) {
    tradingSystem.startAutonmousMode();
    res.json({ status: 'started' });
  } else {
    tradingSystem.stopAutonomousMode();
    res.json({ status: 'stopped' });
  }
});

app.get('/api/scanner/status', (req: any, res: any) => {
  // Ideally we expose isScanning from tradingSystem
  res.json({ status: 'ok', msg: 'Check logs for status' });
});

// Start function
export function startDashboard(system?: IntelligentTradingSystem) {
  tradingSystem = system;
  try {
    app.listen(PORT, () => {
      logger.info(`[Dashboard] Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error(`[Dashboard] Failed to start: ${error}`);
  }
}

// If run directly
if (require.main === module) {
  startDashboard();
}
