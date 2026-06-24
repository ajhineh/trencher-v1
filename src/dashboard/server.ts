import express from 'express';
import { logger } from '../logger';
import path from 'path';

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

// Data Storage for Dashboard
export const dashboardData = {
  logs: [] as any[],
  latestSecurity: null as any,
  trades: [] as any[],
  stats: {
    winRate: 0,
    totalTrades: 0,
    avgCapital: 0,
    totalPnL: 0,
    takeProfitCount: 0
  },
  settings: {
    toggles: { pumpfun: true, pumpswap: true, meteora: true },
    security: { L: true, o: true, m: true, V: true, i: true, n: true, C: true, d: true, f: true, s: true },
    minLiq: Number(process.env.MIN_LIQUIDITY_SOL ?? 2000),
    bypassSecurity: false,
    portfolioTotalCapitalUsdt: Number(process.env.PORTFOLIO_TOTAL_CAPITAL_USDT || 1000),
    portfolioTokenAllocationUsdt: Number(process.env.PORTFOLIO_TOKEN_ALLOCATION_USDT || 200),
    amiroTradeSizeUsdt: Number(process.env.AMIRO_TRADE_SIZE_USDT || 50),
    amiroTp1Pct: Number(process.env.AMIRO_TP1_PCT || 50),
    amiroTp2Pct: Number(process.env.AMIRO_TP2_PCT || 25),
    amiroTp3Pct: Number(process.env.AMIRO_TP3_PCT || 25),
    targetSymbols: (process.env.TARGET_SYMBOLS || '1000BONK/USDT:USDT,WIF/USDT:USDT,POPCAT/USDT:USDT,BOME/USDT:USDT')
        .split(',')
        .map(s => s.trim())
  },
  candles: {} as Record<string, any[]>,
  signals: [] as any[],
  tradeMemory: [] as any[]
};

import fs from 'fs';

const HISTORY_FILE = path.join(__dirname, '../../dashboard_history.json');

export function getTradeMemory(): any[] {
  try {
    const memoryFile = path.resolve(process.cwd(), 'trade_memory.json');
    if (fs.existsSync(memoryFile)) {
      return JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    }
  } catch (e: any) {
    logger.error(`[Dashboard] Failed to read trade_memory.json: ${e.message}`);
  }
  return [];
}

function recalculateStats() {
  try {
    const TRADE_SIZE_USDT = Number(process.env.AMIRO_TRADE_SIZE_USDT || 50);
    const TP1_PCT = Number(process.env.AMIRO_TP1_PCT || 50) / 100;
    const TP2_PCT = Number(process.env.AMIRO_TP2_PCT || 25) / 100;
    const TP3_PCT = Number(process.env.AMIRO_TP3_PCT || 25) / 100;
    const tpPctMap: Record<string, number> = { TP1: TP1_PCT, TP2: TP2_PCT, TP3: TP3_PCT };

    const signals = [...dashboardData.signals].sort((a, b) => a.time - b.time);
    const queues: Record<string, any[]> = {};
    const cycles: any[] = [];

    signals.forEach((sig) => {
      const sym = sig.symbol;
      if (sig.type === "BUY" || sig.type === "SELL") {
        if (!queues[sym]) queues[sym] = [];
        queues[sym].push({ ...sig, exits: [] });
      } else if (sig.type.includes("EXIT")) {
        const q = queues[sym] || [];
        if (!q.length) return;
        q[0].exits.push(sig);
        if (sig.fullyExited === true) {
          cycles.push(q.shift());
        }
      }
    });

    let totalPnL = 0;
    let wins = 0;

    cycles.forEach((cycle) => {
      const side = cycle.type === "BUY" ? "long" : "short";
      const lev = cycle.leverage || 1;
      const entry = cycle.price;

      let remainingPct = 1.0;
      let cyclePnL = 0;

      cycle.exits.forEach((exit: any) => {
        const reason = exit.exitReason || "";
        let fraction: number;
        if (exit.fraction != null) {
          fraction = exit.fraction;
        } else if (exit.fullyExited === true) {
          fraction = remainingPct;
        } else if (tpPctMap[reason] != null) {
          fraction = Math.min(tpPctMap[reason], remainingPct);
        } else {
          fraction = remainingPct;
        }

        remainingPct -= fraction;
        if (remainingPct < 0) remainingPct = 0;

        const sizeUSDT = TRADE_SIZE_USDT * fraction;
        const pnlPct = side === "long"
          ? ((exit.price - entry) / entry) * 100 * lev
          : ((entry - exit.price) / entry) * 100 * lev;
        const pnlUSDT = sizeUSDT * (pnlPct / 100);

        cyclePnL += pnlUSDT;
      });

      totalPnL += cyclePnL;
      if (cyclePnL > 0) wins++;
    });

    const totalTrades = cycles.length;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;

    dashboardData.stats = {
      winRate,
      totalTrades,
      avgCapital: TRADE_SIZE_USDT,
      totalPnL,
      takeProfitCount: wins
    };
  } catch (e: any) {
    logger.error(`[Dashboard] recalculateStats error: ${e.message}`);
  }
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (data.signals) dashboardData.signals = data.signals;
      if (data.logs) dashboardData.logs = data.logs;
      
      // Always dynamically recalculate stats from loaded signals
      recalculateStats();
      
      logger.info(`[Dashboard] Successfully loaded history from ${HISTORY_FILE}`);
    }
  } catch (e: any) {
    logger.warn(`[Dashboard] Failed to load history: ${e.message}`);
  }
}

function saveHistory() {
  try {
    const dataToSave = {
      signals: dashboardData.signals,
      logs: dashboardData.logs,
      stats: dashboardData.stats
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
  } catch (e: any) {
    logger.error(`[Dashboard] Failed to save history: ${e.message}`);
  }
}

// Load history on startup
loadHistory();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../dashboard-ui/dist')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../dashboard-ui/dist/index.html'));
});

// Full state endpoint for the frontend
app.get('/api/state', (req, res) => {
  res.json({
    health: {
      status: 'OK',
      uptime: process.uptime(),
      version: '7.2.1-ELITE'
    },
    performance: {},
    logs: dashboardData.logs,
    security: dashboardData.latestSecurity,
    trades: dashboardData.trades,
    stats: dashboardData.stats,
    settings: dashboardData.settings,
    candles: dashboardData.candles,
    signals: dashboardData.signals,
    tradeMemory: getTradeMemory()
  });
});

// Endpoint to retrieve detailed trade calculations and candlestick snapshots for signal diagnostics
app.get('/api/debug-data/:tradeId', (req, res) => {
  try {
    const { tradeId } = req.params;
    // Sanitizing tradeId to prevent path traversal
    const safeTradeId = tradeId.replace(/[^a-zA-Z0-9-]/g, '');
    const filePath = path.resolve(__dirname, '../../signal_debug_data', `${safeTradeId}.json`);
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'Detailed signal calculations snapshot not found for this trade' });
    }
  } catch (e: any) {
    logger.error(`[Dashboard] Failed to read signal debug data: ${e.message}`);
    res.status(500).json({ error: 'Internal server error reading signal debug data' });
  }
});

// Settings Update Endpoint
app.post('/api/settings', (req, res) => {
  try {
    const newSettings = req.body;
    dashboardData.settings = { ...dashboardData.settings, ...newSettings };
    logger.info(`[SETTINGS] Configuration updated from dashboard: MinLiq ${dashboardData.settings.minLiq} SOL`);
    res.json({ status: 'OK' });
  } catch (e) {
    res.status(500).json({ status: 'ERROR', message: (e as Error).message });
  }
});

// Emergency Exit Signal
app.post('/api/internal/exit-all', (req, res) => {
  logger.warn('⚠️ [EMERGENCY] Global Exit Signal Received! Closing all active trades.');
  // The bot core (trencher) will check this signal or we could emit an event.
  // For now, we clear the dashboard trades view.
  dashboardData.trades = [];
  res.json({ status: 'OK' });
});

// Terminate Bot Signal
app.post('/api/terminate', (req, res) => {
  logger.warn('🛑 [TERMINATE] Kill Signal Received from Dashboard! Shutting down...', () => {
    // Ensure log is written before exit attempt
    console.log('API Terminate called - Force exiting...');
  });
  res.json({ status: 'OK' });

  // Force exit with extreme prejudice
  setTimeout(() => {
    logger.error('FORCE EXITING NOW via process.exit(1)');
    process.exit(1);
    // If process.exit(1) fails (it shouldn't), try SIGKILL
    process.kill(process.pid, 'SIGKILL');
  }, 1000);
});

// Update Endpoints (Called by the bot logic)
app.post('/api/internal/log', (req, res) => {
  dashboardData.logs.unshift(req.body);
  if (dashboardData.logs.length > 50) dashboardData.logs.pop();
  saveHistory();
  res.sendStatus(200);
});

app.post('/api/internal/security', (req, res) => {
  dashboardData.latestSecurity = req.body;
  res.sendStatus(200);
});

app.post('/api/internal/stats', (req, res) => {
  dashboardData.stats = { ...dashboardData.stats, ...req.body };
  saveHistory();
  res.sendStatus(200);
});

app.post('/api/internal/candle', (req, res) => {
  const { symbol, candle } = req.body;
  if (!dashboardData.candles[symbol]) {
    dashboardData.candles[symbol] = [];
  }
  
  // Update or push candle
  const candles = dashboardData.candles[symbol];
  if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
    candles[candles.length - 1] = candle;
  } else {
    candles.push(candle);
  }

  if (candles.length > 1000) candles.shift();

  broadcast({ type: 'CANDLE', data: { symbol, candle } });
  res.sendStatus(200);
});

app.post('/api/internal/signal', (req, res) => {
  const signal = req.body;
  dashboardData.signals.push(signal);
  if (dashboardData.signals.length > 100) dashboardData.signals.shift();

  recalculateStats();
  
  const tradeMemory = getTradeMemory();
  broadcast({ type: 'SIGNAL', data: signal });
  broadcast({ type: 'TRADE_MEMORY', data: tradeMemory });
  
  saveHistory();
  res.sendStatus(200);
});

import { dashboardEmitter } from './dashboardBridge';
import http from 'http';
import { WebSocketServer } from 'ws';

// Create HTTP Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast helper
const broadcast = (data: any) => {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
};

// WebSocket Connection Logic
wss.on('connection', (ws) => {
  // Send initial state on connection
  ws.send(JSON.stringify({
    type: 'INIT',
    data: {
      health: { status: 'OK', uptime: process.uptime() },
      logs: dashboardData.logs,
      stats: dashboardData.stats,
      settings: dashboardData.settings,
      candles: dashboardData.candles,
      signals: dashboardData.signals,
      tradeMemory: getTradeMemory()
    }
  }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', uptime: process.uptime() }));
      }
    } catch (e) {
      // ignore
    }
  });
});

// Listen to internal events and broadcast
dashboardEmitter.on('newLog', (logEntry) => {
  broadcast({ type: 'LOG', data: logEntry });
});

export function startDashboard() {
  try {
    server.listen(PORT, () => {
      logger.info(`[Dashboard] Advanced UI + WebSocket running at http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error(`[Dashboard] Failed to start: ${error}`);
  }
}

if (require.main === module) {
  startDashboard();
}
