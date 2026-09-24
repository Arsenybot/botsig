import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept benign WebSocket closure errors from Vite HMR in iframe sandboxes
window.addEventListener('unhandledrejection', (event) => {
  const reasonStr = event.reason?.message || event.reason?.toString?.() || '';
  if (
    reasonStr.includes('WebSocket') ||
    reasonStr.includes('websocket') ||
    reasonStr.includes('closed without opened')
  ) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
