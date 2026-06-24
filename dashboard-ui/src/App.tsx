import { useEffect, useRef, useState, useMemo, Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: any) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    flex: 1,
                    background: 'rgba(15, 23, 42, 0.3)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '16px',
                    padding: '2rem',
                    textAlign: 'center',
                    color: '#F87171',
                    direction: 'rtl',
                    fontFamily: 'sans-serif',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '15px'
                }}>
                    <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#EF4444', fontWeight: 800 }}>
                        خطا در نمایش اطلاعات فنی و محاسباتی سیگنال
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: '#F87171', opacity: 0.85, margin: 0, maxWidth: '420px', lineHeight: '1.4' }}>
                        ساختار داده‌های دریافتی از سرور با نسخه فرانت‌اند همخوانی ندارد یا داده‌ای نامعتبر در فایل عیب‌یابی یافت شده است.
                    </p>
                    <div style={{
                        background: 'rgba(0, 0, 0, 0.4)',
                        padding: '0.8rem',
                        borderRadius: '8px',
                        fontSize: '0.74rem',
                        fontFamily: 'monospace',
                        textAlign: 'left',
                        whiteSpace: 'pre-wrap',
                        overflowX: 'auto',
                        color: '#EF4444',
                        maxWidth: '90%',
                        boxSizing: 'border-box'
                    }}>
                        {this.state.error?.toString()}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

interface Signal {
    symbol: string;
    type: 'BUY' | 'SELL' | 'BUY_EXIT' | 'SELL_EXIT';
    price: number;
    leverage?: number; // Dynamic leverage from signal
    time: number;
    exitReason?: string;
    fullyExited?: boolean;
    tp?: number;
    sl?: number;
}

interface TradeLog {
    time: string;
    token: string;
    status: string;
    reason: string;
}

interface ActiveTrade {
    side: 'long' | 'short';
    entryPrice: number;
    amount: number;
    leverage: number;
    timestamp: number;
    remainingPct: number;
    accumulatedPnL: number;
}

interface TokenStats {
    winRate: number;
    totalTrades: number;
    profits: number;
    losses: number;
    pnl: number;
    pnlPercent: number;
    completedWins: number;
}

interface TokenState {
    symbol: string;
    allocatedBalance: number;
    initialAllocation: number;
    activeTrade: ActiveTrade | null;
    logs: any[];
    stats: TokenStats;
}

interface TradeContext {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    leverage: number;
    riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM';
    confidence: number;
    channelWidth: number;
    channelWidthPct: number;
    macroTrend: string;
    structuralTrend: string;
    tradingTrend: string;
    atr: number;
    atrPct: number;
    slPrice: number;
    slDistancePct: number;
    tp1Price: number;
    tp1DistancePct: number;
}

interface TradeExit {
    reason: string;
    price: number;
    pnlPct: number;
    pnlUsdt: number;
    timestamp: number;
    fullyExited: boolean;
}

type TradeOutcome = 'WIN' | 'LOSS' | 'PARTIAL_WIN' | 'BREAKEVEN';

interface TradeMemoryEntry {
    id: string;
    timestamp: number;
    context: TradeContext;
    exits: TradeExit[];
    finalPnlPct: number;
    finalPnlUsdt: number;
    outcome: TradeOutcome;
    closed: boolean;
    durationSeconds: number;
}

interface SignalDiagnosticsViewProps {
    snapshot: any;
    tradeMemory: TradeMemoryEntry[];
    reviewerTimeframe: '1m' | '3m' | '15m';
    setReviewerTimeframe: (tf: '1m' | '3m' | '15m') => void;
}

// Ultra safe toFixed utility helper
function safeToFixed(val: any, decimals: number = 6): string {
    if (val === null || val === undefined) {
        return '0.' + '0'.repeat(decimals);
    }
    const num = Number(val);
    if (isNaN(num)) {
        return '0.' + '0'.repeat(decimals);
    }
    return num.toFixed(decimals);
}

function SignalDiagnosticsView({
    snapshot,
    tradeMemory,
    reviewerTimeframe,
    setReviewerTimeframe
}: SignalDiagnosticsViewProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [trendlines, setTrendlines] = useState<{ x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
    const [drawingMode, setDrawingMode] = useState<boolean>(false);
    const [activeLine, setActiveLine] = useState<{ x1: number; y1: number; x2: number; y2: number; color: string } | null>(null);
    const [selectedColor, setSelectedColor] = useState<string>('#00ffcc');

    useEffect(() => {
        setTrendlines([]);
        setActiveLine(null);
        setDrawingMode(false);
    }, [snapshot?.tradeId]);

    const getSvgCoords = (e: any) => {
        if (!svgRef.current) return null;
        const rect = svgRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 940;
        const y = ((e.clientY - rect.top) / rect.height) * 280;
        return { x, y };
    };

    const handleMouseDown = (e: any) => {
        if (!drawingMode) return;
        const coords = getSvgCoords(e);
        if (coords) {
            setActiveLine({
                x1: coords.x,
                y1: coords.y,
                x2: coords.x,
                y2: coords.y,
                color: selectedColor
            });
        }
    };

    const handleMouseMove = (e: any) => {
        if (!activeLine) return;
        const coords = getSvgCoords(e);
        if (coords) {
            setActiveLine({
                ...activeLine,
                x2: coords.x,
                y2: coords.y
            });
        }
    };

    const handleMouseUp = () => {
        if (activeLine) {
            const dist = Math.hypot(activeLine.x2 - activeLine.x1, activeLine.y2 - activeLine.y1);
            if (dist > 5) {
                setTrendlines(prev => [...prev, activeLine]);
            }
            setActiveLine(null);
        }
    };

    const handleMouseLeave = () => {
        setActiveLine(null);
    };

    try {
        const activeTradeInfo = tradeMemory?.find(t => t.id === snapshot?.tradeId);
        const sideLabel = snapshot?.side === 'long' ? 'LONG' : 'SHORT';
        const sideColor = snapshot?.side === 'long' ? '#10B981' : '#EF4444';
        
        // Bulgaria local time formatting for EEST
        let bulgariaTimeStr = '';
        try {
            bulgariaTimeStr = new Date(activeTradeInfo?.timestamp ? activeTradeInfo.timestamp * 1000 : Date.now()).toLocaleString('en-US', {
                timeZone: 'Europe/Sofia',
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            bulgariaTimeStr = new Date(activeTradeInfo?.timestamp ? activeTradeInfo.timestamp * 1000 : Date.now()).toLocaleString([], {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }

        // Compute EEST Hour & Minute to see if NY Opening Session Protection was active
        let isNYSession = false;
        if (activeTradeInfo?.timestamp) {
            try {
                const timeParts = new Date(activeTradeInfo.timestamp * 1000).toLocaleString('en-US', {
                    timeZone: 'Europe/Sofia',
                    hour12: false,
                    hour: 'numeric',
                    minute: 'numeric'
                }).split(':');
                if (timeParts.length >= 2) {
                    const SofiaHour = parseInt(timeParts[0], 10);
                    const SofiaMinute = parseInt(timeParts[1], 10);
                    if (!isNaN(SofiaHour) && !isNaN(SofiaMinute)) {
                        const totalSofiaMinutes = SofiaHour * 60 + SofiaMinute;
                        isNYSession = totalSofiaMinutes >= (16 * 60 + 20) && totalSofiaMinutes <= (17 * 60 + 40);
                    }
                }
            } catch (e) {
                // ignore
            }
        }

        // Render Chart variables
        const candles = snapshot?.candles?.[reviewerTimeframe] || [];
        const hasCandles = Array.isArray(candles) && candles.length > 0;
        
        let chartSVG = null;
        
        const targetsList = snapshot?.exitTargets?.targets || [];
        const slPrice = Number(snapshot?.exitTargets?.sl || (snapshot?.entryPrice ? snapshot.entryPrice * 0.95 : 0));
        const entryPrice = Number(snapshot?.entryPrice || 0);
        
        if (hasCandles) {
            const highPrices = candles.map((c: any) => Number(c?.high || 0));
            const lowPrices = candles.map((c: any) => Number(c?.low || 0));
            
            // Include entry price, stop loss, and exit targets inside scaling boundary to make sure overlays are never cut off
            const tpPrices = targetsList.map((t: any) => Number(t?.price || 0));
            
            let maxPrice = Math.max(...highPrices, entryPrice, slPrice, ...tpPrices);
            let minPrice = Math.min(...lowPrices, entryPrice, slPrice, ...tpPrices);
            
            // Extreme safety checks for NaN
            if (isNaN(maxPrice) || !isFinite(maxPrice)) maxPrice = entryPrice || 1;
            if (isNaN(minPrice) || !isFinite(minPrice)) minPrice = entryPrice || 0;
            
            let priceRange = maxPrice - minPrice;
            if (priceRange <= 0 || isNaN(priceRange)) priceRange = 1;
            
            // Add 6% padding top and bottom
            const paddedMin = minPrice - priceRange * 0.06;
            const paddedMax = maxPrice + priceRange * 0.06;
            let paddedRange = paddedMax - paddedMin;
            if (paddedRange <= 0 || isNaN(paddedRange)) paddedRange = 1;
            
            const width = 940;
            const height = 280;
            const padLeft = 70;
            const padRight = 140; // larger right padding for TP/SL labels
            const padTop = 20;
            const padBottom = 20;
            
            const chartWidth = width - padLeft - padRight;
            const chartHeight = height - padTop - padBottom;
            
            const getY = (price: number) => {
                const p = Number(price);
                if (isNaN(p) || isNaN(paddedMin) || isNaN(paddedRange) || paddedRange === 0) return padTop + chartHeight / 2;
                const computedY = padTop + chartHeight - ((p - paddedMin) / paddedRange) * chartHeight;
                if (isNaN(computedY) || !isFinite(computedY)) return padTop + chartHeight / 2;
                return computedY;
            };
            
            const getX = (index: number) => {
                const totalCandles = candles.length;
                if (totalCandles <= 1) return padLeft;
                const computedX = padLeft + (index / (totalCandles - 1)) * chartWidth;
                if (isNaN(computedX) || !isFinite(computedX)) return padLeft;
                return computedX;
            };
            
            // Render 4 price grid lines
            const gridPrices = [];
            for (let i = 0; i <= 4; i++) {
                gridPrices.push(paddedMin + (paddedRange * i) / 4);
            }
            
            // Render Candle elements
            const candleWidth = Math.max(3, (chartWidth / candles.length) * 0.7);
            
            // Entry Marker Arrow coords - Search for exact match or closest to activeTradeInfo.timestamp
            let entryIdx = candles.length - 1; // Fallback to last candle if not found
            if (activeTradeInfo?.timestamp && candles.length > 0) {
                const targetTime = activeTradeInfo.timestamp;
                let minDiff = Infinity;
                let bestIdx = 0;
                for (let i = 0; i < candles.length; i++) {
                    const diff = Math.abs(candles[i].time - targetTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestIdx = i;
                    }
                }
                const intervalSec = reviewerTimeframe === '1m' ? 60 : reviewerTimeframe === '3m' ? 180 : 900;
                if (minDiff <= intervalSec * 1.5) {
                    entryIdx = bestIdx;
                }
            }
            const entryX = getX(entryIdx);
            
            const getExitIdx = (exitTimestampSec: number) => {
                let minDiff = Infinity;
                let bestIdx = 0;
                for (let i = 0; i < candles.length; i++) {
                    const diff = Math.abs(candles[i].time - exitTimestampSec);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestIdx = i;
                    }
                }
                return bestIdx;
            };

            chartSVG = (
                <svg 
                    ref={svgRef}
                    width="100%" 
                    height="100%" 
                    viewBox={`0 0 ${width} ${height}`} 
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    style={{ 
                        position: 'absolute', 
                        top: 0, 
                        left: 0, 
                        width: '100%', 
                        height: '100%', 
                        background: '#090d16', 
                        borderRadius: '12px',
                        cursor: drawingMode ? 'crosshair' : 'default'
                    }}
                >
                    {/* Horizontal price grid lines */}
                    {gridPrices.map((price, idx) => {
                        const y = getY(price);
                        return (
                            <g key={idx}>
                                <line x1={padLeft} y1={y} x2={padLeft + chartWidth} y2={y} stroke="rgba(255, 255, 255, 0.03)" strokeWidth={1} />
                                <text x={10} y={y + 3} fill="#475569" fontSize="9" fontFamily="monospace">{safeToFixed(price, 6)}</text>
                            </g>
                        );
                    })}
                    
                    {/* Vertical candle wicks and bodies */}
                    {candles.map((c: any, i: number) => {
                        const x = getX(i);
                        const yHigh = getY(c?.high);
                        const yLow = getY(c?.low);
                        const yOpen = getY(c?.open);
                        const yClose = getY(c?.close);
                        const bodyTop = Math.min(yOpen, yClose);
                        const bodyBottom = Math.max(yOpen, yClose);
                        const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);
                        const isBull = Number(c?.close || 0) >= Number(c?.open || 0);
                        const candleColor = isBull ? '#10B981' : '#EF4444';
                        
                        return (
                            <g key={i}>
                                {/* Wick line */}
                                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={candleColor} strokeWidth={1.2} />
                                {/* Body rect */}
                                <rect
                                    x={x - candleWidth / 2}
                                    y={bodyTop}
                                    width={candleWidth}
                                    height={bodyHeight}
                                    fill={candleColor}
                                    opacity={0.8}
                                    rx={0.5}
                                />
                            </g>
                        );
                    })}
                    
                    {/* Channel Reference Overlays at time of signal */}
                    {snapshot?.channel && (
                        <g>
                            {/* Upper Edge */}
                            {snapshot.channel.upperLine?.point2?.price !== undefined && (() => {
                                const chY = getY(snapshot.channel.upperLine.point2.price);
                                return (
                                    <g>
                                        <line x1={padLeft} y1={chY} x2={padLeft + chartWidth} y2={chY} stroke="rgba(167, 139, 250, 0.2)" strokeWidth={1.5} />
                                        <text x={padLeft + chartWidth + 5} y={chY + 3} fill="rgba(167, 139, 250, 0.4)" fontSize="8" fontFamily="monospace">CH UPPER: {safeToFixed(snapshot.channel.upperLine.point2.price, 6)}</text>
                                    </g>
                                );
                            })()}
                            {/* Lower Edge */}
                            {snapshot.channel.lowerLine?.point2?.price !== undefined && (() => {
                                const chY = getY(snapshot.channel.lowerLine.point2.price);
                                return (
                                    <g>
                                        <line x1={padLeft} y1={chY} x2={padLeft + chartWidth} y2={chY} stroke="rgba(167, 139, 250, 0.2)" strokeWidth={1.5} />
                                        <text x={padLeft + chartWidth + 5} y={chY + 3} fill="rgba(167, 139, 250, 0.4)" fontSize="8" fontFamily="monospace">CH LOWER: {safeToFixed(snapshot.channel.lowerLine.point2.price, 6)}</text>
                                    </g>
                                );
                            })()}
                            {/* Midpoint */}
                            {snapshot.channel.midpoint !== undefined && (() => {
                                const chY = getY(snapshot.channel.midpoint);
                                return (
                                    <g>
                                        <line x1={padLeft} y1={chY} x2={padLeft + chartWidth} y2={chY} stroke="rgba(167, 139, 250, 0.12)" strokeDasharray="3 3" strokeWidth={1.2} />
                                        <text x={padLeft + chartWidth + 5} y={chY + 3} fill="rgba(167, 139, 250, 0.25)" fontSize="8" fontFamily="monospace">CH MID: {safeToFixed(snapshot.channel.midpoint, 6)}</text>
                                    </g>
                                );
                            })()}
                        </g>
                    )}

                    {/* Overlaid Entry Price Level */}
                    {(() => {
                        const y = getY(entryPrice);
                        return (
                            <g>
                                <line x1={padLeft} y1={y} x2={padLeft + chartWidth} y2={y} stroke="#3B82F6" strokeDasharray="4 4" strokeWidth={1.5} />
                                <rect x={padLeft + chartWidth + 4} y={y - 7} width={130} height={14} fill="rgba(59, 130, 246, 0.2)" rx={3} />
                                <text x={padLeft + chartWidth + 8} y={y + 3} fill="#93C5FD" fontSize="9" fontFamily="monospace" fontWeight="bold">ENTRY: {safeToFixed(entryPrice, 6)}</text>
                            </g>
                        );
                    })()}
                    
                    {/* Overlaid Stop Loss Level */}
                    {(() => {
                        const y = getY(slPrice);
                        return (
                            <g>
                                <line x1={padLeft} y1={y} x2={padLeft + chartWidth} y2={y} stroke="#EF4444" strokeDasharray="3 3" strokeWidth={1.5} />
                                <rect x={padLeft + chartWidth + 4} y={y - 7} width={130} height={14} fill="rgba(239, 68, 68, 0.2)" rx={3} />
                                <text x={padLeft + chartWidth + 8} y={y + 3} fill="#FCA5A5" fontSize="9" fontFamily="monospace" fontWeight="bold">SL: {safeToFixed(slPrice, 6)}</text>
                            </g>
                        );
                    })()}
                    
                    {/* Overlaid Take Profit Targets */}
                    {targetsList.map((t: any, idx: number) => {
                        const y = getY(t?.price || 0);
                        return (
                            <g key={idx}>
                                <line x1={padLeft} y1={y} x2={padLeft + chartWidth} y2={y} stroke="#10B981" strokeDasharray="3 3" strokeWidth={1.5} />
                                <rect x={padLeft + chartWidth + 4} y={y - 7} width={130} height={14} fill="rgba(16, 185, 129, 0.2)" rx={3} />
                                <text x={padLeft + chartWidth + 8} y={y + 3} fill="#6EE7B7" fontSize="9" fontFamily="monospace" fontWeight="bold">TP{idx+1}: {safeToFixed(t?.price, 6)}</text>
                            </g>
                        );
                    })}
                    
                    {/* Entry Indicator Arrow (At index N-1) Lined up perfectly at right edge */}
                    {(() => {
                        const lastCandle = candles[entryIdx] || {};
                        const refPrice = lastCandle.low !== undefined ? lastCandle.low : entryPrice;
                        if (snapshot?.side === 'long') {
                            const y = getY(refPrice) + 12;
                            return (
                                <g>
                                    {/* Dotted pointing up indicator */}
                                    <line x1={entryX} y1={y - 2} x2={entryX} y2={y + 25} stroke="#10B981" strokeWidth={1.5} strokeDasharray="2 2" />
                                    {/* Arrow polygon */}
                                    <polygon points={`${entryX},${y} ${entryX - 6},${y + 10} ${entryX + 6},${y + 10}`} fill="#10B981" />
                                    <text x={entryX - 35} y={y + 22} fill="#10B981" fontSize="8" fontWeight="bold" fontFamily="monospace">LONG SIGNAL</text>
                                </g>
                            );
                        } else {
                            const refPriceHigh = lastCandle.high !== undefined ? lastCandle.high : entryPrice;
                            const y = getY(refPriceHigh) - 12;
                            return (
                                <g>
                                    {/* Dotted pointing down indicator */}
                                    <line x1={entryX} y1={y + 2} x2={entryX} y2={y - 25} stroke="#EF4444" strokeWidth={1.5} strokeDasharray="2 2" />
                                    {/* Arrow polygon */}
                                    <polygon points={`${entryX},${y} ${entryX - 6},${y - 10} ${entryX + 6},${y - 10}`} fill="#EF4444" />
                                    <text x={entryX - 40} y={y - 18} fill="#EF4444" fontSize="8" fontWeight="bold" fontFamily="monospace">SHORT SIGNAL</text>
                                </g>
                            );
                        }
                    })()}

                    {/* Real Exits Display */}
                    {activeTradeInfo?.exits && activeTradeInfo.exits.map((ex: any, idx: number) => {
                        const exitTimestampSec = ex.timestamp ? (ex.timestamp > 1000000000000 ? Math.floor(ex.timestamp / 1000) : ex.timestamp) : null;
                        if (!exitTimestampSec) return null;
                        
                        const exitIdx = getExitIdx(exitTimestampSec);
                        const exitX = getX(exitIdx);
                        const exitY = getY(ex.price);
                        
                        // Choose appropriate color based on exit PNL/reason
                        const isExitWin = Number(ex.pnlUsdt || 0) >= 0;
                        const neonColor = isExitWin ? '#10B981' : '#EF4444'; // Green for win/TP, Red for SL/loss
                        const shadowId = `glow-exit-${idx}`;
                        
                        return (
                            <g key={`exit-marker-${idx}`}>
                                <defs>
                                    <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
                                        <feGaussianBlur stdDeviation="4" result="blur" />
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>
                                
                                {/* Vertical dotted line from the candle to the exit point */}
                                <line 
                                    x1={exitX} 
                                    y1={padTop} 
                                    x2={exitX} 
                                    y2={padTop + chartHeight} 
                                    stroke={neonColor} 
                                    strokeWidth={1} 
                                    strokeDasharray="3 3" 
                                    opacity={0.4} 
                                />
                                
                                {/* Glowing neon circle marker at exit price/index */}
                                <circle 
                                    cx={exitX} 
                                    cy={exitY} 
                                    r={6} 
                                    fill={neonColor} 
                                    filter={`url(#${shadowId})`} 
                                    stroke="#090d16" 
                                    strokeWidth={1.5} 
                                />
                                
                                {/* Inner smaller white circle for premium dot effect */}
                                <circle 
                                    cx={exitX} 
                                    cy={exitY} 
                                    r={2} 
                                    fill="#ffffff" 
                                />
                                
                                {/* Exit reason label box */}
                                <g transform={`translate(${exitX + 8}, ${exitY - 14})`}>
                                    <rect 
                                        x={0} 
                                        y={0} 
                                        width={95} 
                                        height={18} 
                                        fill="rgba(9, 13, 22, 0.85)" 
                                        stroke={neonColor} 
                                        strokeWidth={1} 
                                        rx={4} 
                                    />
                                    <text 
                                        x={6} 
                                        y={12} 
                                        fill="#ffffff" 
                                        fontSize="8.5" 
                                        fontWeight="bold" 
                                        fontFamily="monospace"
                                    >
                                        {ex.reason || 'EXIT'} @ {safeToFixed(ex.price, 4)}
                                    </text>
                                </g>
                            </g>
                        );
                    })}

                    {/* Interactive Trendlines */}
                    {trendlines.map((line, idx) => (
                        <line 
                            key={`trendline-${idx}`} 
                            x1={line.x1} 
                            y1={line.y1} 
                            x2={line.x2} 
                            y2={line.y2} 
                            stroke={line.color} 
                            strokeWidth={2} 
                            strokeLinecap="round" 
                        />
                    ))}
                    {activeLine && (
                        <line 
                            x1={activeLine.x1} 
                            y1={activeLine.y1} 
                            x2={activeLine.x2} 
                            y2={activeLine.y2} 
                            stroke={activeLine.color} 
                            strokeWidth={2} 
                            strokeDasharray="4 4" 
                            strokeLinecap="round" 
                        />
                    )}
                </svg>
            );
        }

        return (
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem',
                overflow: 'hidden'
            }}>
                {/* Upper Diagnostics Info Bar */}
                <div style={{
                    background: 'rgba(15, 23, 42, 0.4)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '16px',
                    padding: '0.5rem 0.8rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            🎯 {snapshot?.symbol ? snapshot.symbol.split(':')[0] : 'UNKNOWN'}
                            <span style={{
                                fontSize: '0.7rem',
                                color: sideColor,
                                background: snapshot?.side === 'long' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontWeight: 700
                            }}>
                                {sideLabel} {snapshot?.leverage || 1}x
                            </span>
                            {isNYSession ? (
                                <span style={{
                                    fontSize: '0.7rem',
                                    color: '#F59E0B',
                                    background: 'rgba(245, 158, 11, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontWeight: 700,
                                    border: '1px solid rgba(245, 158, 11, 0.2)'
                                }}>
                                    🛡️ NY opening hour volatility protected
                                </span>
                            ) : (
                                <span style={{
                                    fontSize: '0.7rem',
                                    color: '#94A3B8',
                                    background: 'rgba(148, 163, 184, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontWeight: 700
                                }}>
                                    ⚪ Standard session
                                </span>
                            )}
                        </h3>
                        <span style={{ fontSize: '0.68rem', color: '#64748B' }}>
                            Sofia local time (EEST) entry: <strong>{bulgariaTimeStr}</strong>
                        </span>
                    </div>

                    {/* Reviewer Timeframe selection */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '0.68rem', color: '#64748B', marginRight: '6px' }}>TIMEFRAME:</span>
                        {['1m', '3m', '15m'].map((tf) => (
                            <button
                                key={tf}
                                onClick={() => setReviewerTimeframe(tf as any)}
                                style={{
                                    background: reviewerTimeframe === tf ? 'rgba(0, 255, 204, 0.15)' : 'rgba(0, 0, 0, 0.3)',
                                    border: reviewerTimeframe === tf ? '1px solid #00ffcc' : '1px solid rgba(255, 255, 255, 0.05)',
                                    color: reviewerTimeframe === tf ? '#00ffcc' : '#94A3B8',
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Custom Chart View */}
                <div style={{
                    background: 'rgba(15, 23, 42, 0.4)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '16px',
                    padding: '0.5rem',
                    flex: '1.4',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '10px',
                        left: '15px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        fontSize: '0.65rem',
                        color: '#94A3B8',
                        pointerEvents: 'none',
                        zIndex: 5,
                        display: 'flex',
                        gap: '8px'
                    }}>
                        <span>Entry: <strong style={{ color: '#3B82F6' }}>{safeToFixed(entryPrice, 6)}</strong></span>
                        <span>SL: <strong style={{ color: '#EF4444' }}>{safeToFixed(slPrice, 6)}</strong></span>
                        <span>TP1: <strong style={{ color: '#10B981' }}>{safeToFixed(targetsList[0]?.price, 6)}</strong></span>
                        {snapshot?.channel && (
                            <span>Channel Width: <strong style={{ color: '#A78BFA' }}>{safeToFixed(snapshot?.channel?.widthPct !== undefined ? snapshot.channel.widthPct * 100 : (snapshot?.channelWidthPct !== undefined ? snapshot.channelWidthPct * 100 : 0), 2)}%</strong></span>
                        )}
                    </div>
                    
                    <div style={{ flex: 1, minHeight: 0, width: '100%', height: '100%', position: 'relative' }}>
                        {chartSVG ? chartSVG : (
                            <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#64748B', fontSize: '0.78rem' }}>
                                Candlestick data unavailable.
                            </div>
                        )}
                    </div>

                    {/* Floating Neon Trendline Toolbar */}
                    <div style={{
                        position: 'absolute',
                        bottom: '10px',
                        right: '15px',
                        background: 'rgba(9, 13, 22, 0.85)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        padding: '6px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        zIndex: 10,
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5), 0 0 10px rgba(0, 255, 204, 0.1)',
                        direction: 'rtl',
                        fontFamily: 'Tahoma, Geneva, sans-serif'
                    }}>
                        <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 'bold' }}>
                            🛠️ ابزار ترسیم دستی:
                        </span>
                        
                        {/* Pencil Mode Toggle */}
                        <button
                            onClick={() => setDrawingMode(!drawingMode)}
                            style={{
                                background: drawingMode ? 'rgba(0, 255, 204, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                border: drawingMode ? '1px solid #00ffcc' : '1px solid rgba(255, 255, 255, 0.1)',
                                color: drawingMode ? '#00ffcc' : '#E2E8F0',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                fontSize: '0.68rem',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.2s ease',
                                boxShadow: drawingMode ? '0 0 8px rgba(0, 255, 204, 0.3)' : 'none'
                            }}
                        >
                            ✏️ {drawingMode ? 'حالت ترسیم فعال' : 'رسم خط روند'}
                        </button>
                        
                        {/* Color circles */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {['#00ffcc', '#ff007f', '#ffea00', '#00e5ff', '#ffffff'].map(color => (
                                <button
                                    key={color}
                                    onClick={() => setSelectedColor(color)}
                                    style={{
                                        width: '14px',
                                        height: '14px',
                                        borderRadius: '50%',
                                        backgroundColor: color,
                                        border: selectedColor === color ? '2px solid #ffffff' : '1px solid rgba(0,0,0,0.5)',
                                        cursor: 'pointer',
                                        boxShadow: selectedColor === color ? `0 0 6px ${color}` : 'none',
                                        transition: 'all 0.15s ease',
                                        padding: 0
                                    }}
                                    title={color}
                                />
                            ))}
                        </div>
                        
                        {/* Separator line */}
                        <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)' }} />
                        
                        {/* Undo Button */}
                        <button
                            onClick={() => setTrendlines(prev => prev.slice(0, -1))}
                            disabled={trendlines.length === 0}
                            style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                color: trendlines.length === 0 ? '#475569' : '#E2E8F0',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                fontSize: '0.68rem',
                                cursor: trendlines.length === 0 ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            ↩️ برگشت (Undo)
                        </button>
                        
                        {/* Clear Button */}
                        <button
                            onClick={() => {
                                setTrendlines([]);
                                setActiveLine(null);
                            }}
                            disabled={trendlines.length === 0}
                            style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                color: trendlines.length === 0 ? '#475569' : '#FCA5A5',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                fontSize: '0.68rem',
                                cursor: trendlines.length === 0 ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            🗑️ پاک کردن همه
                        </button>

                        {drawingMode && (
                            <span style={{ fontSize: '0.65rem', color: '#00ffcc', marginRight: '5px' }}>
                                ← روی چارت درگ کنید
                            </span>
                        )}
                    </div>
                </div>

                {/* Lower Diagnostic Data & Exits Panel */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1.1fr 0.9fr',
                    gap: '0.45rem',
                    flex: '1',
                    overflow: 'hidden'
                }}>
                    {/* Panel A: Indicators Calculation Grid */}
                    <div style={{
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '16px',
                        padding: '0.6rem 0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto'
                    }}>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '4px' }}>
                            🧮 Mathematical Snapshot & Indicator States
                        </h4>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '0.5rem',
                            fontSize: '0.74rem'
                        }}>
                            {/* Left indicators column */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>Trends (Macro / Structural / Trading)</span>
                                    <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>
                                        {(snapshot?.trends?.macro || snapshot?.macroTrend || 'N/A')} / {(snapshot?.trends?.structural || snapshot?.structuralTrend || 'N/A')} / {(snapshot?.trends?.trading || snapshot?.tradingTrend || 'N/A')}
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>Confidence Score</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                                        <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ width: `${snapshot?.confidence || 0}%`, height: '100%', background: 'linear-gradient(to right, #3B82F6, #00ffcc)', borderRadius: '3px' }} />
                                        </div>
                                        <strong style={{ color: '#00ffcc' }}>{snapshot?.confidence || 0}%</strong>
                                    </div>
                                </div>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>Channel Width & Volatility</span>
                                    <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>
                                        {safeToFixed(snapshot?.channel?.widthPct !== undefined ? snapshot.channel.widthPct * 100 : (snapshot?.channelWidthPct !== undefined ? snapshot.channelWidthPct * 100 : 0), 3)}% ({safeToFixed(snapshot?.channel?.width || snapshot?.channelWidth, 6)} price width)
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>ATR (Average True Range)</span>
                                    <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>
                                        {safeToFixed(snapshot?.atrPct !== undefined ? snapshot.atrPct * 100 : (snapshot?.atrPct || 0), 3)}% ({safeToFixed(snapshot?.atr, 6)})
                                    </span>
                                </div>
                            </div>
                            
                            {/* Right indicators column */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>OB / OS Region Alignment</span>
                                    <span style={{
                                        color: snapshot?.zone?.zone === 'OS' ? '#10B981' : snapshot?.zone?.zone === 'OB' ? '#EF4444' : '#E2E8F0',
                                        fontWeight: 'bold'
                                    }}>
                                        {snapshot?.zone?.zone || 'NEUTRAL'} (In Zone: {snapshot?.zone?.inZone ? 'YES' : 'NO'}, Depth: {safeToFixed(snapshot?.zone?.depthPct, 1)}%)
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>Risk/Reward Ratio Check</span>
                                    <span style={{
                                        color: snapshot?.riskReward?.pass ? '#10B981' : '#EF4444',
                                        fontWeight: 'bold'
                                    }}>
                                        R:R {safeToFixed(snapshot?.riskReward?.rr, 2)} (Validation: {snapshot?.riskReward?.pass ? 'PASS' : 'FAIL'})
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>Slope Momentum Check</span>
                                    <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>
                                        Score: {snapshot?.momentum?.slopeMomentumScore || 0} / 3 (Validation: {snapshot?.momentum?.slopeMomentumPass ? 'PASS' : 'FAIL'})
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: '0.6rem', textTransform: 'uppercase' }}>Range Momentum Type</span>
                                    <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>
                                        {snapshot?.momentum?.rangeMomentum || 'NONE'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Panel B: Exits Executed & Outcomes Timeline */}
                    <div style={{
                        background: 'rgba(15, 23, 42, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '16px',
                        padding: '0.6rem 0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto'
                    }}>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '4px' }}>
                            📈 Position Exit Executions & Outcome
                        </h4>
                        
                        {activeTradeInfo ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                                {/* Status Row */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
                                    <span style={{ color: '#64748B' }}>Trade status:</span>
                                    <strong style={{ color: activeTradeInfo.closed ? '#94A3B8' : '#3B82F6' }}>
                                        {activeTradeInfo.closed ? 'CLOSED' : 'ACTIVE'}
                                    </strong>
                                </div>
                                
                                {/* PNL summary */}
                                <div style={{
                                    background: 'rgba(0, 0, 0, 0.2)',
                                    borderRadius: '8px',
                                    padding: '5px 8px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '0.78rem'
                                }}>
                                    <span style={{ color: '#94A3B8' }}>Total PnL realized:</span>
                                    <strong style={{
                                        fontSize: '0.85rem',
                                        color: (activeTradeInfo.finalPnlUsdt || 0) >= 0 ? '#10B981' : '#EF4444'
                                    }}>
                                        {(activeTradeInfo.finalPnlUsdt || 0) >= 0 ? '+' : ''}{safeToFixed(activeTradeInfo.finalPnlUsdt, 2)} USDT ({(activeTradeInfo.finalPnlPct || 0) >= 0 ? '+' : ''}{safeToFixed(activeTradeInfo.finalPnlPct, 2)}%)
                                    </strong>
                                </div>

                                {/* Timeline list */}
                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '4px',
                                    fontSize: '0.7rem',
                                    marginTop: '2px',
                                    fontFamily: 'Courier New, monospace'
                                }}>
                                    <span style={{ color: '#475569', fontSize: '0.62rem', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '2px' }}>
                                        [Exit Timeline]
                                    </span>
                                    
                                    {(!activeTradeInfo.exits || activeTradeInfo.exits.length === 0) ? (
                                        <div style={{ color: '#64748B', fontStyle: 'italic', padding: '0.4rem 0' }}>
                                            Position active. Waiting for exit signals (TP1-3, SL)...
                                        </div>
                                    ) : (
                                        activeTradeInfo.exits.map((ex: any, idx: number) => {
                                            const exitDate = new Date(ex.timestamp ? (ex.timestamp > 1000000000000 ? ex.timestamp : ex.timestamp * 1000) : Date.now());
                                            let exitTimeStr = 'Unknown';
                                            if (exitDate && !isNaN(exitDate.getTime())) {
                                                try {
                                                    exitTimeStr = exitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                                } catch (e) {
                                                    // ignore
                                                }
                                            }
                                            const isExitWin = Number(ex.pnlUsdt || 0) >= 0;
                                            const color = isExitWin ? '#3B82F6' : '#EF4444';
                                            
                                            return (
                                                <div key={idx} style={{
                                                    background: 'rgba(255, 255, 255, 0.01)',
                                                    borderLeft: `2px solid ${color}`,
                                                    padding: '2px 6px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '1px'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#E2E8F0' }}>
                                                        <span>⚡ {ex.reason || 'Exit Signal'}</span>
                                                        <span style={{ color: '#64748B' }}>{exitTimeStr}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: isExitWin ? '#10B981' : '#F59E0B', fontSize: '0.66rem' }}>
                                                        <span>Price: {safeToFixed(ex.price, 6)} USDT</span>
                                                        <strong style={{ color: Number(ex.pnlUsdt || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                                                            {Number(ex.pnlUsdt || 0) >= 0 ? '+' : ''}{safeToFixed(ex.pnlUsdt, 2)} USDT ({Number(ex.pnlPct || 0) >= 0 ? '+' : ''}{safeToFixed(ex.pnlPct, 2)}%)
                                                        </strong>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: '#64748B', fontStyle: 'italic', fontSize: '0.75rem' }}>
                                Exits data loading error...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    } catch (err: any) {
        return (
            <div style={{
                flex: 1,
                background: 'rgba(15, 23, 42, 0.3)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '16px',
                padding: '2rem',
                textAlign: 'center',
                color: '#F87171',
                direction: 'rtl',
                fontFamily: 'sans-serif',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '15px'
            }}>
                <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#EF4444', fontWeight: 800 }}>
                    خطای رندر اطلاعات سیگنال
                </h3>
                <p style={{ fontSize: '0.8rem', color: '#F87171', opacity: 0.85, margin: 0, maxWidth: '420px', lineHeight: '1.4' }}>
                    در زمان ترسیم گرافیکی یا محاسبات آماری خطایی رخ داده است.
                </p>
                <div style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    padding: '0.8rem',
                    borderRadius: '8px',
                    fontSize: '0.74rem',
                    fontFamily: 'monospace',
                    textAlign: 'left',
                    whiteSpace: 'pre-wrap',
                    overflowX: 'auto',
                    color: '#EF4444',
                    maxWidth: '90%',
                    boxSizing: 'border-box'
                }}>
                    {err?.toString()}
                </div>
            </div>
        );
    }
}

export default function App() {
    const [settings, setSettings] = useState<any>({
        portfolioTotalCapitalUsdt: 1000,
        portfolioTokenAllocationUsdt: 200,
        amiroTradeSizeUsdt: 50
    });

    const symbols = useMemo(() => {
        return settings.targetSymbols || [
            '1000BONK/USDT:USDT',
            'WIF/USDT:USDT',
            'POPCAT/USDT:USDT',
            'BOME/USDT:USDT'
        ];
    }, [settings.targetSymbols]);

    const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});

    const [signals, setSignals] = useState<Signal[]>([]);
    const [tradeMemory, setTradeMemory] = useState<TradeMemoryEntry[]>([]);
    const [logs, setLogs] = useState<TradeLog[]>([]);

    const [activeTab, setActiveTab] = useState<'dashboard' | 'reviewer'>('dashboard');
    const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
    const [debugSnapshot, setDebugSnapshot] = useState<any>(null);
    const [loadingDebug, setLoadingDebug] = useState<boolean>(false);
    const [debugError, setDebugError] = useState<string | null>(null);
    const [reviewerTimeframe, setReviewerTimeframe] = useState<'1m' | '3m' | '15m'>('1m');
    const [globalError, setGlobalError] = useState<string | null>(null);

    // Global error listener to trap commit-phase and runtime exceptions
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            console.error("Captured global error:", event.error);
            const stack = event.error?.stack || event.error?.message || event.message || "Unknown error";
            setGlobalError(stack);
        };
        const handleRejection = (event: PromiseRejectionEvent) => {
            console.error("Captured global rejection:", event.reason);
            const stack = event.reason?.stack || event.reason?.message || String(event.reason) || "Unknown promise rejection";
            setGlobalError(stack);
        };
        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);
        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, []);

    // Fetch detailed diagnostic debug snapshot when a trade is selected in the reviewer
    useEffect(() => {
        if (!selectedTradeId) {
            setDebugSnapshot(null);
            setDebugError(null);
            return;
        }

        const fetchDebugData = async () => {
            setLoadingDebug(true);
            setDebugError(null);
            try {
                const res = await fetch(`/api/debug-data/${selectedTradeId}`);
                
                // Check if response is HTML (Vite / Express SPA fallback or missing file)
                const contentType = res.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error('داده‌های عیب‌یابی دقیق برای این معامله یافت نشد. این مورد مربوط به یک معامله قدیمی (قبل از فعال‌سازی قابلیت تحلیل پیشرفته) است یا فایل جزئیات فنی آن روی سرور موجود نیست.');
                }

                if (!res.ok) {
                    let errorMessage = 'Failed to load detailed diagnostics';
                    try {
                        const errData = await res.json();
                        errorMessage = errData.error || errorMessage;
                    } catch (e) {
                        // ignore
                    }
                    throw new Error(errorMessage);
                }
                const data = await res.json();
                data.tradeId = selectedTradeId;
                setDebugSnapshot(data);
            } catch (err: any) {
                console.error('Error fetching debug data:', err);
                setDebugError(err.message);
                setDebugSnapshot(null);
            } finally {
                setLoadingDebug(false);
            }
        };

        fetchDebugData();
    }, [selectedTradeId]);

    const allCandlesRef = useRef<Record<string, Candle[]>>({});
    const wsRef = useRef<WebSocket | null>(null);

    // Fetch initial state from API on load
    useEffect(() => {
        const fetchInitialState = async () => {
            try {
                const res = await fetch('/api/state');
                const state = await res.json();
                
                if (state.candles) {
                    allCandlesRef.current = state.candles;
                    const initialPrices: Record<string, number> = {};
                    Object.keys(state.candles).forEach((sym) => {
                        const candles = state.candles[sym];
                        if (candles && candles.length > 0) {
                            initialPrices[sym] = candles[candles.length - 1].close;
                        }
                    });
                    setCurrentPrices(prev => ({ ...prev, ...initialPrices }));
                }
                let initialLogs: TradeLog[] = [];
                if (state.logs) {
                    initialLogs = [...state.logs];
                }
                if (state.signals) {
                    setSignals(state.signals);
                    const signalLogs: TradeLog[] = state.signals.map((sig: Signal) => {
                        const timeStr = new Date(sig.time * 1000).toLocaleTimeString();
                        return {
                            time: timeStr,
                            token: sig.symbol,
                            status: sig.type.includes('EXIT') ? 'REJECT' : 'APPROVED',
                            reason: `${sig.type} at ${sig.price.toFixed(6)} SOL${sig.leverage ? ` | ${sig.leverage}x` : ''}${sig.tp ? ` | TP ${sig.tp.toFixed(6)}` : ''}${sig.sl ? ` | SL ${sig.sl.toFixed(6)}` : ''}`
                        };
                    });
                    const reversedSignals = [...signalLogs].reverse();
                    initialLogs = [...reversedSignals, ...initialLogs].slice(0, 100);
                }
                setLogs(initialLogs);
                if (state.settings) {
                    setSettings(state.settings);
                }
                if (state.tradeMemory) {
                    setTradeMemory(state.tradeMemory);
                }
            } catch (err) {
                console.error('Error fetching initial state:', err);
            }
        };

        fetchInitialState();
    }, []);

    // WebSocket connection for real-time updates
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                if (message.type === 'INIT') {
                    if (message.data.candles) {
                        allCandlesRef.current = message.data.candles;
                        const initialPrices: Record<string, number> = {};
                        Object.keys(message.data.candles).forEach((sym) => {
                            const candles = message.data.candles[sym];
                            if (candles && candles.length > 0) {
                                initialPrices[sym] = candles[candles.length - 1].close;
                            }
                        });
                        setCurrentPrices(prev => ({ ...prev, ...initialPrices }));
                    }
                    if (message.data.signals) {
                        setSignals(message.data.signals);
                    }
                    let initLogs: TradeLog[] = [];
                    if (message.data.logs) {
                        initLogs = [...message.data.logs];
                    }
                    if (message.data.signals) {
                        const signalLogs: TradeLog[] = message.data.signals.map((sig: Signal) => {
                            const timeStr = new Date(sig.time * 1000).toLocaleTimeString();
                            return {
                                time: timeStr,
                                token: sig.symbol,
                                status: sig.type.includes('EXIT') ? 'REJECT' : 'APPROVED',
                                reason: `${sig.type} at ${sig.price.toFixed(6)} SOL${sig.leverage ? ` | ${sig.leverage}x` : ''}${sig.tp ? ` | TP ${sig.tp.toFixed(6)}` : ''}${sig.sl ? ` | SL ${sig.sl.toFixed(6)}` : ''}`
                            };
                        });
                        const reversedSignals = [...signalLogs].reverse();
                        initLogs = [...reversedSignals, ...initLogs].slice(0, 100);
                    }
                    setLogs(initLogs);
                    if (message.data.settings) setSettings(message.data.settings);
                    if (message.data.tradeMemory) setTradeMemory(message.data.tradeMemory);
                } else if (message.type === 'CANDLE') {
                    const { symbol, candle } = message.data;
                    
                    if (symbol === 'SOL/USDT:USDT') return; // Skip base price candle

                    if (!allCandlesRef.current[symbol]) {
                        allCandlesRef.current[symbol] = [];
                    }
                    
                    const candles = allCandlesRef.current[symbol];
                    const existingIndex = candles.findIndex((c: Candle) => c.time === candle.time);
                    if (existingIndex > -1) {
                        candles[existingIndex] = candle;
                    } else {
                        candles.push(candle);
                    }

                    // Update current real-time price (denominated in SOL)
                    setCurrentPrices(prev => ({ ...prev, [symbol]: candle.close }));
                } else if (message.type === 'SIGNAL') {
                    const signal = message.data;
                    setSignals((prev: Signal[]) => [...prev, signal]);
                    
                    // Add entry to overall log
                    const timeStr = new Date(signal.time * 1000).toLocaleTimeString();
                    setLogs((prev: TradeLog[]) => [
                        {
                            time: timeStr,
                            token: signal.symbol,
                            status: signal.type.includes('EXIT') ? 'REJECT' : 'APPROVED',
                            reason: `${signal.type} at ${signal.price.toFixed(6)} SOL${signal.leverage ? ` | ${signal.leverage}x` : ''}${signal.tp ? ` | TP ${signal.tp.toFixed(6)}` : ''}${signal.sl ? ` | SL ${signal.sl.toFixed(6)}` : ''}`
                        },
                        ...prev
                    ]);
                } else if (message.type === 'LOG') {
                    setLogs((prev: TradeLog[]) => [message.data, ...prev].slice(0, 50));
                } else if (message.type === 'TRADE_MEMORY') {
                    setTradeMemory(message.data);
                }
            } catch (err) {
                console.error('Error parsing WS message:', err);
            }
        };

        return () => ws.close();
    }, []);

    // Rebuild token states from the array of historical trades in tradeMemory
    const tokenStates = useMemo(() => {
        const alloc = settings.portfolioTokenAllocationUsdt || 200;
        const states: Record<string, TokenState> = {};

        const normalizeToMs = (ts: number) => {
            if (!ts) return Date.now();
            return ts < 9999999999 ? ts * 1000 : ts;
        };

        symbols.forEach((sym: string) => {
            const tokenTrades = tradeMemory.filter(t => t.context.symbol.split(':')[0] === sym.split(':')[0]);
            const closedTrades = tokenTrades.filter(t => t.closed);
            const openTrade = tokenTrades.find(t => !t.closed);

            const completedWins = closedTrades.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN').length;
            const totalTrades = closedTrades.length;
            const winRate = totalTrades > 0 ? Math.round((completedWins / totalTrades) * 100) : 0;
            const pnl = closedTrades.reduce((sum, t) => sum + t.finalPnlUsdt, 0);

            const activeTrade = openTrade ? {
                side: openTrade.context.side,
                entryPrice: openTrade.context.entryPrice,
                amount: settings.amiroTradeSizeUsdt || 50,
                leverage: openTrade.context.leverage,
                timestamp: openTrade.timestamp,
                remainingPct: 1.0 - openTrade.exits.reduce((acc, ex) => {
                    const r = String(ex?.reason || ex?.exitReason || ex?.type || '');
                    return acc + (r.includes('TP1') ? 0.5 : r.includes('TP2') ? 0.25 : r.includes('TP3') ? 0.25 : 0);
                }, 0),
                accumulatedPnL: openTrade.finalPnlUsdt
            } : null;

            // Reconstruct precise, detailed logs from tradeMemory entries
            const cardLogs: any[] = [];
            
            tokenTrades.forEach(t => {
                const normalizedEntryTime = normalizeToMs(t.timestamp);
                const timeStr = new Date(normalizedEntryTime).toLocaleTimeString();
                
                // Entry Log
                cardLogs.push({
                    time: timeStr,
                    timestamp: normalizedEntryTime,
                    type: t.context.side === 'long' ? 'BUY' : 'SELL',
                    price: t.context.entryPrice,
                    reason: t.context.side === 'long'
                        ? `LONG ENTRY at ${t.context.entryPrice.toFixed(6)} USDT | ${t.context.leverage}x`
                        : `SHORT ENTRY at ${t.context.entryPrice.toFixed(6)} USDT | ${t.context.leverage}x`,
                    pnl: null,
                    pnlPct: null,
                    leverage: t.context.leverage
                });
                
                // Exit Logs
                t.exits.forEach(ex => {
                    const normalizedExitTime = normalizeToMs(ex.timestamp);
                    const exitTimeStr = new Date(normalizedExitTime).toLocaleTimeString();
                    const r = String(ex?.reason || ex?.exitReason || ex?.type || '');
                    const exitLabel = r.includes('TP1') ? 'TP1' : 
                                      r.includes('TP2') ? 'TP2' : 
                                      (r.includes('TP3') || r.includes('Take Profit')) ? 'TP3' : 
                                      (r.includes('Stop Loss') || r.includes('SL')) ? 'SL' : 'EXIT';
                    const exitType = t.context.side === 'long' ? 'LONG' : 'SHORT';
                    const reasonText = `EXIT ${exitType} (${exitLabel}) at ${safeToFixed(ex.price, 6)} USDT | PnL:`;
                    
                    cardLogs.push({
                        time: exitTimeStr,
                        timestamp: normalizedExitTime,
                        type: t.context.side === 'long' ? 'BUY_EXIT' : 'SELL_EXIT',
                        price: ex.price,
                        reason: reasonText,
                        pnl: ex.pnlUsdt,
                        pnlPct: ex.pnlPct,
                        leverage: t.context.leverage
                    });
                });
            });
            
            // Sort card logs descending by timestamp
            cardLogs.sort((a, b) => b.timestamp - a.timestamp);

            states[sym] = {
                symbol: sym,
                allocatedBalance: alloc + pnl,
                initialAllocation: alloc,
                activeTrade,
                logs: cardLogs,
                stats: {
                    winRate,
                    totalTrades,
                    profits: closedTrades.filter(t => t.finalPnlUsdt > 0).reduce((sum, t) => sum + t.finalPnlUsdt, 0),
                    losses: Math.abs(closedTrades.filter(t => t.finalPnlUsdt < 0).reduce((sum, t) => sum + t.finalPnlUsdt, 0)),
                    pnl,
                    pnlPercent: (pnl / alloc) * 100,
                    completedWins
                }
            };
        });

        return states;
    }, [signals, settings, symbols, tradeMemory]);

    // Calculate real-time active active trade PnL
    const getUnrealizedPnL = (symbol: string) => {
        const state = tokenStates[symbol];
        if (!state || !state.activeTrade) return { pnl: 0, pnlPercent: 0 };
        
        const active = state.activeTrade;
        const currentPrice = currentPrices[symbol] || active.entryPrice;
        
        if (!currentPrice || currentPrice === 0) return { pnl: 0, pnlPercent: 0 };

        const leverage = active.leverage;
        const remaining = active.remainingPct !== undefined ? active.remainingPct : 1.0;
        const remainingAmount = active.amount * remaining;
        
        let pnl = 0;
        if (active.side === 'long') {
            pnl = remainingAmount * leverage * ((currentPrice - active.entryPrice) / active.entryPrice);
        } else {
            pnl = remainingAmount * leverage * ((active.entryPrice - currentPrice) / active.entryPrice);
        }
        const pnlPercent = remainingAmount > 0 ? (pnl / remainingAmount) * 100 : 0;
        return { pnl, pnlPercent };
    };

    // Calculate overall stats dynamically from tradeMemory (with real-time ticking unrealized PnL)
    const overallStats = useMemo(() => {
        const closedTrades = tradeMemory.filter(t => t.closed);
        const totalTradesCount = tradeMemory.length;
        const closedTradesCount = closedTrades.length;
        const totalWinTrades = closedTrades.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN').length;
        const winRate = closedTradesCount > 0 ? Math.round((totalWinTrades / closedTradesCount) * 100) : 0;
        
        let totalPnL = closedTrades.reduce((sum, t) => sum + t.finalPnlUsdt, 0);

        // Include real-time ticking PnL from active trades
        symbols.forEach((sym: string) => {
            const activePnL = getUnrealizedPnL(sym).pnl;
            totalPnL += activePnL;
        });

        const initialBalance = settings.portfolioTotalCapitalUsdt || 1000;
        const currentBalance = initialBalance + totalPnL;

        return {
            totalTrades: totalTradesCount,
            winRate,
            totalPnL,
            currentBalance
        };
    }, [tradeMemory, tokenStates, currentPrices, settings, symbols]);

    // Calculate performance stats per risk level dynamically from tradeMemory
    const riskLevelStats = useMemo(() => {
        const levels = ['VERY_LOW', 'LOW', 'MEDIUM'];
        return levels.map(level => {
            const levelTrades = tradeMemory.filter(t => t.context.riskLevel === level);
            const closed = levelTrades.filter(t => t.closed);
            const total = closed.length;
            const wins = closed.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN').length;
            const wr = total > 0 ? (wins / total * 100) : 0;
            const pnl = closed.reduce((sum, t) => sum + t.finalPnlUsdt, 0);
            return {
                level,
                winRate: wr,
                totalTrades: levelTrades.length,
                closedTradesCount: total,
                pnl
            };
        });
    }, [tradeMemory]);

    if (globalError) {
        return (
            <div style={{
                background: 'radial-gradient(circle at top left, #0b0f19, #05070c)',
                color: '#F8FAFC',
                height: '100vh',
                fontFamily: 'Inter, system-ui, sans-serif',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                direction: 'rtl',
                padding: '2rem',
                boxSizing: 'border-box'
            }}>
                <div style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '24px',
                    padding: '2.5rem',
                    maxWidth: '650px',
                    textAlign: 'center',
                    boxShadow: '0 25px 50px -12px rgba(239, 68, 68, 0.25)'
                }}>
                    <span style={{ fontSize: '3.5rem', filter: 'drop-shadow(0 0 15px rgba(239,68,68,0.4))' }}>⚠️</span>
                    <h2 style={{ color: '#EF4444', fontSize: '1.4rem', marginTop: '1rem', fontWeight: 800 }}>
                        خطای غیرمنتظره در اجرای فرانت‌اند ربات
                    </h2>
                    <p style={{ color: '#94A3B8', fontSize: '0.85rem', lineHeight: '1.6', margin: '0.8rem 0 1.5rem' }}>
                        یک خطای سیستمی در بخش رندر یا مدیریت حالت فرانت‌اند رخ داده است. این پنل به صورت خودکار خطا را شناسایی کرده و برای عیب‌یابی نمایش می‌دهد. لطفا کش مرورگر خود را با کلیدهای ترکیبی <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>Ctrl + F5</code> پاک کرده و مجدداً تلاش کنید.
                    </p>
                    <div style={{
                        background: 'rgba(0, 0, 0, 0.5)',
                        padding: '1.2rem',
                        borderRadius: '12px',
                        textAlign: 'left',
                        fontSize: '0.76rem',
                        fontFamily: 'monospace',
                        color: '#EF4444',
                        whiteSpace: 'pre-wrap',
                        overflow: 'auto',
                        maxHeight: '280px',
                        border: '1px solid rgba(239, 68, 68, 0.15)',
                        direction: 'ltr'
                    }}>
                        {globalError}
                    </div>
                    <button
                        onClick={() => {
                            setGlobalError(null);
                            setSelectedTradeId(null);
                            setDebugSnapshot(null);
                            window.location.reload();
                        }}
                        style={{
                            marginTop: '1.5rem',
                            background: 'linear-gradient(to right, #EF4444, #DC2626)',
                            border: 'none',
                            color: '#FFFFFF',
                            padding: '8px 24px',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        بازنشانی و تلاش مجدد
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            background: 'radial-gradient(circle at top left, #0b0f19, #05070c)',
            color: '#F8FAFC',
            height: '100vh',
            maxHeight: '100vh',
            fontFamily: 'Inter, system-ui, sans-serif',
            padding: '0px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Custom blinking animations in style block */}
            <style>{`
                @keyframes blink-red {
                    0% { opacity: 1; color: #EF4444; }
                    50% { opacity: 0.3; color: #F87171; }
                    100% { opacity: 1; color: #EF4444; }
                }
                .blink-active {
                    animation: blink-red 1s infinite;
                }
            `}</style>

            {/* Majestic Top Header Bar */}
            <div style={{
                background: 'rgba(15, 23, 42, 0.6)',
                backdropFilter: 'blur(20px)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '0.45rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxSizing: 'border-box',
                zIndex: 10
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.4rem', filter: 'drop-shadow(0 0 5px #00ffcc)' }}>⚔️</span>
                    <div>
                        <h1 style={{
                            margin: 0,
                            fontSize: '1.1rem',
                            fontWeight: 900,
                            background: 'linear-gradient(to right, #00ffcc, #3B82F6)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            letterSpacing: '-0.5px'
                        }}>
                            TRENCHER V2 ELITE
                        </h1>
                        <span style={{ fontSize: '0.62rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Algorithmic Futures Trading Engine
                        </span>
                    </div>
                </div>

                {/* Glassmorphic Tab Switcher */}
                <div style={{
                    display: 'flex',
                    background: 'rgba(0, 0, 0, 0.4)',
                    padding: '3px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.05)'
                }}>
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        style={{
                            background: activeTab === 'dashboard' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                            border: activeTab === 'dashboard' ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid transparent',
                            color: activeTab === 'dashboard' ? '#FFFFFF' : '#94A3B8',
                            padding: '5px 14px',
                            borderRadius: '8px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        📊 Live Dashboard
                    </button>
                    <button
                        onClick={() => setActiveTab('reviewer')}
                        style={{
                            background: activeTab === 'reviewer' ? 'rgba(0, 255, 204, 0.15)' : 'transparent',
                            border: activeTab === 'reviewer' ? '1px solid rgba(0, 255, 204, 0.3)' : '1px solid transparent',
                            color: activeTab === 'reviewer' ? '#00ffcc' : '#94A3B8',
                            padding: '5px 14px',
                            borderRadius: '8px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        🔍 Signal Diagnostics & Reviewer
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.7rem',
                        background: 'rgba(16, 185, 129, 0.1)',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        color: '#10B981'
                    }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 8px #10B981' }} />
                        ENGINE ONLINE
                    </div>
                </div>
            </div>

            {/* Inner viewport container filling the remaining viewport */}
            <div style={{
                flex: 1,
                padding: '0.45rem',
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box'
            }}>
                {activeTab === 'dashboard' ? (
                    /* Dashboard Mode */
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '3.2fr 1.12fr',
                        gap: '0.45rem',
                        flex: 1,
                        overflow: 'hidden',
                        height: '100%',
                        boxSizing: 'border-box'
                    }}>
                        {/* Left Column - 4 Token Cards & Overall Stats */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.45rem',
                            height: '100%',
                            overflow: 'hidden',
                            justifyContent: 'space-between'
                        }}>
                            
                            {/* 2x2 Grid of Meme Coins cards (Dynamic Sizing) */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '0.45rem',
                                flex: 1,
                                overflow: 'hidden'
                            }}>
                                {symbols.map((symbol: string) => {
                                    const token = tokenStates[symbol];
                                    const currentPrice = currentPrices[symbol];
                                    const active = token.activeTrade;
                                    const activePnLInfo = getUnrealizedPnL(symbol);
                                    const name = symbol.split('/')[0];

                                    return (
                                        <div key={symbol} style={{
                                            background: 'rgba(15, 23, 42, 0.4)',
                                            backdropFilter: 'blur(20px)',
                                            border: active ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)',
                                            borderRadius: '16px',
                                            padding: '0.5rem 0.75rem',
                                            boxShadow: active ? '0 10px 30px -10px rgba(239, 68, 68, 0.2)' : '0 15px 20px -5px rgba(0, 0, 0, 0.3)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            position: 'relative',
                                            overflow: 'hidden',
                                            height: '100%',
                                            boxSizing: 'border-box',
                                            gap: '6px'
                                        }}>
                                            {/* Top colored indicator line for active trade */}
                                            {active && (
                                                <div style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    right: 0,
                                                    height: '4px',
                                                    background: 'linear-gradient(90deg, #EF4444, #F87171, #EF4444)',
                                                    animation: 'blink-red 1.5s infinite'
                                                }} />
                                            )}

                                            {/* Card Header: Symbol & Fixed Real-time Price */}
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <div>
                                                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 750, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        🪙 {name} / USDT
                                                        {active && (
                                                            <span className="blink-active" style={{
                                                                fontSize: '0.65rem',
                                                                color: '#EF4444',
                                                                background: 'rgba(239, 68, 68, 0.1)',
                                                                padding: '1px 6px',
                                                                borderRadius: '6px',
                                                                fontWeight: 600
                                                            }}>
                                                                ● {active.side.toUpperCase()} ({active.leverage}x)
                                                            </span>
                                                        )}
                                                    </h3>
                                                    <span style={{ fontSize: '0.65rem', color: '#64748B' }}>
                                                        {settings.portfolioTokenAllocationUsdt && settings.amiroTradeSizeUsdt ? `${Number((settings.amiroTradeSizeUsdt / settings.portfolioTokenAllocationUsdt).toFixed(2))}` : '0.25'} Size = {settings.amiroTradeSizeUsdt ? settings.amiroTradeSizeUsdt.toFixed(1) : '50.0'} USDT | {active ? `${active.leverage}x Leverage` : 'Dynamic Leverage'}
                                                    </span>
                                                </div>

                                                {/* Real-time Price Display (fixed top right position, denominated in USDT) */}
                                                <div style={{ textAlign: 'right' }}>
                                                    <div className={active ? 'blink-active' : ''} style={{
                                                        fontSize: '1.15rem',
                                                        fontFamily: 'Courier New, monospace',
                                                        fontWeight: 800,
                                                        color: active ? '#EF4444' : '#10B981'
                                                    }}>
                                                        {currentPrice ? currentPrice.toFixed(6) : '0.000000'} USDT
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Terminal-like Token Signals Log (Expanded Height via Flex grow) */}
                                            <div style={{
                                                background: 'rgba(0, 0, 0, 0.4)',
                                                borderRadius: '10px',
                                                padding: '6px 10px',
                                                flex: 1,
                                                minHeight: '100px',
                                                overflowY: 'auto',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '3px',
                                                fontFamily: 'Courier New, monospace',
                                                fontSize: '0.72rem',
                                                border: '1px solid rgba(255, 255, 255, 0.03)'
                                            }}>
                                                {token.logs.length === 0 ? (
                                                    <div style={{ color: '#475569', textAlign: 'center', margin: 'auto' }}>
                                                        [No Signals for {name}/SOL]
                                                    </div>
                                                ) : (
                                                    token.logs.map((log: any, idx: number) => {
                                                        const isBuy = log.type === 'BUY';
                                                        const isSell = log.type === 'SELL';
                                                        const isExit = log.type.includes('EXIT');
                                                        let textColor = '#E2E8F0';
                                                        if (isBuy) textColor = '#10B981';
                                                        if (isSell) textColor = '#EF4444';
                                                        if (isExit) textColor = log.pnl >= 0 ? '#3B82F6' : '#F59E0B';

                                                        return (
                                                            <div key={idx} style={{
                                                                borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
                                                                paddingBottom: '4px',
                                                                color: textColor,
                                                                lineHeight: '1.3'
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                                                                    <span style={{ color: '#64748B', marginRight: '6px', flexShrink: 0 }}>[{log.time}]</span>
                                                                    <span>{log.reason}</span>
                                                                </div>
                                                                {isExit && log.pnl !== null && log.pnl !== undefined && (
                                                                    <div style={{
                                                                        paddingLeft: '5.2rem',
                                                                        fontWeight: '600',
                                                                        fontSize: '0.68rem',
                                                                        opacity: 0.95
                                                                    }}>
                                                                        {log.pnl >= 0 ? '+' : ''}{log.pnl.toFixed(4)} USDT ({log.pnlPct >= 0 ? '+' : ''}{log.pnlPct.toFixed(2)}%) | {log.leverage}x
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>

                                            {/* Token-Specific Performance Stats */}
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(3, 1fr)',
                                                gap: '4px',
                                                background: 'rgba(0, 0, 0, 0.2)',
                                                borderRadius: '10px',
                                                padding: '4px 6px',
                                                fontSize: '0.72rem'
                                            }}>
                                                <div style={{ textAlign: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                    <div style={{ color: '#64748B', fontSize: '0.55rem', textTransform: 'uppercase', marginBottom: '1px' }}>Balance</div>
                                                    <div style={{ fontWeight: 700, color: '#E2E8F0' }}>{token.allocatedBalance.toFixed(2)} USDT</div>
                                                </div>
                                                <div style={{ textAlign: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                    <div style={{ color: '#64748B', fontSize: '0.55rem', textTransform: 'uppercase', marginBottom: '1px' }}>Trades (Win)</div>
                                                    <div style={{ fontWeight: 700, color: '#E2E8F0' }}>{token.stats.totalTrades} ({token.stats.winRate}%)</div>
                                                </div>
                                                <div style={{ textAlign: 'center' }}>
                                                    <div style={{ color: '#64748B', fontSize: '0.55rem', textTransform: 'uppercase', marginBottom: '1px' }}>Net realized</div>
                                                    <div style={{
                                                        fontWeight: 700,
                                                        color: token.stats.pnl >= 0 ? '#10B981' : '#EF4444'
                                                    }}>
                                                        {token.stats.pnl >= 0 ? '+' : ''}{token.stats.pnl.toFixed(2)} USDT
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Token-Specific Win Rate by Risk Level */}
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(3, 1fr)',
                                                gap: '4px',
                                                background: 'rgba(0, 0, 0, 0.2)',
                                                borderRadius: '10px',
                                                padding: '5px 6px',
                                                fontSize: '0.66rem',
                                                borderTop: '1px solid rgba(255, 255, 255, 0.02)'
                                            }}>
                                                {['VERY_LOW', 'LOW', 'MEDIUM'].map((level, idx) => {
                                                    const barColor = level === 'VERY_LOW' ? '#10B981' : level === 'LOW' ? '#3B82F6' : '#F59E0B';
                                                    
                                                    // Find trades matching this token AND this risk level
                                                    const levelTrades = tradeMemory.filter(t => 
                                                        t.context.symbol.split(':')[0] === symbol.split(':')[0] && 
                                                        t.context.riskLevel === level
                                                    );
                                                    const closed = levelTrades.filter(t => t.closed);
                                                    const total = closed.length;
                                                    const wins = closed.filter(t => t.outcome === 'WIN' || t.outcome === 'PARTIAL_WIN').length;
                                                    const wr = total > 0 ? (wins / total * 100) : 0;
                                                    const pnl = closed.reduce((sum, t) => sum + t.finalPnlUsdt, 0);
                                                    
                                                    return (
                                                        <div key={level} style={{
                                                            textAlign: 'center',
                                                            borderRight: idx < 2 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none'
                                                        }}>
                                                            <div style={{ color: barColor, fontSize: '0.52rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '1px' }}>
                                                                {level.replace('_', ' ')}
                                                            </div>
                                                            <div style={{ fontWeight: 600, color: '#E2E8F0' }}>
                                                                {wr.toFixed(0)}% ({total})
                                                            </div>
                                                            <div style={{
                                                                fontSize: '0.58rem',
                                                                color: pnl >= 0 ? '#10B981' : '#EF4444',
                                                                fontWeight: 500
                                                            }}>
                                                                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Live Active Trade Unrealized PnL */}
                                            {active ? (
                                                <div style={{
                                                    background: 'rgba(239, 68, 68, 0.1)',
                                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                                    borderRadius: '10px',
                                                    padding: '4px 8px',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    fontSize: '0.72rem'
                                                }}>
                                                    <span style={{ color: '#EF4444', fontWeight: 600 }}>🔴 Real-Time PnL</span>
                                                    <strong style={{
                                                        color: activePnLInfo.pnl >= 0 ? '#10B981' : '#EF4444',
                                                        fontFamily: 'Courier New, monospace',
                                                        fontSize: '0.8rem'
                                                    }}>
                                                        {activePnLInfo.pnl >= 0 ? '+' : ''}{activePnLInfo.pnl.toFixed(2)} USDT ({activePnLInfo.pnlPercent.toFixed(2)}%)
                                                    </strong>
                                                </div>
                                            ) : (
                                                <div style={{
                                                    height: '24px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    background: 'rgba(255, 255, 255, 0.02)',
                                                    borderRadius: '10px',
                                                    fontSize: '0.65rem',
                                                    color: '#475569',
                                                    border: '1px dashed rgba(255, 255, 255, 0.03)'
                                                }}>
                                                    WAITING FOR BREAKOUT...
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Overall Stats Cards (Super Compact Height) */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(4, 1fr)',
                                gap: '0.45rem',
                                height: '58px'
                            }}>
                                {[
                                    { label: 'Overall Win Rate', value: `${overallStats.winRate}%`, color: '#00ffcc' },
                                    { label: 'Total Trades', value: overallStats.totalTrades, color: '#3B82F6' },
                                    { label: 'Total Balance (USDT)', value: `${overallStats.currentBalance.toFixed(2)} USDT`, color: '#FFFFFF' },
                                    { label: 'Cumulative PnL', value: `${overallStats.totalPnL >= 0 ? '+' : ''}${overallStats.totalPnL.toFixed(2)} USDT`, color: '#10B981' }
                                ].map((stat: any, i: number) => (
                                    <div key={i} style={{
                                        background: 'rgba(15, 23, 42, 0.4)',
                                        border: '1px solid rgba(255, 255, 255, 0.05)',
                                        borderRadius: '12px',
                                        padding: '0.35rem',
                                        textAlign: 'center',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                                    }}>
                                        <span style={{ color: '#64748B', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</span>
                                        <h3 style={{ margin: '1px 0 0', fontSize: '1.1rem', fontWeight: 800, color: stat.color }}>{stat.value}</h3>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right Column - Logs & Dynamic Title Card (No Scroll) */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.45rem',
                            height: '100%',
                            overflow: 'hidden'
                        }}>
                            {/* Win Rate by Risk Level Panel */}
                            <div style={{
                                background: 'rgba(15, 23, 42, 0.4)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '20px',
                                padding: '0.65rem 0.8rem',
                                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.45rem'
                            }}>
                                <h2 style={{ margin: '0', fontSize: '0.88rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: '#FFFFFF' }}>
                                    📊 Win Rate by Risk Level
                                </h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    {riskLevelStats.map(stat => {
                                        const barColor = stat.level === 'VERY_LOW' ? '#10B981' : stat.level === 'LOW' ? '#3B82F6' : '#F59E0B';
                                        const wr = stat.winRate;
                                        return (
                                            <div key={stat.level} style={{ fontSize: '0.74rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontWeight: 600, marginBottom: '2px' }}>
                                                    <span style={{ color: barColor, fontSize: '0.68rem', letterSpacing: '0.5px' }}>{stat.level.replace('_', ' ')}</span>
                                                    <span>
                                                        {wr.toFixed(1)}% ({stat.closedTradesCount} trades) | PnL: <strong style={{ color: stat.pnl >= 0 ? '#10B981' : '#EF4444' }}>{stat.pnl >= 0 ? '+' : ''}{stat.pnl.toFixed(2)} USDT</strong>
                                                    </span>
                                                </div>
                                                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                                    <div style={{ width: `${wr}%`, height: '100%', background: barColor, borderRadius: '3px', transition: 'width 0.5s ease-out' }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Right Side - Real-Time Logs Panel */}
                            <div style={{
                                background: 'rgba(15, 23, 42, 0.4)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '20px',
                                padding: '0.8rem',
                                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden'
                            }}>
                                <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    ⚡ Real-Time Trading Logs
                                </h2>

                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.4rem',
                                    paddingRight: '2px'
                                }}>
                                    {logs.length === 0 ? (
                                        <div style={{ textAlign: 'center', color: '#64748B', padding: '2rem 0', fontSize: '0.8rem' }}>
                                            Waiting for signals or transactions...
                                        </div>
                                    ) : (
                                        logs.map((log: TradeLog, index: number) => (
                                            <div key={index} style={{
                                                background: 'rgba(0, 0, 0, 0.2)',
                                                borderRadius: '10px',
                                                padding: '6px 10px',
                                                borderLeft: `3px solid ${
                                                    log.status === 'APPROVED' ? '#10B981' : 
                                                    log.status === 'REJECT' ? '#EF4444' : '#64748B'
                                                }`,
                                                fontSize: '0.78rem'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B', fontSize: '0.65rem', marginBottom: '2px' }}>
                                                    <span>{log.time}</span>
                                                    <span style={{ fontWeight: 600, color: '#3B82F6' }}>{log.token.split('/')[0]}</span>
                                                </div>
                                                <div style={{ color: '#E2E8F0', fontWeight: 500 }}>{log.reason}</div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Bottom-Right Simulator Context Card */}
                            <div style={{
                                height: '95px',
                                background: 'rgba(15, 23, 42, 0.5)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                borderRadius: '20px',
                                padding: '0.5rem 0.8rem',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                gap: '2px',
                                boxSizing: 'border-box',
                                position: 'relative',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <span style={{ fontSize: '1rem' }}>⚡</span>
                                    <h2 style={{
                                        margin: 0,
                                        fontSize: '0.88rem',
                                        fontWeight: 800,
                                        background: 'linear-gradient(to right, #00ffcc, #3B82F6)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        letterSpacing: '-0.5px'
                                    }}>
                                        TRENCHER V2 SIMULATOR
                                    </h2>
                                </div>
                                <p style={{ margin: 0, color: '#64748B', fontSize: '0.65rem', lineHeight: '1.2' }}>
                                    High-Frequency Tokens Futures Dynamic Leverage Simulator
                                </p>
                                <div style={{
                                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                                    paddingTop: '4px',
                                    marginTop: '2px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '0.65rem'
                                }}>
                                    <span style={{ color: '#475569' }}>Engine: <strong style={{ color: '#10B981' }}>ONLINE</strong></span>
                                    <span style={{ color: '#475569' }}>Protection: <strong style={{ color: '#00ffcc' }}>SOFIA TZ</strong></span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Reviewer Mode (Signal Reviewer & Diagnostics) */
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '320px 1fr',
                        gap: '0.45rem',
                        flex: 1,
                        overflow: 'hidden',
                        height: '100%',
                        boxSizing: 'border-box'
                    }}>
                        {/* Sidebar - Historical Signals List */}
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.4)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: '16px',
                            padding: '0.6rem',
                            boxShadow: '0 15px 25px -5px rgba(0, 0, 0, 0.3)',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            height: '100%'
                        }}>
                            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 700, color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                📁 Historical Signals ({tradeMemory.length})
                            </h3>
                            
                            {/* Scrollable list of trades */}
                            <div style={{
                                flex: 1,
                                overflowY: 'auto',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.4rem',
                                paddingRight: '2px'
                            }}>
                                {tradeMemory.length === 0 ? (
                                    <div style={{ textAlign: 'center', color: '#64748B', fontSize: '0.75rem', padding: '2rem 0' }}>
                                        No historical signals captured yet.
                                    </div>
                                ) : (
                                    // Sort descending: newest first
                                    [...tradeMemory].reverse().map((trade) => {
                                        const isSelected = selectedTradeId === trade.id;
                                        const entryDate = new Date(trade.timestamp * 1000);
                                        const timeStr = entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                        const dateStr = entryDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
                                        const isWin = trade.outcome === 'WIN' || trade.outcome === 'PARTIAL_WIN';
                                        const isLoss = trade.outcome === 'LOSS';
                                        const sideColor = trade.context.side === 'long' ? '#10B981' : '#EF4444';
                                        
                                        let outcomeColor = '#94A3B8';
                                        if (isWin) outcomeColor = '#10B981';
                                        if (isLoss) outcomeColor = '#EF4444';
                                        if (trade.outcome === 'BREAKEVEN') outcomeColor = '#F59E0B';
                                        
                                        return (
                                            <div
                                                key={trade.id}
                                                onClick={() => setSelectedTradeId(trade.id)}
                                                style={{
                                                    background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                                                    border: isSelected ? '1px solid #3B82F6' : '1px solid rgba(255, 255, 255, 0.03)',
                                                    borderRadius: '10px',
                                                    padding: '0.5rem 0.6rem',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '3px'
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <strong style={{ fontSize: '0.8rem', color: '#FFFFFF' }}>
                                                        {trade.context.symbol.split(':')[0]}
                                                    </strong>
                                                    <span style={{
                                                        fontSize: '0.62rem',
                                                        fontWeight: 800,
                                                        background: trade.context.side === 'long' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                                        color: sideColor,
                                                        padding: '1px 6px',
                                                        borderRadius: '5px',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        {trade.context.side}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#64748B' }}>
                                                    <span>{dateStr} {timeStr}</span>
                                                    <span>{trade.context.leverage}x | {trade.context.riskLevel}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', marginTop: '2px' }}>
                                                    <span style={{ color: '#E2E8F0', fontFamily: 'monospace' }}>
                                                        Price: {safeToFixed(trade.context.entryPrice, 6)}
                                                    </span>
                                                    {trade.closed ? (
                                                        <span style={{
                                                            fontWeight: 700,
                                                            color: outcomeColor
                                                        }}>
                                                            {trade.finalPnlUsdt >= 0 ? '+' : ''}{safeToFixed(trade.finalPnlUsdt, 2)} USDT ({trade.outcome})
                                                        </span>
                                                    ) : (
                                                        <span style={{
                                                            fontWeight: 700,
                                                            color: '#3B82F6',
                                                            background: 'rgba(59, 130, 246, 0.1)',
                                                            padding: '1px 5px',
                                                            borderRadius: '4px',
                                                            fontSize: '0.6rem'
                                                        }}>
                                                            ACTIVE
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Main Work Panel - Diagnostics Display */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            height: '100%',
                            gap: '0.45rem'
                        }}>
                            {!selectedTradeId ? (
                                /* Empty state */
                                <div style={{
                                    flex: 1,
                                    background: 'rgba(15, 23, 42, 0.25)',
                                    backdropFilter: 'blur(20px)',
                                    border: '1px solid rgba(255, 255, 255, 0.03)',
                                    borderRadius: '16px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '15px',
                                    color: '#64748B',
                                    padding: '2rem'
                                }}>
                                    <span style={{ fontSize: '3rem', filter: 'drop-shadow(0 0 10px rgba(59, 130, 246, 0.3))' }}>🔍</span>
                                    <h3 style={{ margin: 0, color: '#E2E8F0', fontSize: '1.1rem', fontWeight: 800 }}>
                                        SELECT A SIGNAL TRADE FOR TECHNICAL REVIEW
                                    </h3>
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748B', maxWidth: '400px', textAlign: 'center', lineHeight: '1.4' }}>
                                        Choose any execution signal from the historical panel on the left to review the exact indicator states, price channel calculations, and high-fidelity candlestick histories at the time of entry.
                                    </p>
                                </div>
                            ) : loadingDebug ? (
                                /* Loading state */
                                <div style={{
                                    flex: 1,
                                    background: 'rgba(15, 23, 42, 0.25)',
                                    borderRadius: '16px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '12px',
                                    color: '#64748B'
                                }}>
                                    <div style={{
                                        width: '30px',
                                        height: '30px',
                                        border: '3px solid rgba(255,255,255,0.05)',
                                        borderTopColor: '#00ffcc',
                                        borderRadius: '50%',
                                        animation: 'spin 1s linear infinite'
                                    }} />
                                    <style>{`
                                        @keyframes spin {
                                            0% { transform: rotate(0deg); }
                                            100% { transform: rotate(360deg); }
                                        }
                                    `}</style>
                                    <span style={{ fontSize: '0.82rem', color: '#00ffcc', fontWeight: 600 }}>
                                        Fetching Detailed Diagnostics Payload...
                                    </span>
                                </div>
                            ) : debugError ? (
                                /* Error state */
                                <div style={{
                                    flex: 1,
                                    background: 'rgba(239, 68, 68, 0.05)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: '16px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '2rem'
                                }}>
                                    <span style={{ fontSize: '2.5rem' }}>⚠️</span>
                                    <h3 style={{ margin: 0, color: '#EF4444', fontSize: '0.95rem' }}>Failed to Load Diagnostics</h3>
                                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#F87171' }}>{debugError}</p>
                                </div>
                            ) : !debugSnapshot ? (
                                /* Empty data fallback */
                                <div style={{
                                    flex: 1,
                                    background: 'rgba(15, 23, 42, 0.25)',
                                    borderRadius: '16px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '2rem'
                                }}>
                                    <span style={{ fontSize: '2rem' }}>📊</span>
                                    <h3 style={{ margin: 0, color: '#64748B', fontSize: '0.95rem' }}>داده‌ای یافت نشد</h3>
                                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569' }}>
                                        داده‌های عیب‌یابی برای این معامله ثبت نشده است یا قدیمی است.
                                    </p>
                                </div>
                            ) : (
                                <ErrorBoundary>
                                    <SignalDiagnosticsView
                                        snapshot={debugSnapshot}
                                        tradeMemory={tradeMemory}
                                        reviewerTimeframe={reviewerTimeframe}
                                        setReviewerTimeframe={setReviewerTimeframe}
                                    />
                                </ErrorBoundary>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
