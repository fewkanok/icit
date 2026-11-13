import { useState } from 'react';
import Header from './components/Header';
import ModeStep from './components/ModeStep';
import UploadStep from './components/UploadStep';
import RehearsalStep from './components/RehearsalStep';
import QaStep from './components/QaStep';
import SummaryStep from './components/SummaryStep';
import RemotePage from './components/RemotePage';
import { analyze } from './lib/metrics';

export default function App() {
  const remoteCode =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('remote')
      : null;

  const [step, setStep] = useState('mode');
  const [deck, setDeck] = useState(null); // { name, slides }
  const [rehearsalMode, setRehearsalMode] = useState('per_slide'); // per_slide | continuous
  const [audience, setAudience] = useState('general');
  const [timeBudget, setTimeBudget] = useState({ presentMinutes: 5, qaMinutes: 5 });
  const [results, setResults] = useState({}); // { [slideIndex]: analysis }
  const [interruptEnabled, setInterruptEnabled] = useState(true);
  const [useGeminiTts, setUseGeminiTts] = useState(false);
  const [interruptResults, setInterruptResults] = useState({}); // { [slideIndex]: evalObj }
  const [qaResults, setQaResults] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [rehearsalIndex, setRehearsalIndex] = useState(0); // หน้าสไลด์ที่จะซ้อม

  if (remoteCode) {
    return <RemotePage code={remoteCode.trim().toUpperCase()} />;
  }

  const allQaResults = [
    ...Object.values(interruptResults).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0)),
    ...qaResults.filter(Boolean),
  ];

  const handleUpdateTranscript = (slideIndex, newTranscript) => {
    const current = results[slideIndex];
    if (!current) return;
    const reanalyzed = analyze(newTranscript, current.duration);
    setResults((prev) => ({
      ...prev,
      [slideIndex]: {
        ...current,
        ...reanalyzed,
      },
    }));
    setAiSummary(null);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header step={step} />
      <main className="flex-1">
        {step === 'mode' && (
          <ModeStep
            rehearsalMode={rehearsalMode}
            onRehearsalModeChange={setRehearsalMode}
            audience={audience}
            onAudienceChange={setAudience}
            timeBudget={timeBudget}
            onTimeBudgetChange={setTimeBudget}
            interruptEnabled={interruptEnabled}
            onInterruptToggle={() => setInterruptEnabled((v) => !v)}
            useGeminiTts={useGeminiTts}
            onGeminiTtsToggle={() => setUseGeminiTts((v) => !v)}
            onNext={() => setStep('upload')}
          />
        )}

        {step === 'upload' && (
          <UploadStep
            deck={deck}
            rehearsalMode={rehearsalMode}
            onRehearsalModeChange={setRehearsalMode}
            audience={audience}
            onAudienceChange={setAudience}
            timeBudget={timeBudget}
            onTimeBudgetChange={setTimeBudget}
            interruptEnabled={interruptEnabled}
            onInterruptToggle={() => setInterruptEnabled((v) => !v)}
            useGeminiTts={useGeminiTts}
            onGeminiTtsToggle={() => setUseGeminiTts((v) => !v)}
            onBackToMode={() => setStep('mode')}
            onDeckChange={(d) => {
              setDeck(d);
              setResults({});
              setInterruptResults({});
              setQaResults([]);
              setAiSummary(null);
              setRehearsalIndex(0);
            }}
            onStart={() => {
              setRehearsalIndex(0);
              setStep('rehearsal');
            }}
          />
        )}

        {step === 'rehearsal' && deck && (
          <RehearsalStep
            deck={deck}
            rehearsalMode={rehearsalMode}
            audience={audience}
            timeBudget={timeBudget}
            initialIndex={rehearsalIndex}
            results={results}
            onResult={(i, r) => {
              setResults((prev) => ({ ...prev, [i]: r }));
              setAiSummary(null);
            }}
            interruptEnabled={interruptEnabled}
            onInterruptToggle={() => setInterruptEnabled((v) => !v)}
            useGeminiTts={useGeminiTts}
            interruptResults={interruptResults}
            onInterruptResult={(i, r) => {
              setInterruptResults((prev) => ({ ...prev, [i]: r }));
              setAiSummary(null);
            }}
            onBack={() => setStep('upload')}
            onFinish={() => setStep('qa')}
          />
        )}

        {step === 'qa' && deck && (
          <QaStep
            deck={deck}
            audience={audience}
            timeBudget={timeBudget}
            useGeminiTts={useGeminiTts}
            onGeminiTtsToggle={() => setUseGeminiTts((v) => !v)}
            results={results}
            qaResults={qaResults}
            onQaResultsChange={setQaResults}
            onBack={() => setStep('rehearsal')}
            onFinish={() => setStep('summary')}
          />
        )}

        {step === 'summary' && deck && (
          <SummaryStep
            deck={deck}
            audience={audience}
            timeBudget={timeBudget}
            results={results}
            qaResults={allQaResults}
            aiSummary={aiSummary}
            onAiSummaryChange={setAiSummary}
            onBack={() => setStep('qa')}
            onReRecordSlide={(i) => {
              setRehearsalIndex(i);
              setStep('rehearsal');
            }}
            onUpdateTranscript={handleUpdateTranscript}
            onRestart={() => {
              Object.values(results).forEach((r) => {
                if (r?.audioUrl) URL.revokeObjectURL(r.audioUrl);
                if (r?.videoUrl) URL.revokeObjectURL(r.videoUrl);
              });
              setResults({});
              setInterruptResults({});
              setQaResults([]);
              setAiSummary(null);
              setRehearsalIndex(0);
              setStep('rehearsal');
            }}
          />
        )}
      </main>
    </div>
  );
}
