import { useEffect, useState } from 'react';
import Header from './components/Header';
import ModeStep from './components/ModeStep';
import UploadStep from './components/UploadStep';
import RehearsalStep from './components/RehearsalStep';
import QaStep from './components/QaStep';
import SummaryStep from './components/SummaryStep';
import RemotePage from './components/RemotePage';
import WalletModal from './components/WalletModal';
import HistoryModal from './components/HistoryModal';
import { ConfirmDialogHost, resetConfirmSuppressions } from './components/ConfirmModal';
import { analyze } from './lib/metrics';
import { fetchMe } from './lib/api';
import { signInWithGoogle, signOut, supabase } from './lib/supabase';

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
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [interruptResults, setInterruptResults] = useState({}); // { [slideIndex]: evalObj }
  const [qaResults, setQaResults] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [savedSessionId, setSavedSessionId] = useState(null);
  const [rehearsalIndex, setRehearsalIndex] = useState(0); // หน้าสไลด์ที่จะซ้อม
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [walletOpen, setWalletOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const onTokensUpdated = (e) => {
      const nextBalance = e.detail;
      if (typeof nextBalance === 'number') {
        setUser((prev) => (prev ? { ...prev, tokenBalance: nextBalance } : prev));
      }
    };
    window.addEventListener('tokens-updated', onTokensUpdated);
    return () => window.removeEventListener('tokens-updated', onTokensUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref?.trim()) {
      localStorage.setItem('sq_ref', ref.trim().toUpperCase());
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    const syncSession = async (session) => {
      if (!session?.access_token) {
        if (active) {
          setUser(null);
          setAuthLoading(false);
        }
        return;
      }

      try {
        const ref = localStorage.getItem('sq_ref') || undefined;
        const dbUser = await fetchMe(ref);
        if (active) setUser(dbUser);
        if (ref) localStorage.removeItem('sq_ref');
      } catch (err) {
        console.warn('[Auth] Sync user failed:', err);
        if (active) setUser(null);
      } finally {
        if (active) setAuthLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      void syncSession(data?.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session);
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      alert(err.message || 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
  };

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
      <Header
        step={step}
        user={user}
        authLoading={authLoading}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onOpenWallet={() => setWalletOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
      />
      <main className="flex-1">
        {historyOpen ? (
          <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
        ) : (
          <>
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
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
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
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            onBackToMode={() => setStep('mode')}
            onDeckChange={(d) => {
              setDeck(d);
              setResults({});
              setInterruptResults({});
              setQaResults([]);
              setAiSummary(null);
              setSavedSessionId(null);
              resetConfirmSuppressions();
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
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            interruptResults={interruptResults}
            onInterruptResult={(i, r) => {
              setInterruptResults((prev) => ({ ...prev, [i]: r }));
              setAiSummary(null);
            }}
            onBack={() => setStep('upload')}
            onFinish={(skipQa = false) => setStep(skipQa ? 'summary' : 'qa')}
          />
        )}

        {step === 'qa' && deck && (
          <QaStep
            deck={deck}
            audience={audience}
            timeBudget={timeBudget}
            useGeminiTts={useGeminiTts}
            onGeminiTtsToggle={() => setUseGeminiTts((v) => !v)}
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            results={results}
            qaResults={qaResults}
            onQaResultsChange={setQaResults}
            onBack={() => setStep('rehearsal')}
            onFinish={() => setStep('summary')}
          />
        )}

        {step === 'summary' && deck && (
          <SummaryStep
            user={user}
            deck={deck}
            audience={audience}
            rehearsalMode={rehearsalMode}
            timeBudget={timeBudget}
            results={results}
            qaResults={allQaResults}
            aiSummary={aiSummary}
            onAiSummaryChange={setAiSummary}
            savedSessionId={savedSessionId}
            onSavedSessionIdChange={setSavedSessionId}
            onUpdateQaResults={setQaResults}
            onBack={() => setStep(allQaResults.length > 0 ? 'qa' : 'rehearsal')}
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
              setSavedSessionId(null);
              resetConfirmSuppressions();
              setRehearsalIndex(0);
              setStep('rehearsal');
            }}
          />
        )}
          </>
        )}
      </main>

      <WalletModal
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        onBalanceChange={(bal) =>
          setUser((prev) => (prev ? { ...prev, tokenBalance: bal } : prev))
        }
      />
      <ConfirmDialogHost />
    </div>
  );
}
