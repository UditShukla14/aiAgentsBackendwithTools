import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Server, AlertCircle, CheckCircle, Loader2, MessageSquare, Settings, Wifi, WifiOff } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend } from 'chart.js';
import React from 'react';

// Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend);

// Configuration
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';
const DEFAULT_MCP_SERVER_PATH = import.meta.env.VITE_DEFAULT_MCP_SERVER_PATH || '../mcp-server/mcp-server.ts';

// Type definitions
interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  toolUsed?: string | null;
  timestamp: string;
}

interface Tool {
  name: string;
  description: string;
}

// ChartData type
type ChartData = {
  chartType: string;
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    [key: string]: string | string[] | number | number[] | undefined;
  }>;
  summary?: string;
  title?: string;
};

type MultiChartData = {
  charts: ChartData[];
  summary?: string | Record<string, unknown>;
};

function tryParseMultiChartData(content: string | Record<string, unknown>): MultiChartData | null {
  try {
    // Debug log
    console.log('tryParseMultiChartData input:', content);
    let data: Record<string, unknown>;
    if (typeof content === 'string') {
      // Strip [DISPLAY_VERBATIM] anywhere in the string
      const clean = content.includes('[DISPLAY_VERBATIM]')
        ? content.replace('[DISPLAY_VERBATIM]', '').trim()
        : content;
      console.log('tryParseMultiChartData clean:', clean);
      data = JSON.parse(clean);
    } else if (typeof content === 'object' && content !== null) {
      data = content;
    } else {
      return null;
    }
    console.log('tryParseMultiChartData parsed:', data);
    if (typeof data === 'object' && data !== null) {
      const charts: ChartData[] = [];
      let summary: string | Record<string, unknown> | undefined = undefined;
      for (const key of Object.keys(data)) {
        const value = data[key];
        if (
          typeof value === 'object' &&
          value !== null &&
          'chartType' in value &&
          Array.isArray((value as { labels?: unknown }).labels) &&
          Array.isArray((value as { datasets?: unknown }).datasets)
        ) {
          charts.push(value as ChartData);
        } else if (key === 'summary' || key === 'claude_summary') {
          summary = value as string | Record<string, unknown>;
        }
      }
      if (charts.length > 0) {
        return { charts, summary };
      }
    }
  } catch (e) {
    console.log('tryParseMultiChartData error:', e);
  }
  return null;
}

// Utility to deep-freeze an object (including nested objects/arrays)
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach((prop) => {
      // @ts-expect-error: Accessing dynamic object properties for deep freezing
      if (obj[prop] && typeof obj[prop] === 'object') {
        // @ts-expect-error: Accessing dynamic object properties for deep freezing
        deepFreeze(obj[prop]);
      }
    });
  }
  return obj;
}

// Chart rendering component
const ChartMessage = React.memo(({ chartData }: { chartData: ChartData }) => {
  const { chartType, labels, datasets, summary } = chartData;

  // Memoize data and options so they are stable unless chartData changes
  const data = React.useMemo(() => ({
    labels,
    datasets
  }), [labels, datasets]);

  // Only animate on first mount
  const hasAnimated = React.useRef(false);
  const options = React.useMemo(() => ({
    animation: !hasAnimated.current,
    plugins: {
      legend: { display: true }
    }
  }), []);

  React.useEffect(() => {
    hasAnimated.current = true;
  }, []);

  let ChartComponent: React.ElementType | null = null;
  switch (chartType.toLowerCase()) {
    case 'bar':
      ChartComponent = Bar;
      break;
    case 'line':
      ChartComponent = Line;
      break;
    case 'pie':
      ChartComponent = Pie;
      break;
    case 'doughnut':
      ChartComponent = Doughnut;
      break;
    default:
      return <div>Unsupported chart type: {chartType}</div>;
  }

  return (
    <div className="my-4">
      <ChartComponent data={data} options={options} />
      {summary && <div className="mt-2 text-gray-700">{summary}</div>}
    </div>
  );
});

const MCPClientUI = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [availableTools, setAvailableTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [serverPath] = useState(DEFAULT_MCP_SERVER_PATH);
  const [socketConnected, setSocketConnected] = useState(false);
  const [hasShownWelcome, setHasShownWelcome] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState<{
    currentRequests: number;
    maxRequests: number;
    timeWindow: number;
    queueLength: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const addMessage = useCallback((role: Message['role'], content: string, toolUsed: string | null = null) => {
    const newMessage: Message = {
      id: Date.now() + Math.random(),
      role,
      content,
      toolUsed,
      timestamp: new Date().toLocaleTimeString()
    };
    setMessages(prev => [...prev, deepFreeze(newMessage)]);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch rate limit status periodically
  useEffect(() => {
    const fetchRateLimitStatus = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/rate-limit-status`);
        if (response.ok) {
          const data = await response.json();
          setRateLimitStatus(data.rateLimit);
        }
      } catch (error) {
        console.log('Could not fetch rate limit status:', error);
      }
    };

    // Fetch immediately and then every 10 seconds
    fetchRateLimitStatus();
    const interval = setInterval(fetchRateLimitStatus, 10000);

    return () => clearInterval(interval);
  }, []);

  // Initialize WebSocket connection and auto-connect to MCP server
  useEffect(() => {
    const socket = io(BACKEND_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to backend');
      setSocketConnected(true);
      // Auto-connect to MCP server when backend connects
      connectToServer(serverPath);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from backend');
      setSocketConnected(false);
      setIsConnected(false);
      setAvailableTools([]);
    });

    socket.on('connection_status', (status) => {
      setIsConnected(status.isConnected);
      setAvailableTools(status.tools || []);
      // Don't show system messages for connection status
    });

    socket.on('connection_progress', (data) => {
      // Only show progress messages that are important
      console.log('Connection progress:', data.message);
    });

    socket.on('connection_success', (data) => {
      setIsConnected(true);
      setAvailableTools(data.tools || []);
      setIsLoading(false);
      // Show welcome message only once when tools are available
      if (!hasShownWelcome) {
        addMessage('system', `🎉 Connected! Available tools: ${data.tools?.map((t: Tool) => t.name).join(', ') || 'none'}`);
        setHasShownWelcome(true);
      }
    });

    socket.on('connection_error', (data) => {
      setIsConnected(false);
      setIsLoading(false);
      addMessage('error', `Connection failed: ${data.message}`);
    });

    socket.on('query_progress', (data) => {
      // Optional: Show processing status
      console.log('Query progress:', data);
    });

    socket.on('query_response', (data) => {
      const toolsUsedText = data.toolsUsed && data.toolsUsed.length > 0 
        ? data.toolsUsed.map((tool: { name: string }) => tool.name).join(', ')
        : null;
      // Debug: log the content array from backend
      console.log('query_response content from backend:', data.content);
      // Support multiple messages if data.content is an array
      if (Array.isArray(data.content)) {
        data.content.forEach((item: { type: string; text: string }) => {
          // Add all items as separate messages, regardless of type
          addMessage('assistant', item.text, toolsUsedText);
        });
      } else if (typeof data.response === 'string') {
        // Fallback for old format
        addMessage('assistant', data.response, toolsUsedText);
      }
      setIsLoading(false);
    });

    socket.on('query_error', (data) => {
      let errorMessage = data.message;
      
      // Handle specific API errors
      if (data.message.includes('529') || data.message.includes('Overloaded')) {
        errorMessage = '🚫 Claude API is currently overloaded. Please wait a moment and try again. This usually resolves within a few minutes.';
      } else if (data.message.includes('rate limit')) {
        errorMessage = '⏱️ Rate limit exceeded. Please wait a moment before sending another message.';
      } else if (data.message.includes('timeout')) {
        errorMessage = '⏰ Request timed out. Please try again.';
      }
      
      addMessage('error', errorMessage);
      setIsLoading(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [addMessage, serverPath, hasShownWelcome]);

  const connectToServer = async (serverScriptPath: string) => {
    if (!socketRef.current) {
      addMessage('error', 'Not connected to backend service');
      return;
    }

    setIsLoading(true);
    socketRef.current.emit('connect_server', { serverPath: serverScriptPath });
  };

  // Streaming query handler
  const processQueryStream = async (query: string) => {
    if (!socketConnected) {
      addMessage('error', 'Not connected to backend service');
      return;
    }
    if (!isConnected) {
      addMessage('error', 'MCP server not connected. Please connect to a server first.');
      return;
    }
    setIsLoading(true);
    const messageId = Date.now();
    addMessage('user', query);

    let accumulated = '';
    const toolsUsed: string[] = [];

    socketRef.current?.emit('process_query_stream', { query, messageId });

    const onStream = (data: any) => {
      // Log all incoming data for debugging
      console.log('Received query_stream data:', data);
      // Only handle 'complete' chunks for chat rendering
      if (data.chunk?.type === 'complete') {
        addMessage('assistant', data.chunk.response, toolsUsed.join(', '));
        setIsLoading(false);
        socketRef.current?.off('query_stream', onStream);
      }
      // Ignore 'tool_result' and other chunk types for chat display
      if (data.chunk?.type === 'error') {
        addMessage('error', data.chunk.message || 'Error during streaming');
        setIsLoading(false);
        socketRef.current?.off('query_stream', onStream);
      }
    };

    socketRef.current?.on('query_stream', onStream);
  };

  // Replace processQuery with processQueryStream in handleSubmit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    processQueryStream(inputValue);
    setInputValue('');
  };

  const MessageBubble = React.memo(({ message }: { message: Message }) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    const isError = message.role === 'error';

    // Try to parse multi-chart data robustly
    let parsedContent: unknown = message.content;
    if (
      !isUser && !isSystem && !isError &&
      typeof message.content === 'string' &&
      message.content.trim().startsWith('{')
    ) {
      try {
        parsedContent = JSON.parse(message.content.trim());
      } catch {
        // leave as string if parsing fails
      }
    }
    let multiChartData: MultiChartData | null = null;
    if (!isUser && !isSystem && !isError) {
      if (
        typeof parsedContent === 'string' ||
        (typeof parsedContent === 'object' && parsedContent !== null && !Array.isArray(parsedContent))
      ) {
        multiChartData = tryParseMultiChartData(parsedContent as string | Record<string, unknown>);
      } else {
        multiChartData = null;
      }
    }
    console.log('MessageBubble content:', message.content);

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser 
            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg' 
            : isError 
            ? 'bg-red-50 text-red-800 border border-red-200'
            : isSystem 
            ? 'bg-gray-50 text-gray-700 border border-gray-200'
            : 'bg-white text-gray-800 border border-gray-100 shadow-md'
        }`}>
          {!isUser && !isSystem && !isError && (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
                <MessageSquare className="w-3 h-3 text-white" />
              </div>
              <span className="text-sm font-medium text-gray-600">Claude</span>
              {message.toolUsed && (
                <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-full">
                  <Settings className="w-3 h-3 text-blue-600" />
                  <span className="text-xs text-blue-600 font-medium">{message.toolUsed}</span>
                </div>
              )}
            </div>
          )}
          
          {isSystem && (
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium">System</span>
            </div>
          )}
          
          {isError && (
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium">Error</span>
            </div>
          )}
          
          {multiChartData ? (
            <div>
              <div className="flex flex-row flex-wrap gap-6">
                {multiChartData.charts.map((chart, idx) => (
                  <div key={idx} className="mb-4 bg-white rounded-xl shadow border p-4 min-w-[300px] max-w-[400px] flex-1">
                    {chart.title && <div className="font-semibold mb-2 text-center">{chart.title}</div>}
                    <ChartMessage chartData={chart} />
                  </div>
                ))}
              </div>
              {multiChartData.summary && (
                typeof multiChartData.summary === 'string' ? (
                  <div className="mt-4 text-gray-700 whitespace-pre-wrap">
                    <strong>Summary:</strong>
                    <div className="bg-gray-50 rounded p-2 mt-1">{multiChartData.summary}</div>
                  </div>
                ) : (
                  <div className="mt-4 text-gray-700 whitespace-pre-wrap">
                    <strong>Summary:</strong>
                    <pre className="bg-gray-50 rounded p-2 mt-1">{JSON.stringify(multiChartData.summary, null, 2)}</pre>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
          )}
          <div className="text-xs opacity-60 mt-2">{message.timestamp}</div>
        </div>
      </div>
    );
  });

  // Memoized message list
  const MessageList = React.memo(({ messages }: { messages: Message[] }) => (
    <>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </>
  ));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="container mx-auto max-w-5xl h-screen flex flex-col">
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-sm shadow-lg border-b border-gray-200/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                <Server className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                  MCP Client
                </h1>
                <p className="text-sm text-gray-500">Model Context Protocol Interface</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                socketConnected 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-red-100 text-red-800'
              }`}>
                {socketConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                Backend {socketConnected ? 'Connected' : 'Disconnected'}
              </div>
              
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                isConnected 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-orange-100 text-orange-800'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : 'bg-orange-500'
                }`} />
                MCP {isConnected ? 'Connected' : 'Disconnected'}
              </div>
              
              {availableTools.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  <Settings className="w-4 h-4" />
                  {availableTools.length} tools
                </div>
              )}
              
              {rateLimitStatus && (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  rateLimitStatus.currentRequests > rateLimitStatus.maxRequests * 0.8
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    rateLimitStatus.currentRequests > rateLimitStatus.maxRequests * 0.8
                      ? 'bg-orange-500'
                      : 'bg-green-500'
                  }`} />
                  API: {rateLimitStatus.currentRequests}/{rateLimitStatus.maxRequests}
                  {rateLimitStatus.queueLength > 0 && (
                    <span className="text-xs">(+{rateLimitStatus.queueLength} queued)</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.filter(m => m.role === 'user').length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="w-20 h-20 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mb-6">
                <MessageSquare className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-gray-700">Welcome to MCP Client</h3>
              <p className="text-center max-w-md text-gray-500 mb-6">
                {isConnected 
                  ? "Start chatting! I can help you with weather information, calculations, text analysis and more using the connected MCP tools."
                  : "Connecting to MCP server automatically..."}
              </p>
              {isConnected && availableTools.length > 0 && (
                <div className="mt-4 p-6 bg-white/60 backdrop-blur-sm rounded-2xl border border-blue-200/50 max-w-xxl">
                  <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Available Tools:
                  </h4>
                  <div className="space-y-2">
                    {availableTools.map((tool, index) => (
                      <div key={index} className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-blue-800">{tool.name}</span>
                          <p className="text-blue-600 mt-1">{tool.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <MessageList messages={messages} />
              {isLoading && (
                <div className="flex justify-start mb-4">
                  <div className="bg-white/80 backdrop-blur-sm border border-gray-200/50 rounded-2xl px-6 py-4 shadow-lg">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                      <span className="text-gray-600 font-medium">Claude is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        {isConnected && (
          <div className="bg-white/60 backdrop-blur-sm border-t border-gray-200/50 px-6 py-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Ask me anything! Try weather alerts, calculations, text analysis..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit(e)}
                className="flex-1 px-5 py-4 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 bg-white/70 backdrop-blur-sm text-gray-800 placeholder-gray-500"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading || !inputValue.trim()}
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium shadow-lg transition-all duration-200"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MCPClientUI;