import React from 'react';
import { MessageSquare, BarChart2, Search, Settings, ShieldCheck, Database, UserCircle2, LogOut } from 'lucide-react';
import { UserProfile } from '../types';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentUser: UserProfile;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, currentUser, onLogout }) => {
  const isAdmin = currentUser.role === 'admin';

  const navItems = [
    { id: 'search', label: '广告搜索', icon: Search },
    { id: 'chat', label: 'AI 助手', icon: MessageSquare },
    { id: 'analytics', label: '数据分析', icon: BarChart2 },
  ];

  // Only add Admin nav item if user is admin
  if (isAdmin) {
    navItems.push({ id: 'admin', label: '管理员后台', icon: Database });
  }

  return (
    <div className="w-64 bg-white h-screen border-r border-gray-200 flex flex-col fixed left-0 top-0 z-20 hidden md:flex">
      <div className="p-6 flex items-center space-x-2 border-b border-gray-100">
        <div className="bg-blue-600 p-2 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <span className="text-xl font-bold text-gray-800 tracking-tight">Ads Insight</span>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 px-2">菜单</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
              activeTab === item.id
                ? 'bg-blue-50 text-blue-600 font-medium'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* User Profile Section */}
      <div className="p-4 mx-4 mb-2 bg-gray-50 rounded-xl border border-gray-100">
        <div className="flex flex-col space-y-3">
            <div className="flex items-center space-x-3">
                <UserCircle2 className={`w-8 h-8 ${isAdmin ? 'text-purple-600' : 'text-blue-600'}`} />
                <div className="overflow-hidden">
                    <p className="text-sm font-bold text-gray-800 truncate">{currentUser.name}</p>
                    <p className="text-xs text-gray-500 capitalize truncate">
                        {isAdmin ? '管理员' : '普通用户'}
                    </p>
                </div>
            </div>
            
            <button 
                onClick={onLogout}
                className="w-full flex items-center justify-center space-x-1 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
            >
                <LogOut className="w-3 h-3" />
                <span>退出登录</span>
            </button>
        </div>
      </div>

      <div className="p-4 border-t border-gray-100">
        <button 
          onClick={() => onTabChange('settings')}
          className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
            activeTab === 'settings'
              ? 'bg-blue-50 text-blue-600 font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span>系统设置</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
