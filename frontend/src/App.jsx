import { useState } from 'react';
import Header from './components/Header';
import UploadStep from './components/UploadStep';
import RehearsalStep from './components/RehearsalStep';
import SummaryStep from './components/SummaryStep';
import { analyze } from './lib/metrics';

export default function App() {
  const [step, setStep] = useState('upload');
  const [deck, setDeck] = useState(null); // { name, slides }
  const [results, setResults] = useState({}); // { [slideIndex]: analysis }
  const [rehearsalIndex, setRehearsalIndex] = useState(0); // หน้าสไลด์ที่จะซ้อม

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
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header step={step} />
      <main className="flex-1">
        {step === 'upload' && (
          <UploadStep
            deck={deck}
            onDeckChange={(d) => {
              setDeck(d);
              setResults({});
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
            initialIndex={rehearsalIndex}
            results={results}
            onResult={(i, r) => setResults((prev) => ({ ...prev, [i]: r }))}
            onBack={() => setStep('upload')}
            onFinish={() => setStep('summary')}
          />
        )}

        {step === 'summary' && deck && (
          <SummaryStep
            deck={deck}
            results={results}
            onBack={() => setStep('rehearsal')}
            onReRecordSlide={(i) => {
              setRehearsalIndex(i);
              setStep('rehearsal');
            }}
            onUpdateTranscript={handleUpdateTranscript}
            onRestart={() => {
              setResults({});
              setRehearsalIndex(0);
              setStep('rehearsal');
            }}
          />
        )}
      </main>
    </div>
  );
}
