import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import LegacyMarkup from './LegacyMarkup.jsx';
import Modals from './Modals.jsx';
import QuranReader from './QuranReader.jsx';
import Settings from './Settings.jsx';
import SelfAccountability from './SelfAccountability.jsx';
import PwaInstallPrompt from './PwaInstallPrompt.jsx';
import PeriodicReminder from './PeriodicReminder.jsx';
import AuthEntryPoints from './AuthEntryPoints.jsx';
import AzkarAudioPlayer from './AzkarAudioPlayer.jsx';
import TadabburPage from './TadabburPage.jsx';
import TafsirModal from './TafsirModal.jsx';
import SurahInfoModal from './SurahInfoModal.jsx';
import SpiritualMessageModal from './SpiritualMessageModal.jsx';
import AppSharePrompt from './AppSharePrompt.jsx';
import { initializeUnsDatabase } from '../services/unsDatabase.js';

function MainNavigation() {
  return <LegacyMarkup selector=".main-navigation" />;
}

function OtherSections() {
  return (
    <>
      <LegacyMarkup selector="#azkar-panel" />
      <LegacyMarkup selector="#tasbeeh-panel" />
      <LegacyMarkup selector="#duas-panel" />
      <LegacyMarkup selector="#telegram-panel" />
      <TadabburPage />
      <SelfAccountability />
    </>
  );
}

function MobileNavigation() {
  if (typeof document === 'undefined') return null;
  return createPortal(<LegacyMarkup selector=".mobile-bottom-nav" />, document.body);
}

export default function App() {
  useEffect(() => {
    const refreshLegacyState = (event) => {
      const keys = event.detail?.keys ?? [];
      const legacyKeys = keys.filter((key) => !['zad.selfAccountability.v1', 'zad.worshipTracking.v1'].includes(key));
      if (legacyKeys.length) window.location.reload();
    };
    window.addEventListener('uns:cloud-data-restored', refreshLegacyState);
    return () => window.removeEventListener('uns:cloud-data-restored', refreshLegacyState);
  }, []);

  useEffect(() => {
    let previous = window.scrollY;
    const onScroll = () => {
      const current = window.scrollY;
      const movement = current - previous;
      previous = current;
      if (Math.abs(movement) < 4) return;
      if (movement > 0 && current > 12) {
        document.body.classList.add('app-controls-hidden');
        document.body.classList.remove('app-scroll-up');
      } else if (movement < 0) {
        document.body.classList.remove('app-controls-hidden');
        document.body.classList.add('app-scroll-up');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.body.classList.remove('app-controls-hidden', 'app-scroll-up');
    };
  }, []);

  useEffect(() => {
    // React has rendered the reader shell. Never keep the full-screen splash up
    // while remote app data, profile state, or the Quran search index loads.
    const splash = document.querySelector('#app-splash');
    if (splash) {
      splash.classList.add('is-hidden');
      window.setTimeout(() => splash.remove(), 500);
    }
    void initializeUnsDatabase().catch(() => { /* Quran reading continues with its local-storage fallback. */ });
    import('../legacy/app.js').catch((error) => {
      console.error('Could not initialize Uns application features:', error);
    });
  }, []);

  return (
    <>
      <LegacyMarkup selector="#app-sidebar" />
      <Header />
      <AuthEntryPoints />
      <main className="container app-shell">
        <MainNavigation />
        <LegacyMarkup selector="#load-status" />
        <div className="tab-content">
          <QuranReader />
          <OtherSections />
        </div>
      </main>
      <Footer />
      <Settings />
      <Modals />
      <TafsirModal />
      <SurahInfoModal />
      <MobileNavigation />
      <PwaInstallPrompt />
      <PeriodicReminder />
      <AzkarAudioPlayer />
      <SpiritualMessageModal />
      <AppSharePrompt />
    </>
  );
}
