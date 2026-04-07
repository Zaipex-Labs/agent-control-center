import { BrowserRouter, Routes, Route } from 'react-router-dom';

function TeamsPage() {
  return <div><h1>Agents Command Center</h1><p>Select a project to begin.</p></div>;
}

function ProjectPage() {
  return <div><h1>Project</h1></div>;
}

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
