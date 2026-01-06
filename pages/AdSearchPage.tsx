
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Search, Filter, Loader2, AlertCircle, Calendar, ChevronDown, ChevronUp, X, Layers, PlayCircle, CheckCircle2, Globe, FileType, Clock, History, Upload, Image, Languages, Settings2, Download, Minus, Plus, Sparkles, Settings, Timer, Zap, BarChart3 } from 'lucide-react';
import { batchTranslateToChinese } from '../services/geminiService';
import { searchAdsWithApifyBatch } from '../services/apifyService';
import { getLocalSearchHistory } from '../services/storageService';
import AdCard from '../components/AdCard';
import { Ad, DataSource, SearchFilters, UserProfile, SearchHistoryItem, SearchPageState, BatchResult } from '../types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants';

interface AdSearchPageProps {
  ads: Ad[];
  keyword: string;
  onUpdateAds: (ads: Ad[]) => void;
  isSearching: boolean;
  onSearch: (keyword: string, filters: SearchFilters, dataSource: DataSource, apifyToken: string) => Promise<void>;
  currentUser: UserProfile;
  state: SearchPageState;
  onUpdateState: (updates: Partial<SearchPageState>) => void;
}

const AdSearchPage: React.FC<AdSearchPageProps> = ({ ads, keyword, onUpdateAds, isSearching, onSearch, currentUser, state, onUpdateState }) => {
  const [dataSource, setDataSource] = useState<DataSource>(DataSource.GEMINI);
  const [apifyToken, setApifyToken] = useState<string>(DEFAULT_SETTINGS.apifyApiToken);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [tokenError, setTokenError] = useState(false);
  const [showFilters, setShowFilters] = useState(false); 
  
  // Fix: Add missing state for translation status
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{ current: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // 渲染优化：累积结果并节流更新 UI
  const pendingAdsRef = useRef<Ad[]>([]);

  useEffect(() => {
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (storedSettings) {
        try {
            const parsed = JSON.parse(storedSettings);
            setDataSource(parsed.dataSource || DataSource.GEMINI);
            if (parsed.apifyApiToken) {
                setApifyToken(parsed.apifyApiToken);
                setTokenError(false);
            } else if (parsed.dataSource === DataSource.APIFY) {
                setTokenError(true);
            }
        } catch (e) {
            console.error("Error reading settings", e);
        }
    }
    setSearchHistory(getLocalSearchHistory());
  }, [isSearching]);

  // 计时器
  useEffect(() => {
    let interval: any;
    if (state.isBatchLoading && startTime) {
        interval = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
    } else {
        clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [state.isBatchLoading, startTime]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) onUpdateState({ batchKeywords: text });
    };
    reader.readAsText(file);
  };

  const parsedKeywords = useMemo(() => {
    return state.batchKeywords
        .split(/[\n,]+/) 
        .map(k => k.trim())
        .filter(k => k.length > 0);
  }, [state.batchKeywords]);

  const targetKeywords = useMemo(() => {
      const startIndex = (state.startGroup - 1) * state.groupSize;
      const count = state.groupSize * state.groupCount;
      return parsedKeywords.slice(startIndex, startIndex + count);
  }, [parsedKeywords, state.groupSize, state.groupCount, state.startGroup]);

  /**
   * 高性能批量处理引擎 (Engine V2)
   * 采用“包中包”策略：并发 $N$ 个请求，每个请求包含 10 个关键词
   */
  const handleBatchSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetKeywords.length === 0) return;
    if (dataSource !== DataSource.APIFY || !apifyToken) {
        alert("请先在设置中配置 Apify Token 并选择 Apify 数据源。");
        return;
    }

    setStartTime(Date.now());
    onUpdateState({ 
        isBatchLoading: true, 
        batchProgress: 0, 
        batchTotal: targetKeywords.length, 
        batchResults: [] 
    });
    
    pendingAdsRef.current = [];
    const KEYWORDS_PER_RUN = 10; // 每个 Actor 任务处理 10 个词，大幅提升速度
    const subBatches = [];
    for (let i = 0; i < targetKeywords.length; i += KEYWORDS_PER_RUN) {
        subBatches.push(targetKeywords.slice(i, i + KEYWORDS_PER_RUN));
    }

    const worker = async (subBatch: string[]) => {
        try {
            const result = await searchAdsWithApifyBatch(apifyToken, subBatch, state.filters);
            
            // 更新进度和局部结果
            const newBatchResults = subBatch.map(k => ({
                keyword: k,
                count: result.keywordMap[k] || 0
            }));

            onUpdateState({ 
                batchResults: [...state.batchResults, ...newBatchResults],
                batchProgress: state.batchProgress + subBatch.length
            });

            pendingAdsRef.current = [...pendingAdsRef.current, ...result.ads];
        } catch (err: any) {
            const errorResults = subBatch.map(k => ({
                keyword: k,
                count: 0,
                error: err.message
            }));
            onUpdateState({ 
                batchResults: [...state.batchResults, ...errorResults],
                batchProgress: state.batchProgress + subBatch.length
            });
            if (err.message === "Invalid Token") throw err;
        }
    };

    try {
        // 使用动态 Promise 池控制并发
        const pool = [];
        const concurrency = state.concurrency;
        
        for (const subBatch of subBatches) {
            const p = worker(subBatch).then(() => {
                pool.splice(pool.indexOf(p), 1);
            });
            pool.push(p);
            if (pool.length >= concurrency) {
                await Promise.race(pool);
            }
        }
        await Promise.all(pool);

        // 最终去重并更新全局状态
        const finalAds = Array.from(new Map(pendingAdsRef.current.map(item => [item.id, item])).values());
        onUpdateAds(finalAds);

    } catch (error: any) {
        console.error("Batch engine fatal error", error);
        alert(`任务中止: ${error.message}`);
    } finally {
        onUpdateState({ isBatchLoading: false });
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}分${s}秒`;
  };

  const handleTranslateAll = async () => {
    if (ads.length === 0) return;
    setIsTranslatingAll(true);
    try {
        const BATCH_SIZE = 100; // 提高单次翻译密度
        setTranslationProgress({ current: 0, total: ads.length });
        let updatedAds = [...ads];
        
        for (let i = 0; i < ads.length; i += BATCH_SIZE) {
            const chunk = ads.slice(i, i + BATCH_SIZE);
            const texts = chunk.map(a => a.adCopy);
            const translated = await batchTranslateToChinese(texts);
            
            for (let j = 0; j < chunk.length; j++) {
                updatedAds[i + j] = { ...updatedAds[i + j], translatedCopy: translated[j] };
            }
            setTranslationProgress({ current: i + chunk.length, total: ads.length });
        }
        onUpdateAds(updatedAds);
    } finally {
        setIsTranslatingAll(false);
    }
  };

  const handleExportCSV = () => {
    if (ads.length === 0) return;
    const headers = ['广告ID', '关键词', '广告主', '广告文案', '行动号召', '平台', '状态', '开始日期', '落地页', '广告库链接', '覆盖人数'];
    const rows = ads.map(ad => [
      ad.id, ad.originalKeyword || '', `"${(ad.advertiserName || '').replace(/"/g, '""')}"`,
      `"${(ad.translatedCopy || ad.adCopy || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`, 
      ad.ctaText, `"${(ad.platform || []).join(', ')}"`, ad.isActive ? '活跃' : '停止', 
      ad.startDate, ad.displayLink || '', ad.adLibraryUrl || '', ad.reach || '未公开'
    ]);
    const csvContent = "\ufeff" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `FB_Ads_Export_${Date.now()}.csv`;
    link.click();
  };

  const NumberControl = ({ label, value, onChange, min, max, icon: Icon }: any) => (
    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center space-x-2 mb-3">
            <Icon className="w-4 h-4 text-blue-500" />
            <label className="text-sm font-semibold text-gray-700">{label}</label>
        </div>
        <div className="flex items-center space-x-2">
            <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="p-2 hover:bg-gray-100 rounded-lg border border-gray-200"><Minus className="w-4 h-4" /></button>
            <input type="number" className="w-full text-center font-bold text-lg border-none focus:ring-0" value={value} onChange={(e) => onChange(parseInt(e.target.value) || min)} />
            <button type="button" onClick={() => onChange(max ? Math.min(max, value + 1) : value + 1)} className="p-2 hover:bg-gray-100 rounded-lg border border-gray-200"><Plus className="w-4 h-4" /></button>
        </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* 标题栏 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                <Zap className="w-8 h-8 text-yellow-500 fill-yellow-500" />
                广告极速搜索引擎
            </h1>
            <p className="text-gray-500 mt-2 font-medium">支持海量关键词并发抓取与 AI 自动化处理</p>
        </div>
        
        <div className="flex items-center bg-white p-1 rounded-xl shadow-sm border border-gray-200">
            <button onClick={() => onUpdateState({ isBatchMode: false })} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${!state.isBatchMode ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}>单次搜索</button>
            <button onClick={() => onUpdateState({ isBatchMode: true })} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${state.isBatchMode ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}>
                <Layers className="w-4 h-4" /> 批量模式
            </button>
        </div>
      </div>

      {/* 搜索控制台 */}
      <div className="max-w-5xl mx-auto mb-12 bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        {!state.isBatchMode ? (
            <div className="p-4 flex items-center gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input type="text" className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 text-lg font-medium" placeholder="输入关键词..." value={state.inputKeyword} onChange={(e) => onUpdateState({ inputKeyword: e.target.value })} />
                </div>
                <button onClick={(e) => onSearch(state.inputKeyword, state.filters, dataSource, apifyToken)} disabled={isSearching} className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-2xl font-bold transition-all disabled:opacity-50">
                    {isSearching ? <Loader2 className="w-6 h-6 animate-spin" /> : '搜索'}
                </button>
            </div>
        ) : (
            <div className="p-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-800">关键词队列</h3>
                            <button onClick={() => fileInputRef.current?.click()} className="text-blue-600 text-sm font-bold hover:underline flex items-center gap-1">
                                <Upload className="w-4 h-4" /> 导入 TXT/CSV
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                        </div>
                        <textarea className="w-full h-48 p-5 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 font-mono text-sm leading-relaxed" placeholder="每行一个关键词，支持数千行..." value={state.batchKeywords} onChange={(e) => onUpdateState({ batchKeywords: e.target.value })} />
                        <div className="flex items-center gap-4 text-xs font-bold text-gray-400">
                            <span className="bg-gray-100 px-3 py-1 rounded-full text-gray-600">共计: {parsedKeywords.length} 词</span>
                            <span className="bg-blue-50 px-3 py-1 rounded-full text-blue-600">待执行: {targetKeywords.length} 词</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                         <h3 className="text-lg font-bold text-gray-800">引擎配置</h3>
                         <div className="grid grid-cols-1 gap-4">
                            <NumberControl label="并发线程 (线程池)" value={state.concurrency} onChange={(v:any) => onUpdateState({ concurrency: v })} min={1} max={50} icon={Zap} />
                            <NumberControl label="单任务处理词数" value={state.groupSize} onChange={(v:any) => onUpdateState({ groupSize: v })} min={1} icon={Layers} />
                            <NumberControl label="执行任务组数" value={state.groupCount} onChange={(v:any) => onUpdateState({ groupCount: v })} min={1} icon={BarChart3} />
                         </div>
                         <button onClick={handleBatchSearch} disabled={state.isBatchLoading || targetKeywords.length === 0} className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg shadow-blue-200 transition-all transform active:scale-95 disabled:opacity-50">
                            {state.isBatchLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : '启动引擎'}
                         </button>
                    </div>
                </div>

                {(state.isBatchLoading || state.batchResults.length > 0) && (
                    <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                                    <Timer className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-gray-400 uppercase">任务进度</p>
                                    <p className="text-xl font-black text-gray-900">{formatTime(elapsedTime)}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-bold text-gray-400 uppercase">吞吐量</p>
                                <p className="text-xl font-black text-blue-600">{(state.batchProgress / Math.max(1, elapsedTime / 60)).toFixed(0)} 词/分</p>
                            </div>
                        </div>
                        
                        <div className="relative h-4 bg-gray-200 rounded-full overflow-hidden mb-6">
                            <div className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-500" style={{ width: `${(state.batchProgress / state.batchTotal) * 100}%` }} />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                            {state.batchResults.slice().reverse().map((res, i) => (
                                <div key={i} className={`p-2 rounded-lg border text-[10px] font-bold truncate transition-all ${res.error ? 'bg-red-50 border-red-100 text-red-600' : 'bg-white border-gray-100 text-gray-600'}`}>
                                    {res.keyword}: {res.error ? '失败' : `${res.count}项`}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

      {/* 结果展示区 */}
      {(ads.length > 0 || isSearching) && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
            <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
                <h2 className="text-2xl font-black text-gray-900">
                    获取成果 <span className="text-blue-600 ml-2">({ads.length})</span>
                </h2>
                <div className="flex items-center gap-3">
                    <button onClick={handleTranslateAll} disabled={isTranslatingAll} className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 transition-all disabled:opacity-50">
                        {isTranslatingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                        一键翻译 {isTranslatingAll && translationProgress && `(${translationProgress.current}/${translationProgress.total})`}
                    </button>
                    <button onClick={handleExportCSV} className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-black transition-all">
                        <Download className="w-4 h-4" /> 导出成果
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {ads.map((ad, index) => (
                    <AdCard key={`${ad.id}-${index}`} ad={ad} />
                ))}
            </div>
        </div>
      )}
    </div>
  );
};

export default AdSearchPage;
