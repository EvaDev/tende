import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Welcome  from '@/pages/Welcome';
import Login    from '@/pages/Login';
import Register from '@/pages/Register';
import Home     from '@/pages/Home';
import TopUp    from '@/pages/TopUp';
import Send     from '@/pages/Send';
import Pay      from '@/pages/Pay';
import Buy      from '@/pages/Buy';
import Convert  from '@/pages/Convert';
import Claim    from '@/pages/Claim';
import Receive  from '@/pages/Receive';
import History  from '@/pages/History';
import Account  from '@/pages/Account';
import BottomNav from '@/components/BottomNav';
import { isLoggedIn } from '@/lib/auth';

function Protected({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace />;
}

function HomeLayout() {
  return (
    <>
      <Home />
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/"         element={isLoggedIn() ? <Navigate to="/home" replace /> : <Welcome />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/claim/:secret" element={<Claim />} />
        <Route path="/home"     element={<Protected><HomeLayout /></Protected>} />
        <Route path="/top-up"   element={<Protected><TopUp /></Protected>} />
        <Route path="/send"     element={<Protected><Send /></Protected>} />
        <Route path="/pay"      element={<Protected><Pay /></Protected>} />
        <Route path="/buy"      element={<Protected><Buy /></Protected>} />
        <Route path="/convert"  element={<Protected><Convert /></Protected>} />
        <Route path="/receive"    element={<Protected><Receive /></Protected>} />
        <Route path="/history"  element={<Protected><History /></Protected>} />
        <Route path="/account"  element={<Protected><Account /></Protected>} />
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
