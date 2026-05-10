// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import TeamsPage from './pages/TeamsPage';
import ProjectPage from './pages/ProjectPage';

// [UX-1] /history was a stub ("<h1>History</h1>") that left users on a
// blank page. Until the page exists, route is hidden — direct visitors
// (and any stale bookmark) land on Teams instead.

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TeamsPage />} />
        <Route path="/:projectId" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
