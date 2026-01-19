
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { decode, encode, decodeAudioData } from './services/geminiService';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
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
      if (!audioContexts.current) {
        audioContexts.current = {
          input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
          output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }),
        };
      }

      if (audioContexts.current.input.state !== 'running') {
        await audioContexts.current.input.resume();
      }
      if (audioContexts.current.output.state !== 'running') {
        await audioContexts.current.output.resume();
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            setIsActive(true);
            const source = audioContexts.current!.input.createMediaStreamSource(stream);
            const scriptProcessor = audioContexts.current!.input.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                // Defensive clamping and scaling to prevent input distortion
                const s = Math.max(-1, Math.min(1, inputData[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              sessionPromise.then((session) => {
                if (session) session.sendRealtimeInput({ media: pcmBlob });
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
                  // Use a small scheduling buffer to avoid distortion gaps
                  const now = outCtx.currentTime;
                  if (nextStartTime.current < now) {
                    nextStartTime.current = now + 0.05;
                  }
                  
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
            console.error('Synchron Session Error:', e);
            stopSession();
          },
          onclose: () => {
            setIsActive(false);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are SYNCHRON. Speak with a mature, sophisticated British male accent. Be concise, professional, and insightful. Avoid filler words. Do not use any placeholder dots, symbols, or ellipsis in your text output.',
        },
      });

      liveSession.current = await sessionPromise;

    } catch (err) {
      console.error('Failed to initialize Synchron voice:', err);
      setIsActive(false);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white relative overflow-hidden font-sans w-full">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(30,30,35,1)_0%,_rgba(0,0,0,1)_100%)] pointer-events-none opacity-60"></div>
      
      <header className="absolute top-0 left-0 z-30 flex items-center justify-between p-6 md:p-10 w-full pointer-events-none">
        <div className="flex items-center space-x-3 pointer-events-auto">
          <div 
            className={`w-1.5 h-1.5 rounded-full transition-all duration-700 ${
              isActive 
                ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] opacity-100' 
                : 'bg-zinc-800 opacity-20'
            }`}
            aria-hidden="true"
          ></div>
          <h1 className="heading-font text-[10px] md:text-xs font-bold tracking-[0.4em] uppercase opacity-40">
            Synchron
          </h1>
        </div>
      </header>

      <main className="absolute inset-0 z-10 flex flex-col items-center justify-center p-4">
        <button 
          onClick={startSession}
          aria-label={isActive ? "Disconnect from Synchron" : "Connect to Synchron"}
          className={`
            relative w-48 h-48 sm:w-64 sm:h-64 lg:w-72 lg:h-72 rounded-full flex items-center justify-center cursor-pointer transition-all duration-1000
            ${isActive ? 'pulse-active border-zinc-100/20' : 'border-zinc-900 hover:border-zinc-700'}
            border-[0.5px] bg-black/10 backdrop-blur-3xl z-20 outline-none focus-visible:ring-2 focus-visible:ring-zinc-400
          `}
        >
          <div className={`
            absolute inset-0 rounded-full transition-opacity duration-1000 orb-glow
            ${isActive ? 'opacity-100' : 'opacity-0'}
          `}></div>
        </button>

        <div className="absolute bottom-0 left-0 z-20 w-full px-6 md:px-12 pb-8 md:pb-12 flex flex-col items-center pointer-events-none">
          <div 
            ref={transcriptRef}
            className="w-full max-w-2xl h-32 md:h-40 overflow-hidden flex flex-col justify-end text-center space-y-4 subtitle-gradient"
          >
            {history.slice(-1).map((h, i) => (
              <p key={i} className="text-[10px] md:text-xs leading-relaxed tracking-widest text-zinc-600 opacity-20 italic px-4">
                {h.text}
              </p>
            ))}
            
            <div 
              className="min-h-[2rem] flex items-center justify-center" 
              aria-live="polite"
              aria-relevant="text"
            >
              {(transcription.user || transcription.ai) && (
                <p className="text-xs md:text-sm leading-relaxed text-zinc-400 font-light tracking-widest px-4 transition-all duration-500 uppercase">
                  {transcription.ai || transcription.user}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
