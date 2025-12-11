import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Ad } from '../types';
import { Search } from 'lucide-react';

interface AnalyticsPageProps {
  ads: Ad[];
  keyword: string;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ ads, keyword }) => {
  
  // 1. Calculate Platform Coverage (覆盖率)
  const platformData = useMemo(() => {
    const platforms: Record<string, number> = {};
    ads.forEach(ad => {
      ad.platform.forEach(p => {
        platforms[p] = (platforms[p] || 0) + 1;
      });
    });

    return Object.keys(platforms).map(key => ({
      name: key,
      value: platforms[key]
    })).sort((a, b) => b.value - a.value);
  }, [ads]);

  // 2. Calculate Advertiser/Product Frequency (频率)
  const advertiserData = useMemo(() => {
    const counts: Record<string, number> = {};
    ads.forEach(ad => {
        counts[ad.advertiserName] = (counts[ad.advertiserName] || 0) + 1;
    });
    
    return Object.keys(counts).map(key => ({
        name: key,
        count: counts[key]
    })).sort((a, b) => b.count - a.count).slice(0, 10); // Top 10
  }, [ads]);

  // 3. Keyword mention calculation (Mocking relevance score based on keyword presence)
  const relevanceData = useMemo(() => {
    if (!keyword) return [];
    let high = 0;
    let medium = 0;
    let low = 0;

    ads.forEach(ad => {
       const text = (ad.adCopy + ad.advertiserName).toLowerCase();
       const k = keyword.toLowerCase();
       const occurrences = text.split(k).length - 1;
       
       if (occurrences >= 2) high++;
       else if (occurrences === 1) medium++;
       else low++;
    });

    return [
        { name: '高频提及', value: high },
        { name: '一般提及', value: medium },
        { name: '低频相关', value: low }
    ].filter(d => d.value > 0);
  }, [ads, keyword]);


  if (!ads || ads.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-center p-8">
            <div className="bg-blue-50 p-6 rounded-full mb-6">
                <Search className="w-12 h-12 text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">暂无分析数据</h2>
            <p className="text-gray-500 max-w-md">
                请先在“广告搜索”页面输入关键词并搜索。系统将自动生成关于关键词出现频率和平台覆盖率的详细分析报告。
            </p>
        </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-end justify-between border-b border-gray-100 pb-4">
        <div>
            <h1 className="text-3xl font-bold text-gray-900">搜索分析报告</h1>
            <p className="text-gray-500 mt-2">
                关键词: <span className="font-semibold text-blue-600">{keyword}</span> • 样本量: {ads.length} 个广告
            </p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Platform Coverage (覆盖率) */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="mb-6">
             <h3 className="text-lg font-semibold text-gray-800">平台覆盖率分布</h3>
             <p className="text-xs text-gray-500">分析广告在 Facebook 生态系统各平台的投放比例</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={platformData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Advertiser Frequency (产品/广告主频率) */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="mb-6">
             <h3 className="text-lg font-semibold text-gray-800">产品/广告主出现频率</h3>
             <p className="text-xs text-gray-500">当前搜索结果中出现频率最高的广告主Top 10</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={advertiserData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
                <Tooltip 
                    cursor={{fill: 'transparent'}}
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} 
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Keyword Relevance (内容频率) */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm lg:col-span-2">
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-800">关键词内容相关度分析</h3>
                <p className="text-xs text-gray-500">广告文案中包含目标关键词的频率强度</p>
            </div>
            <div className="h-64">
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={relevanceData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} />
                        <YAxis axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} />
                        <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={60}>
                             {relevanceData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.name === '高频提及' ? '#10b981' : entry.name === '一般提及' ? '#3b82f6' : '#9ca3af'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;