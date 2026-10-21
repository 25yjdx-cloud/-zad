import { useCallback, useEffect, useRef, useState } from 'react';
import tracks from '../data/adhkar-audio.json';
import { getSuggestedAzkarTrack } from '../services/azkarAudio.js';
import { appUrl } from '../services/appUrl.js';

const SPEEDS = [1, 1.25, 1.5];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

export default function AzkarAudioPlayer() {
  const audioRef = useRef(null);
  const startTrackRef = useRef(null);
  const [trackKey, setTrackKey] = useState(getSuggestedAzkarTrack);
  const [isVisible, setIsVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [status, setStatus] = useState('');
  const track = tracks[trackKey] ?? tracks.morning;
  const playbackRate = SPEEDS[speedIndex];

  const startTrack = useCallback((key) => {
    const selectedTrack = tracks[key];
    const audio = audioRef.current;
    if (!selectedTrack || !audio || selectedTrack.enabled !== true) return;

    const source = appUrl(selectedTrack.path);
    setTrackKey(key);
    setIsVisible(true);
    setStatus('');
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(0);

    if (audio.src !== new URL(source, document.baseURI).href) {
      audio.src = source;
      audio.load();
    } else if (audio.ended) {
      audio.currentTime = 0;
    }
    audio.playbackRate = playbackRate;
    audio.play().catch(() => {
      setIsLoading(false);
      setStatus('تعذر تشغيل المقطع. حاول مرة أخرى بعد التحقق من الصوت.');
    });
  }, [playbackRate]);

  useEffect(() => {
    startTrackRef.current = startTrack;
  }, [startTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    audio.src = appUrl(tracks[getSuggestedAzkarTrack()].path);

    const onMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setIsLoading(false);
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function'
        && Number.isFinite(audio.duration)) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          });
        } catch { /* Position state is optional and not supported in every browser. */ }
      }
    };
    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    };
    const onPause = () => {
      setIsPlaying(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    };
    const onEnded = () => {
      setIsPlaying(false);
      setStatus('انتهى المقطع الصوتي.');
    };
    const onError = () => {
      setIsPlaying(false);
      setIsLoading(false);
      setStatus('تعذر تحميل المقطع الصوتي. تحقق من اتصال التطبيق أو توفر الملف.');
    };
    const onCategoryPlay = (event) => {
      const trigger = event.target.closest?.('[data-azkar-audio-track]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      startTrackRef.current?.(trigger.dataset.azkarAudioTrack);
    };

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', onMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    document.addEventListener('click', onCategoryPlay);

    const recommendation = document.querySelector('#azkar-audio-recommendation');
    const refreshRecommendation = () => {
      if (!recommendation) return;
      const suggested = tracks[getSuggestedAzkarTrack()];
      recommendation.textContent = `الورد المقترح الآن: ${suggested.title}`;
    };
    refreshRecommendation();
    const recommendationTimer = window.setInterval(refreshRecommendation, 60_000);

    if ('mediaSession' in navigator) {
      const handlers = {
        play: () => { void audio.play().catch(() => {}); },
        pause: () => audio.pause(),
        seekbackward: ({ seekOffset = 10 } = {}) => {
          audio.currentTime = Math.max(0, audio.currentTime - seekOffset);
        },
        seekforward: ({ seekOffset = 10 } = {}) => {
          audio.currentTime = Math.min(audio.duration || audio.currentTime + seekOffset, audio.currentTime + seekOffset);
        },
        seekto: ({ seekTime } = {}) => {
          if (Number.isFinite(seekTime)) audio.currentTime = seekTime;
        },
      };
      for (const [action, handler] of Object.entries(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional platform action. */ }
      }
    }

    return () => {
      window.clearInterval(recommendationTimer);
      document.removeEventListener('click', onCategoryPlay);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', onMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: 'أُنْس | الأذكار اليومية',
      album: 'القرآن والأذكار',
    });
  }, [track.title]);

  useEffect(() => {
    document.body.classList.toggle('azkar-audio-player-open', isVisible);
    return () => document.body.classList.remove('azkar-audio-player-open');
  }, [isVisible]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setIsLoading(true);
      audio.play().catch(() => {
        setIsLoading(false);
        setStatus('تعذر تشغيل المقطع. حاول مرة أخرى بعد التحقق من الصوت.');
      });
    } else {
      audio.pause();
    }
  };

  const seekTo = (event) => {
    const nextTime = Number(event.target.value);
    if (Number.isFinite(nextTime) && audioRef.current) {
      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const cycleSpeed = () => {
    const nextIndex = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIndex);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[nextIndex];
  };

  const dismiss = () => {
    audioRef.current?.pause();
    setIsVisible(false);
  };

  return (
    <>
      <section
        className="azkar-audio-controller"
        aria-label="مشغل الأذكار الصوتي"
        aria-hidden={!isVisible}
        hidden={!isVisible}
      >
        <div className="azkar-audio-track-info">
          <span className="azkar-audio-track-icon" aria-hidden="true">🎧</span>
          <div>
            <strong>{track.title}</strong>
            <span>{isLoading ? 'جارٍ التحميل…' : status || (isPlaying ? 'قيد التشغيل' : 'متوقف مؤقتاً')}</span>
          </div>
        </div>
        <button
          className="azkar-audio-play"
          type="button"
          onClick={togglePlayback}
          aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل الأذكار'}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <div className="azkar-audio-progress">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.25"
            value={Math.min(currentTime, duration || 0)}
            onChange={seekTo}
            disabled={!duration}
            aria-label="موضع التشغيل"
          />
          <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
        <button className="azkar-audio-speed" type="button" onClick={cycleSpeed} aria-label="تغيير سرعة التشغيل">
          {playbackRate}x
        </button>
        <button className="azkar-audio-close" type="button" onClick={dismiss} aria-label="إغلاق مشغل الأذكار" title="إغلاق">
          ×
        </button>
      </section>
      <audio ref={audioRef} preload="none" playsInline />
    </>
  );
}
