import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Ops from './pages/Ops.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Onboarding from './pages/Onboarding.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/onboard" element={<Onboarding />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/" element={<Navigate to="/ops" replace />} />
        <Route path="*" element={<Navigate to="/ops" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
