import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BottomNav from './components/BottomNav.jsx';
import HomePage from './pages/HomePage.jsx';
import ScanPage from './pages/ScanPage.jsx';
import ResultsPage from './pages/ResultsPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<><HomePage /><BottomNav /></>} />
        <Route path="/scan" element={<><ScanPage /><BottomNav /></>} />
        <Route path="/history" element={<><HistoryPage /><BottomNav /></>} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
