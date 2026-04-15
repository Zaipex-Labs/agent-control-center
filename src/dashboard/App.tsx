// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import TeamsPage from './pages/TeamsPage';
import ProjectPage from './pages/ProjectPage';

function HistoryPage() {
  return <div><h1>History</h1></div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TeamsPage />} />
        <Route path="/:projectId" element={<ProjectPage />} />
        <Route path="/:projectId/history" element={<HistoryPage />} />
      </Routes>
    </BrowserRouter>
  );
}
