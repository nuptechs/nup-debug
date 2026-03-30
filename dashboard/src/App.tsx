import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Sessions from './pages/Sessions';
import SessionDetail from './pages/SessionDetail';
import Traces from './pages/Traces';
import Logs from './pages/Logs';
import Errors from './pages/Errors';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/sessions/:id" element={<SessionDetail />} />
        <Route path="/traces" element={<Traces />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/errors" element={<Errors />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
