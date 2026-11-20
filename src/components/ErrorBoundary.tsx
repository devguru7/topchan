import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { STORAGE_KEY } from '../data/seed';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Непредвиденная ошибка интерфейса',
    };
  }

  handleHardReset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#121826] border border-white/[0.08] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#F43F5E]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold text-white">Сбой рендера Topchan Ops</h1>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Защитный контур перехватил ошибку. Вы можете перезагрузить экран или сбросить
              локальное хранилище до демо-данных.
            </p>
            <div className="bg-[#0B0F17] border border-white/[0.08] rounded-lg p-3 font-mono text-xs text-rose-300 break-words">
              {this.state.message}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-sm font-medium text-white border border-white/[0.08] transition-colors"
              >
                Перезагрузить
              </button>
              <button
                type="button"
                onClick={this.handleHardReset}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#F43F5E] hover:bg-rose-600 text-sm font-medium text-white transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Сбросить данные
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
