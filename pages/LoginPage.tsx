
import React, { useState } from 'react';
import { login, register } from '../services/authService';
import { ShieldCheck, Lock, User, LogIn, AlertCircle, UserPlus, BadgeCheck } from 'lucide-react';
import { UserProfile } from '../types';

interface LoginPageProps {
  onLoginSuccess: (user: UserProfile) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  
  // Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    setTimeout(() => {
      if (isLoginMode) {
        // Login Logic
        const user = login(username, password);
        if (user) {
          onLoginSuccess(user);
        } else {
          setError('账号或密码错误。');
          setLoading(false);
        }
      } else {
        // Registration Logic
        if (!username || !password || !nickname) {
            setError('请填写所有字段。');
            setLoading(false);
            return;
        }
        
        const success = register({
            username,
            password,
            name: nickname,
            role: 'user' // Default to normal user
        });

        if (success) {
            setSuccessMsg('注册成功！正在进入系统...');
            setTimeout(() => {
                // Construct profile locally since register auto-logs in
                onLoginSuccess({ name: nickname, role: 'user' });
            }, 1000);
        } else {
            setError('该账号已被注册，请更换账号。');
            setLoading(false);
        }
      }
    }, 600);
  };

  const toggleMode = () => {
      setIsLoginMode(!isLoginMode);
      setError('');
      setSuccessMsg('');
      setUsername('');
      setPassword('');
      setNickname('');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
            <div className="bg-blue-600 p-3 rounded-xl shadow-lg">
                <ShieldCheck className="w-10 h-10 text-white" />
            </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          FB Ads Insight Pro
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {isLoginMode ? '请登录以访问系统' : '创建一个新账号'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            
            {/* Registration specific: Nickname */}
            {!isLoginMode && (
                <div className="animate-in fade-in slide-in-from-top-2">
                    <label htmlFor="nickname" className="block text-sm font-medium text-gray-700">
                        昵称 / 姓名
                    </label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <BadgeCheck className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            id="nickname"
                            name="nickname"
                            type="text"
                            required={!isLoginMode}
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            placeholder="例如：运营专员A"
                        />
                    </div>
                </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                账号
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder={isLoginMode ? "输入账号" : "设置账号"}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                密码
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder={isLoginMode ? "输入密码" : "设置密码"}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <AlertCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">{error}</h3>
                  </div>
                </div>
              </div>
            )}

            {successMsg && (
                <div className="rounded-md bg-green-50 p-4">
                    <div className="flex">
                    <div className="flex-shrink-0">
                        <BadgeCheck className="h-5 w-5 text-green-400" aria-hidden="true" />
                    </div>
                    <div className="ml-3">
                        <h3 className="text-sm font-medium text-green-800">{successMsg}</h3>
                    </div>
                    </div>
                </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                    loading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                }`}
              >
                {loading ? (isLoginMode ? '正在登录...' : '注册中...') : (
                    <span className="flex items-center">
                        {isLoginMode ? <LogIn className="w-4 h-4 mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                        {isLoginMode ? '立即登录' : '注册并登录'}
                    </span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">
                  {isLoginMode ? '没有账号？' : '已有账号？'}
                </span>
              </div>
            </div>

            <div className="mt-6">
                <button
                    onClick={toggleMode}
                    className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                    {isLoginMode ? '创建一个新账号' : '返回登录'}
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
