import React, { useEffect, useState } from 'react';
import { getSearchLogs, clearLogs, formatLogTime } from '../services/storageService';
import { SearchLog, DataSource, UserProfile } from '../types';
import { Trash2, Search, Filter, CalendarClock, User, Ban } from 'lucide-react';

interface AdminPageProps {
    currentUser?: UserProfile;
}

const AdminPage: React.FC<AdminPageProps> = ({ currentUser }) => {
  const [logs, setLogs] = useState<SearchLog[]>([]);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    setLogs(getSearchLogs());
  }, [refreshTrigger]);

  const handleClearLogs = () => {
    if (window.confirm('确定要清空所有搜索记录吗？此操作无法撤销。')) {
      clearLogs();
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const filteredLogs = logs.filter(log => 
    log.keyword.toLowerCase().includes(filterKeyword.toLowerCase()) ||
    log.userName.toLowerCase().includes(filterKeyword.toLowerCase())
  );

  // Security Check
  if (currentUser?.role !== 'admin') {
      return (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="bg-red-100 p-4 rounded-full mb-4">
                  <Ban className="w-12 h-12 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">拒绝访问</h2>
              <p className="text-gray-500 mt-2">您没有权限查看此页面。请联系管理员。</p>
          </div>
      );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
            <h1 className="text-3xl font-bold text-gray-900">管理员后台</h1>
            <p className="text-gray-500 mt-2">监控系统使用情况和员工搜索记录。</p>
        </div>
        <div className="flex space-x-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                    <Search className="w-5 h-5" />
                </div>
                <div>
                    <p className="text-xs text-gray-500">总搜索次数</p>
                    <p className="text-xl font-bold text-gray-900">{logs.length}</p>
                </div>
            </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <div className="relative max-w-md w-full">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Filter className="h-4 w-4 text-gray-400" />
                </div>
                <input
                    type="text"
                    placeholder="过滤用户或关键词..."
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    value={filterKeyword}
                    onChange={(e) => setFilterKeyword(e.target.value)}
                />
            </div>
            <button 
                onClick={handleClearLogs}
                className="flex items-center space-x-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
            >
                <Trash2 className="w-4 h-4" />
                <span>清空所有日志</span>
            </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            操作时间
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            用户
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            搜索关键词
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            结果数量
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            数据源
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            使用筛选
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {filteredLogs.length === 0 ? (
                        <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-gray-500 text-sm">
                                暂无搜索记录
                            </td>
                        </tr>
                    ) : (
                        filteredLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 flex items-center space-x-2">
                                    <CalendarClock className="w-4 h-4 text-gray-400" />
                                    <span>{formatLogTime(log.timestamp)}</span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="flex-shrink-0 h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                                            <User className="w-4 h-4 text-blue-600" />
                                        </div>
                                        <div className="ml-4">
                                            <div className="text-sm font-medium text-gray-900">{log.userName}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-900 font-semibold">
                                    {log.keyword}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                                        {log.resultCount} 个广告
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        log.dataSource === DataSource.APIFY 
                                        ? 'bg-green-100 text-green-800' 
                                        : 'bg-blue-100 text-blue-800'
                                    }`}>
                                        {log.dataSource}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {log.filtersUsed ? (
                                        <span className="text-green-600">是</span>
                                    ) : (
                                        <span className="text-gray-400">否</span>
                                    )}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
