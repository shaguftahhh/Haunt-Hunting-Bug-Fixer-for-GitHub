/**
 * Entry point. Mounts <App /> and loads the theme.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
