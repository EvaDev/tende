import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Members from '@/pages/Members';
import Settlement from '@/pages/Settlement';
import PointOfSale from '@/pages/PointOfSale';
import Products from '@/pages/Products';
import Sales from '@/pages/Sales';
import MyBusiness from '@/pages/MyBusiness';
import About from '@/pages/About';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pos"         element={<PointOfSale />} />
        <Route path="products"    element={<Products />} />
        <Route path="sales"       element={<Sales />} />
        <Route path="settlement"  element={<Settlement />} />
        <Route path="members"     element={<Members />} />
        <Route path="my-business" element={<MyBusiness />} />
        <Route path="about"       element={<About />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
