
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { decode, encode, decodeAudioData } from './services/geminiService';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [transcription, setTranscription] = useState<{user: string, ai: string}>({ user: '', ai: '' });
  const [history, setHistory] = useState<{text: string, role: 'user' | 'ai'}[]>([]);
  
  const audioContexts = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const liveSession = useRef<any>(null);
  const nextStartTime = useRef<number>(0);
  const sources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptionRef = useRef<{ user: string; ai: string }>({ user: '', ai: '' });

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [history, transcription]);

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsSyncing(false);
    if (liveSession.current) {
      liveSession.current.close();
      liveSession.current = null;
    }
    sources.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    sources.current.clear();
    nextStartTime.current = 0;
    setTranscription({ user: '', ai: '' });
    transcriptionRef.current = { user: '', ai: '' };
  }, []);

  const startSession = async () => {
    if (isActive) {
      stopSession();
      return;
    }

    try {
      setIsSyncing(true);
      
      if (!audioContexts.current) {
        audioContexts.current = {
          input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
          output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }),
        };
      }

      if (audioContexts.current.input.state === 'suspended') {
        await audioContexts.current.input.resume();
      }
      if (audioContexts.current.output.state === 'suspended') {
        await audioContexts.current.output.resume();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsSyncing(false);
            const source = audioContexts.current!.input.createMediaStreamSource(stream);
            const scriptProcessor = audioContexts.current!.input.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContexts.current!.input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const outCtx = audioContexts.current!.output;
                  nextStartTime.current = Math.max(nextStartTime.current, outCtx.currentTime);
                  const audioBuffer = await decodeAudioData(decode(part.inlineData.data), outCtx, 24000, 1);
                  const source = outCtx.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(outCtx.destination);
                  source.addEventListener('ended', () => sources.current.delete(source));
                  source.start(nextStartTime.current);
                  nextStartTime.current += audioBuffer.duration;
                  sources.current.add(source);
                }
              }
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              transcriptionRef.current.user += text;
              setTranscription(prev => ({ ...prev, user: prev.user + text }));
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              transcriptionRef.current.ai += text;
              setTranscription({ user: '', ai: transcriptionRef.current.ai });
            }

            if (message.serverContent?.turnComplete) {
              setHistory(prev => {
                const newEntries: { text: string; role: 'user' | 'ai' }[] = [];
                if (transcriptionRef.current.user) {
                  newEntries.push({ text: transcriptionRef.current.user, role: 'user' });
                }
                if (transcriptionRef.current.ai) {
                  newEntries.push({ text: transcriptionRef.current.ai, role: 'ai' });
                }
                return [...prev, ...newEntries].slice(-2);
              });
              setTranscription({ user: '', ai: '' });
              transcriptionRef.current = { user: '', ai: '' };
            }

            if (message.serverContent?.interrupted) {
              sources.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sources.current.clear();
              nextStartTime.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            stopSession();
          },
          onclose: () => {
            setIsActive(false);
            setIsSyncing(false);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are SYNCHRON, a highly advanced acoustic intelligence. You speak with a mature, sophisticated, and articulate British male accent. Your tone is calm, professional, and wise. You interact via high-quality real-time voice. Avoid filler words. Be concise and natural, like a learned companion.',
        },
      });

      liveSession.current = await sessionPromise;

    } catch (err) {
      console.error('Failed to start sync:', err);
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white relative overflow-hidden font-sans w-full selection:bg-zinc-800">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(30,30,35,1)_0%,_rgba(0,0,0,1)_100%)] pointer-events-none opacity-60"></div>
      
      {/* Header - Fixed & Cinematic */}
      <header className="absolute top-0 left-0 z-30 flex items-center justify-between p-6 md:p-10 w-full pointer-events-none">
        <div className="flex items-center space-x-4 pointer-events-auto">
          <div className="relative flex items-center justify-center">
            <div className={`w-2 h-2 rounded-full transition-all duration-700 ${isActive ? 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)] scale-110' : 'bg-zinc-800'}`}></div>
            {isActive && <div className="absolute w-2 h-2 rounded-full bg-red-500 animate-ping opacity-40"></div>}
          </div>
          <h1 className="heading-font text-[10px] md:text-xs font-bold tracking-[0.4em] uppercase opacity-70 group cursor-default">
            Synchron <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-500 ml-2 font-light">Acoustic Intelligence</span>
          </h1>
        </div>
      </header>

      {/* Main Interaction Layer */}
      <main className="absolute inset-0 z-10 flex flex-col items-center justify-center p-4">
        <div 
          onClick={startSession}
          className={`
            relative w-48 h-48 sm:w-64 sm:h-64 lg:w-72 lg:h-72 rounded-full flex items-center justify-center cursor-pointer transition-all duration-700
            ${isActive ? 'pulse-active border-zinc-100/30' : 'border-zinc-800 hover:border-zinc-600 hover:scale-[1.02]'}
            border-[0.5px] bg-black/20 backdrop-blur-xl z-20 group
          `}
        >
          {/* Internal Glow */}
          <div className={`
            absolute inset-0 rounded-full transition-opacity duration-1000 orb-glow
            ${isActive ? 'opacity-100' : 'opacity-0'}
          `}></div>
          
          {/* Interaction Icon */}
          <div className="flex items-center justify-center pointer-events-none z-30">
             <div className={`transition-all duration-700 transform ${isActive ? 'scale-110 text-white' : 'scale-100 text-zinc-500 group-hover:text-zinc-300'} ${isSyncing ? 'animate-pulse' : ''}`}>
                <i className={`fa-solid fa-microphone ${isActive ? 'text-4xl' : 'text-3xl'}`}></i>
             </div>
          </div>

          {/* Minimal Label when inactive */}
          {!isActive && !isSyncing && (
             <div className="absolute bottom-12 sm:bottom-16 text-[8px] tracking-[0.3em] uppercase opacity-40 group-hover:opacity-80 transition-opacity font-medium">
               Connect
             </div>
          )}
        </div>
      </main>

      {/* Narrative/Transcription Layer */}
      <div className="absolute bottom-0 left-0 z-20 w-full px-6 md:px-12 pb-16 md:pb-20 flex flex-col items-center pointer-events-none">
          <div 
            ref={transcriptRef}
            className="w-full max-w-2xl h-32 md:h-40 overflow-hidden flex flex-col justify-end text-center space-y-3 subtitle-gradient"
          >
            {/* Context Memory */}
            {history.slice(-1).map((h, i) => (
              <p key={i} className="text-[10px] md:text-xs leading-relaxed tracking-wider text-zinc-400 opacity-40 italic transition-all duration-1000 px-4">
                {h.text}
              </p>
            ))}
            
            {/* Active Dialogue */}
            <div className="min-h-[2.5rem] flex items-center justify-center">
              {(transcription.user || transcription.ai) ? (
                <p className="text-base md:text-lg lg:text-xl leading-snug text-white font-medium tracking-wide drop-shadow-lg px-4 transition-all duration-300 transform translate-y-0 opacity-100">
                  {transcription.ai || transcription.user}
                </p>
              ) : (
                isActive && !transcription.user && !transcription.ai && (
                  <div className="flex space-x-1 opacity-20">
                    <div className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1 h-1 bg-white rounded-full animate-bounce"></div>
                  </div>
                )
              )}
            </div>
          </div>
      </div>

      {/* Global Accents */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 opacity-20 pointer-events-none hidden md:block">
        <div className="w-32 h-[1px] bg-gradient-to-r from-transparent via-zinc-100 to-transparent"></div>
      </div>
    </div>
  );
};

export default App;
