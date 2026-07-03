import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Members from '@/pages/Members';
import Settlement from '@/pages/Settlement';
import PointOfSale from '@/pages/PointOfSale';
import Sales from '@/pages/Sales';
import MyBusiness from '@/pages/MyBusiness';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pos"         element={<PointOfSale />} />
        <Route path="sales"       element={<Sales />} />
        <Route path="settlement"  element={<Settlement />} />
        <Route path="members"     element={<Members />} />
        <Route path="my-business" element={<MyBusiness />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
