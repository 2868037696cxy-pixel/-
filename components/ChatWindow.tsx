import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, BrainCircuit, RefreshCw } from 'lucide-react';
import { createChatSession, sendMessageStream } from '../services/geminiService';
import { Message } from '../types';
import ReactMarkdown from 'react-markdown';
import { GenerateContentResponse, Content } from '@google/genai';

const ChatWindow: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'model',
      content: "你好！我是你的 AI 广告顾问。我可以帮你分析市场趋势、撰写广告文案，或解释为什么某些广告表现良好。请问今天有什么可以帮你的？",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useThinking, setUseThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatSessionRef = useRef<any>(null);
  const messagesRef = useRef<Message[]>(messages);

  // Keep ref in sync with state for access in effect
  useEffect(() => {
    messagesRef.current = messages;
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Initialize or Re-initialize chat session when thinking mode changes
  useEffect(() => {
    const history: Content[] = messagesRef.current
      .filter(m => m.content && m.content.trim() !== '' && !m.isThinking) // Basic filtering
      .map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

    chatSessionRef.current = createChatSession(useThinking, history);
  }, [useThinking]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
        if (!chatSessionRef.current) {
            chatSessionRef.current = createChatSession(useThinking);
        }

        const streamResult = await sendMessageStream(chatSessionRef.current, userMessage.content);
        
        const botMessageId = (Date.now() + 1).toString();
        let fullContent = '';
        
        // Add placeholder bot message
        setMessages(prev => [...prev, {
            id: botMessageId,
            role: 'model',
            content: '',
            timestamp: new Date(),
            isThinking: useThinking
        }]);

        for await (const chunk of streamResult) {
            const c = chunk as GenerateContentResponse;
            const text = c.text;
            if (text) {
                fullContent += text;
                setMessages(prev => prev.map(msg => 
                    msg.id === botMessageId 
                    ? { ...msg, content: fullContent }
                    : msg
                ));
            }
        }
    } catch (error) {
        console.error("Chat error:", error);
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            content: "处理你的请求时遇到了错误。请重试。",
            timestamp: new Date()
        }]);
    } finally {
        setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${useThinking ? 'bg-purple-100' : 'bg-blue-100'}`}>
            {useThinking ? <BrainCircuit className="w-5 h-5 text-purple-600" /> : <Bot className="w-5 h-5 text-blue-600" />}
          </div>
          <div>
            <h2 className="font-semibold text-gray-800">
                {useThinking ? '深度推理 AI' : '营销助手'}
            </h2>
            <p className="text-xs text-gray-500">
                {useThinking ? 'Gemini 3.0 Pro • 高智力模式' : 'Gemini 3.0 Pro • 标准模式'}
            </p>
          </div>
        </div>
        
        {/* Thinking Toggle */}
        <div className="flex items-center bg-gray-100 p-1 rounded-lg">
            <button 
                onClick={() => setUseThinking(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${!useThinking ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                快速
            </button>
            <button 
                onClick={() => setUseThinking(true)}
                className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${useThinking ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                <Sparkles className="w-3 h-3" />
                <span>深度思考</span>
            </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gray-50/50 custom-scrollbar">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex max-w-[85%] md:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'} space-x-3`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 ${
                    msg.role === 'user' ? 'bg-gray-800' : (msg.isThinking ? 'bg-purple-600' : 'bg-blue-600')
                }`}>
                    {msg.role === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
                </div>

                {/* Bubble */}
                <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed ${
                        msg.role === 'user' 
                        ? 'bg-gray-900 text-white rounded-tr-none' 
                        : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                    }`}>
                        {msg.role === 'model' ? (
                            <div className="prose prose-sm max-w-none">
                                <ReactMarkdown 
                                    components={{
                                        p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
                                        ul: ({node, ...props}) => <ul className="list-disc ml-4 mb-2" {...props} />,
                                        ol: ({node, ...props}) => <ol className="list-decimal ml-4 mb-2" {...props} />,
                                        li: ({node, ...props}) => <li className="mb-1" {...props} />,
                                        strong: ({node, ...props}) => <strong className="font-semibold" {...props} />,
                                    }}
                                >
                                    {msg.content}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            msg.content
                        )}
                        {msg.role === 'model' && msg.content === '' && (
                            <div className="flex space-x-1 items-center h-6">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75"></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></div>
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] text-gray-400 mt-1 px-1">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {msg.isThinking && msg.role === 'model' && ' • 深度思考中'}
                    </span>
                </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-100">
        <div className="relative flex items-end bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
            <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={useThinking ? "询问需要深度分析的复杂问题..." : "输入你的消息..."}
                className="w-full bg-transparent border-none focus:ring-0 p-3 max-h-32 min-h-[50px] resize-none text-sm text-gray-800 placeholder-gray-400"
                rows={1}
            />
            <div className="p-2">
                <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim()}
                    className={`p-2 rounded-lg transition-all ${
                        isLoading || !input.trim()
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : (useThinking ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-md' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md')
                    }`}
                >
                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
            </div>
        </div>
        <p className="text-center text-[10px] text-gray-400 mt-2">
            AI 可能会犯错。请核实重要信息。
        </p>
      </div>
    </div>
  );
};

export default ChatWindow;