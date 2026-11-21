import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

const DEMO_VOICE_PHRASES = [
  '201 комната на 2 ночи, оплатил $100 налом, сдача в сумах, + быстрая стирка',
  'Yellow #2, 3 ночи, дал $100 наличными, сдача сумами, + поздний завтрак',
  'Mix Dorm койка 4, на 2 ночи, оплатил $50 налом, + средняя стирка',
];

export interface UseVoiceDictationOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onStatusMessage?: (msg: string, tone: 'cobalt' | 'amber' | 'rose') => void;
}

export function useVoiceDictation({ onTranscript, onStatusMessage }: UseVoiceDictationOptions) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [supported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  });

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const demoIndexRef = useRef(0);

  const stop = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore already stopped
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const runDemoFallback = useCallback(() => {
    const phrase = DEMO_VOICE_PHRASES[demoIndexRef.current % DEMO_VOICE_PHRASES.length];
    demoIndexRef.current += 1;
    setIsListening(true);
    setInterimText('Слушаю (демо-режим без микрофона)...');
    onStatusMessage?.(
      'Web Speech API недоступен — подставлен пример голосовой диктовки',
      'amber'
    );

    const words = phrase.split(' ');
    let idx = 0;

    const step = () => {
      idx += 3;
      const slice = words.slice(0, idx).join(' ');
      if (idx < words.length) {
        setInterimText(slice);
        onTranscript(slice, false);
        fallbackTimerRef.current = window.setTimeout(step, 180);
      } else {
        setInterimText('');
        setIsListening(false);
        onTranscript(phrase, true);
      }
    };

    fallbackTimerRef.current = window.setTimeout(step, 260);
  }, [onStatusMessage, onTranscript]);

  const start = useCallback(() => {
    if (isListening) {
      stop();
      return;
    }

    const Ctor =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;

    if (!Ctor) {
      runDemoFallback();
      return;
    }

    try {
      const rec = new Ctor();
      rec.lang = 'ru-RU';
      rec.continuous = false;
      rec.interimResults = true;

      let finalAccum = '';

      rec.onstart = () => {
        setIsListening(true);
        setInterimText('');
      };

      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const res = event.results[i];
          const text = res[0]?.transcript ?? '';
          if (res.isFinal) {
            finalAccum = `${finalAccum} ${text}`.trim();
          } else {
            interim = `${interim} ${text}`.trim();
          }
        }
        const combined = `${finalAccum} ${interim}`.trim();
        setInterimText(interim);
        if (combined) {
          onTranscript(combined, !interim && Boolean(finalAccum));
        }
      };

      rec.onerror = (ev) => {
        setIsListening(false);
        setInterimText('');
        recognitionRef.current = null;
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') {
          runDemoFallback();
        } else if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
          onStatusMessage?.(`Ошибка диктовки (${ev.error})`, 'rose');
        }
      };

      rec.onend = () => {
        setIsListening(false);
        setInterimText('');
        recognitionRef.current = null;
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      runDemoFallback();
    }
  }, [isListening, stop, runDemoFallback, onTranscript, onStatusMessage]);

  return {
    isListening,
    interimText,
    supported,
    toggle: start,
    stop,
  };
}
