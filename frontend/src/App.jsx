import React, { useState } from 'react';

export default function App() {
  const [hype, setHype] = useState(75);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
          🚀 Ready for Day 1
        </div>
        
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
          SpeakQuest
        </h1>
        
        <p className="text-sm text-slate-400 leading-relaxed">
          AI Presentation Rehearsal & Q&A Simulator for Student Teams
        </p>

        {/* Hype Meter Preview */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 text-left space-y-3">
          <div className="flex justify-between items-center text-xs font-medium text-slate-400">
            <span>🔥 Audience Hype Meter</span>
            <span className="text-emerald-400 font-bold">{hype}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-full rounded-full transition-all duration-300"
              style={{ width: `${hype}%` }}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => setHype(prev => Math.min(100, prev + 10))}
            className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition cursor-pointer"
          >
            + พูดดี (Hype Up)
          </button>
          <button 
            onClick={() => setHype(prev => Math.max(0, prev - 10))}
            className="flex-1 py-2 px-3 bg-rose-600/80 hover:bg-rose-500 text-white rounded-lg text-sm font-medium transition cursor-pointer"
          >
            - หลุด เอ่อ/อ่า
          </button>
        </div>

        <div className="pt-4 border-t border-slate-800/60 text-xs text-slate-500 flex justify-between">
          <span>Frontend: React + Tailwind</span>
          <span>Backend: NestJS</span>
        </div>
      </div>
    </div>
  );
}
