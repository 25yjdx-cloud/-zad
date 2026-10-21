import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App.jsx';
import { registerUnsServiceWorker } from './pwa/register.js';
import { AuthProvider } from './contexts/AuthContext.jsx';
import './styles/app.css';

const rootElement = document.querySelector('#root');
if (!rootElement) throw new Error('Application root element was not found.');

createRoot(rootElement).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

registerUnsServiceWorker().catch((error) => {
  console.error('Could not register the Uns service worker:', error);
});
