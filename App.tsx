
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceStatus, AppLanguage, SUPPORTED_LANGUAGES } from './types';
import { Camera, MapPin, Globe, Mic, Sparkles, Footprints, Power, RefreshCw, CheckCircle2, Languages, X, Navigation, Map as MapIcon, LocateFixed, Search } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// --- UI Strings ---
const UI_STRINGS: Record<string, Record<string, string>> = {
  'en-US': {
    camera_on: "Vision mode activated.",
    camera_off: "Vision mode off.",
    location_on: "Navigator mode activated.",
    location_off: "Navigator off.",
    ready: "System Ready",
    listening: "Listening...",
    speaking: "Vision Voice",
    nav_ready: "Guide Ready",
    hold_to_talk: "Hold to Talk",
    guidance_start: "Guidance started.",
    swipe_left_hint: "Vision",
    swipe_right_hint: "Navigator",
    swipe_down_hint: "Maps",
    swipe_up_hint: "Blank Screen",
    tap_to_start: "Tap to Initialize",
    describe_scene: "Scanning environment...",
    describe_location: "Accessing Google Maps data...",
    calibration_start: "Calibration started. Keep the device steady.",
    calibration_right: "Turn right.",
    calibration_left: "Turn left.",
    calibration_up: "Tilt up.",
    calibration_down: "Tilt down.",
    calibration_done: "All set.",
    move_detected: "Perfect.",
    skip_calibration: "Skip Calibration"
  },
  'hi-IN': {
    camera_on: "दृष्टि मोड सक्रिय।",
    camera_off: "दृष्टि मोड बंद।",
    location_on: "नेविगेटर मोड सक्रिय।",
    location_off: "नेविगेटर बंद।",
    ready: "సిస్టమ్ సిద్ధంగా ఉంది",
    listening: "सुन रहा हूँ...",
    speaking: "विज़न वॉयस",
    calibration_start: "कैलिब्रेशन शुरू। फोन स्थिर रखें।",
    calibration_right: "दाईं ओर मुड़ें।",
    calibration_left: "बाईं ओर मुड़ें।",
    calibration_up: "ऊपर झुकें।",
    calibration_down: "नीचे झुकें।",
    calibration_done: "सब तैयार है।",
    skip_calibration: "छोड़ें"
  },
  'te-IN': {
    camera_on: "విజన్ మోడ్ సక్రియం చేయబడింది.",
    camera_off: "విజన్ మోడ్ ఆఫ్.",
    ready: "సిస్టమ్ సిద్ధంగా ఉంది",
    listening: "వింటున్నాను...",
    speaking: "విజన్ వాయిస్",
    calibration_start: "కాలిబ్రేషన్ ప్రారంభమైంది.",
    calibration_right: "కుడి వైపుకు తిరగండి.",
    calibration_left: "ఎడమ వైపుకు తిరగండి.",
    calibration_up: "పైకి వంచండి.",
    calibration_down: "కిందికి వంచండి.",
    calibration_done: "అంతా సిద్ధం.",
    skip_calibration: "దాటవేయి"
  },
  'es-ES': {
    camera_on: "Modo visión activado.",
    camera_off: "Modo visión apagado.",
    ready: "Sistema listo",
    listening: "Escuchando...",
    speaking: "Voz de Visión",
    calibration_start: "Calibración iniciada.",
    calibration_right: "Gira a la derecha.",
    calibration_left: "Gira a la izquierda.",
    calibration_up: "Inclina hacia arriba.",
    calibration_down: "Inclina hacia abajo.",
    calibration_done: "Todo listo.",
    skip_calibration: "Omitir"
  }
};

const playHaptic = (type: 'light' | 'medium' | 'heavy' | 'double' | 'success') => {
  if (navigator.vibrate) {
    const patterns = { 
      light: 20, 
      medium: 50, 
      heavy: 80,
      double: [40, 60, 40],
      success: [15, 40, 15, 80]
    };
    navigator.vibrate(patterns[type]);
  }
};

const activeSources = new Set<AudioBufferSourceNode>();
const stopAllAudio = () => {
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
  activeSources.clear();
};

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const analyzeGesture = (points: {x: number, y: number}[]) => {
  if (points.length < 5) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx > 80 && absDx > absDy * 1.5) {
    return dx > 0 ? 'SWIPE_RIGHT' : 'SWIPE_LEFT';
  }
  if (absDy > 80 && absDy > absDx * 1.5) {
    return dy > 0 ? 'SWIPE_DOWN' : 'SWIPE_UP';
  }
  return null;
};

const App: React.FC = () => {
  const [isAwake, setIsAwake] = useState(false);
  const [appState, setAppState] = useState<'INIT' | 'LANGUAGE_PICKER' | 'CALIBRATION' | 'READY'>('INIT');
  const [calibrationStep, setCalibrationStep] = useState<number>(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMicHeld, setIsMicHeld] = useState(false);
  const [visionActive, setVisionActive] = useState(false);
  const [isNavMode, setIsNavMode] = useState(false);
  const [isMapsMode, setIsMapsMode] = useState(false);
  const [isBlank, setIsBlank] = useState(false);
  const [isGuidanceActive, setIsGuidanceActive] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage | null>(null);
  const [gestureTrail, setGestureTrail] = useState<{x: number, y: number}[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const currentSessionRef = useRef<any>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  const visionActiveRef = useRef(false);
  const isNavModeRef = useRef(false);
  const isMapsModeRef = useRef(false);
  const isMicHeldRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isCountingDownRef = useRef(false);

  const initialOrientation = useRef<{alpha: number, beta: number, gamma: number} | null>(null);
  const lastPromptTime = useRef<number>(0);
  
  const tapCountRef = useRef<number>(0);
  const tapTimerRef = useRef<number | null>(null);
  const pointsRef = useRef<{x: number, y: number}[]>([]);
  const holdTimerRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);

  useEffect(() => { 
    visionActiveRef.current = visionActive;
    isNavModeRef.current = isNavMode;
    isMapsModeRef.current = isMapsMode;
    isMicHeldRef.current = isMicHeld;
    isSpeakingRef.current = isSpeaking;
  }, [visionActive, isNavMode, isMapsMode, isMicHeld, isSpeaking]);

  const t = (key: string) => {
    if (!selectedLanguage) return UI_STRINGS['en-US'][key] || key;
    return (UI_STRINGS[selectedLanguage.code] || UI_STRINGS['en-US'])[key] || key;
  };

  const speakText = useCallback((text: string, callback?: () => void) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (selectedLanguage) utterance.lang = selectedLanguage.code;
    utterance.onend = () => callback?.();
    window.speechSynthesis.speak(utterance);
  }, [selectedLanguage]);

  useEffect(() => {
    if (appState !== 'CALIBRATION') return;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const { alpha, beta, gamma } = event;
      if (alpha === null || beta === null || gamma === null) return;
      if (!initialOrientation.current) { initialOrientation.current = { alpha, beta, gamma }; return; }
      const dAlpha = alpha - initialOrientation.current.alpha;
      const dBeta = beta - initialOrientation.current.beta;
      const now = Date.now();
      if (now - lastPromptTime.current < 2500) return;
      const advance = () => {
        lastPromptTime.current = now;
        initialOrientation.current = { alpha, beta, gamma };
        playHaptic('medium');
        setCalibrationStep(s => s + 1);
      };
      switch (calibrationStep) {
        case 1: if (dAlpha < -25 || dAlpha > 335) advance(); break;
        case 2: if (dAlpha > 25 || dAlpha < -335) advance(); break;
        case 3: if (dBeta < -20) advance(); break;
        case 4: if (dBeta > 20) advance(); break;
      }
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [appState, calibrationStep]);

  useEffect(() => {
    if (appState === 'CALIBRATION') {
      const steps = [ t('calibration_start'), t('calibration_right'), t('calibration_left'), t('calibration_up'), t('calibration_down'), t('calibration_done') ];
      if (calibrationStep === 0) {
        speakText(steps[0], () => setTimeout(() => setCalibrationStep(1), 2000));
      } else if (calibrationStep < steps.length) {
        speakText(steps[calibrationStep]);
        if (calibrationStep === steps.length - 1) {
          setTimeout(() => { setAppState('READY'); playHaptic('success'); }, 2500);
        }
      }
    }
  }, [appState, calibrationStep]);

  const stopCameraStream = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = null;
    setVisionActive(false);
  }, []);

  const closeSession = async () => {
    stopAllAudio();
    if (currentSessionRef.current) { try { currentSessionRef.current.close(); } catch(e) {} currentSessionRef.current = null; }
    if (audioContextInRef.current) { try { await audioContextInRef.current.close(); } catch(e) {} audioContextInRef.current = null; }
    if (audioContextOutRef.current) { try { await audioContextOutRef.current.close(); } catch(e) {} audioContextOutRef.current = null; }
    nextStartTimeRef.current = 0;
  };

  const startVoiceSession = useCallback(async (mode: 'VISION' | 'NAV' | 'MAPS') => {
    await closeSession();
    setVoiceStatus('connecting');
    const systemPrompt = `USER CONTEXT: The user is a BLIND person. You are their visual and spatial guide from Google.
IDENTITY: ${mode === 'MAPS' ? 'GOOGLE MAPS EXPLORER' : mode === 'NAV' ? 'GOOGLE NAVIGATOR' : 'GOOGLE VISION'}.
GOAL: Provide vivid, professional, and helpful spatial descriptions. 
MAPS MODE: You specialize in providing neighborhood awareness. Identify the current street, nearest intersections, and highly relevant local businesses or landmarks.
SAFETY: Always highlight immediate physical hazards first.
STYLE: Clear, descriptive, and reassuring. Use relative directions.`;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
      audioContextInRef.current = new AudioCtx({ sampleRate: 16000 });
      audioContextOutRef.current = new AudioCtx({ sampleRate: 24000 });
      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setVoiceStatus('listening');
            const source = audioContextInRef.current!.createMediaStreamSource(micStream);
            const processor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (!isMicHeldRef.current || isSpeakingRef.current || isCountingDownRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
            };
            source.connect(processor);
            processor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioContextOutRef.current) {
              if (!isSpeakingRef.current) setIsSpeaking(true);
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.onended = () => { activeSources.delete(source); if (activeSources.size === 0) setIsSpeaking(false); };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSources.add(source);
            }
          },
          onerror: () => setVoiceStatus('idle'),
          onclose: () => setVoiceStatus('idle')
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ googleMaps: {} }, { googleSearch: {} }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: systemPrompt
        }
      });
      currentSessionRef.current = session;
    } catch (err) { setVoiceStatus('idle'); }
  }, [selectedLanguage]);

  const startVisionMode = async () => {
    speakText("Vision Mode");
    setIsNavMode(false); setIsMapsMode(false); setIsGuidanceActive(false); setIsBlank(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, aspectRatio: 4/3 } });
      if (videoRef.current) { videoRef.current.srcObject = stream; setVisionActive(true); playHaptic('medium'); }
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = window.setInterval(() => {
        if (canvasRef.current && videoRef.current && videoRef.current.readyState === 4) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            canvasRef.current.width = 320; canvasRef.current.height = 240; 
            ctx.drawImage(videoRef.current, 0, 0, 320, 240);
            const base64 = canvasRef.current.toDataURL('image/jpeg', 0.4).split(',')[1];
            if (currentSessionRef.current) currentSessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
          }
        }
      }, 1000);
      startVoiceSession('VISION');
    } catch (e) { playHaptic('heavy'); speakText("Camera access denied."); }
  };

  const startNavigatorMode = () => {
    speakText("Navigator Mode");
    if (visionActiveRef.current) stopCameraStream();
    setIsNavMode(true); setIsMapsMode(false); setIsGuidanceActive(false); setIsBlank(false);
    playHaptic('heavy');
    startVoiceSession('NAV');
  };

  const startMapsMode = () => {
    speakText("Maps Mode");
    if (visionActiveRef.current) stopCameraStream();
    setIsMapsMode(true); setIsNavMode(false); setIsGuidanceActive(false); setIsBlank(false);
    playHaptic('medium');
    startVoiceSession('MAPS');
  };

  const describeLocation = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    speakText(t('describe_location'));
    playHaptic('light');

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: "I am a blind person exploring my surroundings. Using my exact location coordinates, please describe the street I'm on, the neighborhood character, and the 5 most important landmarks or businesses within walking distance. Be professional and descriptive.",
          config: {
            tools: [{ googleMaps: {} }],
            toolConfig: {
              retrievalConfig: {
                latLng: { latitude, longitude }
              }
            }
          },
        });
        if (response.text) speakText(response.text);
      } catch (err) {
        speakText("Location details unavailable. Please check your signal.");
      } finally {
        setIsAnalyzing(false);
      }
    }, () => {
      speakText("Location access is required for Maps Mode.");
      setIsAnalyzing(false);
    });
  };

  const triggerCountdownDescription = async () => {
    if (isCountingDownRef.current) return;
    isCountingDownRef.current = true;
    let count = 3;
    setCountdown(count);
    speakText("3");
    playHaptic('light');
    const interval = setInterval(async () => {
      count--;
      if (count > 0) {
        setCountdown(count); speakText(count.toString()); playHaptic('light');
      } else {
        clearInterval(interval); setCountdown(null); isCountingDownRef.current = false;
        speakText("Analyzing scene."); playHaptic('success');
        if (videoRef.current && canvasRef.current) {
           const ctx = canvasRef.current.getContext('2d');
           if (ctx) {
             canvasRef.current.width = 1024; canvasRef.current.height = 768;
             ctx.drawImage(videoRef.current, 0, 0, 1024, 768);
             const base64 = canvasRef.current.toDataURL('image/jpeg', 0.9).split(',')[1];
             try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const response = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: [{
                    parts: [
                      { inlineData: { data: base64, mimeType: 'image/jpeg' } },
                      { text: "USER IS BLIND. Describe this scene in detail for them. Focus on hazards and layout." }
                    ]
                  }]
                });
                if (response.text) speakText(response.text);
             } catch (err) { speakText("Analysis failed."); }
           }
        }
      }
    }, 1000);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (appState !== 'READY') return;
    if (isBlank) {
      setIsBlank(false);
      playHaptic('medium');
      return;
    }
    pointsRef.current = [{x: e.clientX, y: e.clientY}];
    setGestureTrail([{x: e.clientX, y: e.clientY}]);
    holdTimerRef.current = window.setTimeout(() => {
      if (isSpeakingRef.current || isCountingDownRef.current || isAnalyzing) return;
      setIsMicHeld(true); playHaptic('double');
    }, 450);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (appState !== 'READY' || pointsRef.current.length === 0 || isBlank) return;
    pointsRef.current.push({x: e.clientX, y: e.clientY});
    setGestureTrail(prev => [...prev, {x: e.clientX, y: e.clientY}].slice(-30));
    if (Math.sqrt(Math.pow(e.clientX - pointsRef.current[0].x, 2) + Math.pow(e.clientY - pointsRef.current[0].y, 2)) > 30) {
      if (holdTimerRef.current) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    }
  };

  const handlePointerUp = () => {
    if (appState !== 'READY' || isBlank) return;
    if (holdTimerRef.current) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (isMicHeldRef.current) { setIsMicHeld(false); playHaptic('light'); } 
    else {
      const gesture = analyzeGesture(pointsRef.current);
      if (gesture === 'SWIPE_RIGHT') { if (!isNavModeRef.current) startNavigatorMode(); } 
      else if (gesture === 'SWIPE_LEFT') { if (!visionActiveRef.current) startVisionMode(); } 
      else if (gesture === 'SWIPE_DOWN') { if (!isMapsModeRef.current) startMapsMode(); }
      else if (gesture === 'SWIPE_UP') { 
        stopCameraStream(); 
        setIsNavMode(false); 
        setIsMapsMode(false); 
        setIsGuidanceActive(false); 
        closeSession(); 
        setIsBlank(true);
        playHaptic('heavy');
      }
      else {
        tapCountRef.current++;
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        tapTimerRef.current = window.setTimeout(() => {
          if (tapCountRef.current === 2) {
            if (isNavModeRef.current) { setIsGuidanceActive(!isGuidanceActive); playHaptic('success'); if (isGuidanceActive) speakText(t('guidance_start')); } 
            else if (isMapsModeRef.current) describeLocation();
            else if (visionActiveRef.current) triggerCountdownDescription(); 
            else startVisionMode();
          }
          tapCountRef.current = 0;
        }, 300);
      }
    }
    pointsRef.current = []; setGestureTrail([]);
  };

  const requestOrientationAndSetLang = async (lang: AppLanguage) => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try { await (DeviceOrientationEvent as any).requestPermission(); } catch (e) {}
    }
    setSelectedLanguage(lang);
    localStorage.setItem('vision_voice_lang', lang.code);
    setAppState('CALIBRATION'); setCalibrationStep(0); playHaptic('medium');
  };

  // --- Views ---

  if (!isAwake) {
    return (
      <div onClick={() => setIsAwake(true)} className="h-[100svh] w-full bg-white flex flex-col items-center justify-center p-8 text-center cursor-pointer">
        <div className="mb-12 relative">
           <div className="absolute inset-0 bg-blue-100 scale-150 blur-3xl rounded-full opacity-50 animate-pulse"></div>
           <Sparkles size={80} className="text-[#4285F4] relative z-10" />
        </div>
        <h1 className="text-4xl font-bold text-[#1F1F1F] mb-4 tracking-tight font-['Google_Sans']">Google Vision Voice</h1>
        <p className="text-gray-500 text-xl mb-12 max-w-xs mx-auto">Assistive technology for independent living.</p>
        <button className="w-full max-w-xs py-5 bg-[#4285F4] text-white rounded-full font-medium text-xl shadow-lg active:scale-95 transition-all">Get Started</button>
      </div>
    );
  }

  if (appState === 'INIT') {
    const saved = localStorage.getItem('vision_voice_lang');
    if (saved) { setSelectedLanguage(SUPPORTED_LANGUAGES.find(l => l.code === saved)!); setAppState('READY'); }
    else setAppState('LANGUAGE_PICKER');
    return null;
  }

  if (appState === 'LANGUAGE_PICKER') {
    return (
      <div className="h-[100svh] w-full bg-[#F8F9FA] flex flex-col p-6 pt-12">
        <header className="mb-12 flex items-center gap-4">
           <div className="p-3 bg-white rounded-2xl google-shadow"><Languages className="text-[#4285F4]" /></div>
           <h2 className="text-2xl font-bold text-[#1F1F1F]">Select Language</h2>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto pb-12">
          {SUPPORTED_LANGUAGES.map(lang => (
            <button key={lang.code} onClick={() => requestOrientationAndSetLang(lang)} className="w-full bg-white google-shadow p-6 rounded-3xl flex items-center justify-between text-left active:bg-gray-50 transition-colors">
              <div>
                <div className="text-lg font-bold text-[#1F1F1F]">{lang.name}</div>
                <div className="text-[#4285F4] font-medium">{lang.label}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-[#F1F3F4] flex items-center justify-center"><Globe size={20} className="text-gray-400" /></div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (appState === 'CALIBRATION') {
    return (
      <div className="h-[100svh] w-full bg-white flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-16">
          <div className={`p-10 rounded-full border-4 ${calibrationStep >= 5 ? 'border-[#34A853] bg-green-50' : 'border-[#4285F4]'} transition-all duration-500`}>
             {calibrationStep >= 5 ? <CheckCircle2 size={64} className="text-[#34A853]" /> : <RefreshCw size={64} className="text-[#4285F4] animate-spin" />}
          </div>
        </div>
        <h2 className="text-3xl font-bold text-[#1F1F1F] mb-6 tracking-tight">Calibration</h2>
        <div className="w-full max-w-xs bg-[#F1F3F4] h-2 rounded-full mb-12 overflow-hidden">
          <div className="h-full bg-[#4285F4] transition-all duration-500" style={{ width: `${(calibrationStep / 5) * 100}%` }}></div>
        </div>
        <div className="bg-[#F8F9FA] p-10 rounded-[2rem] google-shadow w-full max-w-sm mb-12">
          <p className="text-[#1F1F1F] text-2xl font-bold leading-tight">
            {UI_STRINGS[selectedLanguage?.code || 'en-US'][['calibration_start', 'calibration_right', 'calibration_left', 'calibration_up', 'calibration_down', 'calibration_done'][calibrationStep]]}
          </p>
        </div>
        <button 
          onClick={() => { setAppState('READY'); playHaptic('success'); speakText("Calibration skipped."); }}
          className="text-sm font-bold text-gray-400 uppercase tracking-widest py-3 px-8 rounded-full hover:bg-gray-50 transition-colors"
        >
          {t('skip_calibration')}
        </button>
      </div>
    );
  }

  if (isBlank) {
    return (
      <div 
        onPointerDown={handlePointerDown}
        className="h-[100svh] w-full bg-black flex items-center justify-center cursor-pointer"
      />
    );
  }

  return (
    <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className="h-[100svh] w-full bg-[#F8F9FA] flex flex-col overflow-hidden relative touch-none select-none">
      
      {/* Background Visuals */}
      <div className={`absolute inset-0 transition-opacity duration-700 ${visionActive ? 'opacity-100' : 'opacity-0'}`}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale-[0.1]" />
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[2px]"></div>
      </div>

      {isMapsMode && (
        <div className="absolute inset-0 z-0 bg-[#FFFBE6] animate-in flex items-center justify-center">
           <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(#FBBC04 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
        </div>
      )}

      {isNavMode && (
        <div className="absolute inset-0 z-0 bg-[#E8F0FE] animate-in flex items-center justify-center">
           <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(#4285F4 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
        </div>
      )}

      <header className="p-6 flex items-center justify-between z-40 relative">
          <button className="bg-white google-shadow px-6 py-3 rounded-full flex items-center gap-3 active:scale-95 transition-all" onClick={() => setAppState('LANGUAGE_PICKER')}>
              <div className={`w-3 h-3 rounded-full ${isMicHeld ? 'bg-[#34A853] animate-pulse' : (isSpeaking ? 'bg-[#4285F4]' : 'bg-gray-300')}`} />
              <span className="text-sm font-bold text-[#1F1F1F] tracking-tight uppercase">{selectedLanguage?.name}</span>
          </button>
          
          {(isNavMode || visionActive || isMapsMode) && (
            <button onClick={(e) => { e.stopPropagation(); if (isNavMode) setIsNavMode(false); if (visionActive) stopCameraStream(); if (isMapsMode) setIsMapsMode(false); closeSession(); playHaptic('light'); }} className="bg-white google-shadow p-4 rounded-full text-[#EA4335] active:scale-95 transition-all">
              <X size={24} />
            </button>
          )}
      </header>

      {countdown !== null && (
        <div className="absolute inset-0 flex items-center justify-center z-[100] bg-white/60 backdrop-blur-md">
            <span className="text-[12rem] font-bold text-[#4285F4] animate-ping">{countdown}</span>
        </div>
      )}

      <main className="flex-1 flex flex-col items-center justify-center relative z-20 pointer-events-none px-8 mt-[-40px]">
          <div className="relative">
              <div className={`absolute inset-0 blur-[100px] transition-all duration-1000 rounded-full opacity-30 ${isSpeaking ? 'bg-[#4285F4] scale-150' : (isMicHeld ? 'bg-[#34A853] scale-125' : (isMapsMode ? 'bg-[#FBBC04]' : 'bg-[#FBBC04]'))}`} />
              
              <div className={`w-64 h-64 rounded-full material-card flex items-center justify-center relative overflow-hidden transition-all duration-700 ${isMicHeld || isSpeaking ? 'scale-110' : 'scale-100'} ${isNavMode ? 'border-[6px] border-[#4285F4]' : isMapsMode ? 'border-[6px] border-[#FBBC04]' : ''}`}>
                  {isAnalyzing ? (
                      <div className="animate-spin text-[#FBBC04]"><Search size={80} /></div>
                  ) : isSpeaking ? (
                      <div className="flex gap-1.5 items-center h-16">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className="w-2.5 bg-[#4285F4] rounded-full animate-wave" style={{ animationDelay: `${i * 0.15}s`, height: '100%' }} />
                        ))}
                      </div>
                  ) : (isMicHeld ? <Mic size={72} className="text-[#34A853]" /> : 
                       (isNavMode ? <MapPin size={72} className="text-[#4285F4]" /> : 
                       (isMapsMode ? <MapIcon size={72} className="text-[#FBBC04]" /> :
                       (visionActive ? <Camera size={72} className="text-gray-700" /> : <Sparkles size={72} className="text-[#FBBC04]" />))))}
              </div>
          </div>

          <div className="mt-12 text-center w-full max-w-xs">
              <h2 className="text-4xl font-bold text-[#1F1F1F] tracking-tight mb-4">
                {isAnalyzing ? "Analyzing..." : isSpeaking ? t('speaking') : (isMicHeld ? t('listening') : (isNavMode ? "Navigator" : isMapsMode ? "Maps Explorer" : (visionActive ? "Vision" : t('ready'))))}
              </h2>
              
              <div className="flex items-center justify-center gap-2 mb-10">
                 <div className="w-1.5 h-1.5 rounded-full bg-[#4285F4]"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-[#EA4335]"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-[#FBBC04]"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-[#34A853]"></div>
              </div>

              {!visionActive && !isNavMode && !isMapsMode && (
                <div className="grid grid-cols-2 gap-3 w-full">
                    <div className="bg-white google-shadow px-4 py-3 rounded-2xl flex flex-col items-center gap-1 border-b-4 border-[#4285F4]">
                      <Camera size={18} className="text-[#4285F4]" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Left: Vision</span>
                    </div>
                    <div className="bg-white google-shadow px-4 py-3 rounded-2xl flex flex-col items-center gap-1 border-b-4 border-[#34A853]">
                      <Navigation size={18} className="text-[#34A853]" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Right: Nav</span>
                    </div>
                    <div className="bg-white google-shadow px-4 py-3 rounded-2xl flex flex-col items-center gap-1 border-b-4 border-[#FBBC04]">
                      <MapIcon size={18} className="text-[#FBBC04]" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Down: Maps</span>
                    </div>
                    <div className="bg-white google-shadow px-4 py-3 rounded-2xl flex flex-col items-center gap-1 border-b-4 border-gray-400">
                      <Power size={18} className="text-gray-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Up: Off</span>
                    </div>
                </div>
              )}

              {visionActive && !isAnalyzing && (
                <div className="bg-white google-shadow px-6 py-4 rounded-3xl border-2 border-[#4285F4] animate-pulse inline-block">
                  <span className="text-sm font-bold text-[#4285F4] uppercase tracking-tighter">Double Tap to Describe</span>
                </div>
              )}

              {isMapsMode && !isAnalyzing && (
                <div className="bg-white google-shadow px-6 py-4 rounded-3xl border-2 border-[#FBBC04] animate-pulse inline-block">
                  <span className="text-sm font-bold text-[#FBBC04] uppercase tracking-tighter">Double Tap for Nearby</span>
                </div>
              )}

              {isNavMode && isGuidanceActive && (
                <div className="bg-[#E8F0FE] border border-[#4285F4]/30 px-6 py-4 rounded-3xl flex items-center justify-center gap-3">
                  <Footprints size={20} className="text-[#4285F4]" />
                  <span className="text-[#4285F4] font-bold text-sm">Guidance Active</span>
                </div>
              )}
          </div>
      </main>

      <footer className="p-8 pb-12 flex flex-col items-center gap-2 z-40 relative mt-auto">
        <div className="w-10 h-1 bg-gray-200 rounded-full mb-3"></div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.3em]">{t('hold_to_talk')}</p>
      </footer>

      <svg className="absolute inset-0 w-full h-full pointer-events-none z-50">
        {gestureTrail.length > 1 && (
          <path 
            d={`M ${gestureTrail[0].x} ${gestureTrail[0].y} ${gestureTrail.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')}`} 
            fill="none" 
            stroke="rgba(66, 133, 244, 0.15)" 
            strokeWidth="28" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
        )}
      </svg>

      <canvas ref={canvasRef} className="hidden" />
      <style>{`
        .animate-in { animation: fadeIn 0.4s cubic-bezier(0, 0, 0.2, 1); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default App;
