import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Merchants from '@/pages/Merchants';
import Products from '@/pages/Products';
import Consumers from '@/pages/Consumers';
import Countries from '@/pages/Countries';
import Currencies from '@/pages/Currencies';
import Treasury from '@/pages/Treasury';
import Paymaster from '@/pages/Paymaster';
import SettingsPage from '@/pages/Settings';
import Logs from '@/pages/Logs';
import Registration from '@/pages/Registration';
import Contracts from '@/pages/Contracts';
import Assets from '@/pages/Assets';
import About from '@/pages/About';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="merchants"    element={<Merchants />} />
        <Route path="products"     element={<Products />} />
        <Route path="consumers"    element={<Consumers />} />
        <Route path="countries"    element={<Countries />} />
        <Route path="currencies"   element={<Currencies />} />
        <Route path="treasury"     element={<Treasury />} />
        <Route path="paymaster"    element={<Paymaster />} />
        <Route path="registration" element={<Registration />} />
        <Route path="settings"     element={<SettingsPage />} />
        <Route path="logs"         element={<Logs />} />
        <Route path="contracts"    element={<Contracts />} />
        <Route path="assets"       element={<Assets />} />
        <Route path="about"        element={<About />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
