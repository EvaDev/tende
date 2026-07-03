import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { AdminRoute } from '@/components/AdminRoute';
import Dashboard from '@/pages/Dashboard';
import Merchants from '@/pages/Merchants';
import MerchantProfile from '@/pages/MerchantProfile';
import PointOfSale from '@/pages/PointOfSale';
import MerchantSales from '@/pages/MerchantSales';
import Products from '@/pages/Products';
import Consumers from '@/pages/Consumers';
import Countries from '@/pages/Countries';
import Currencies from '@/pages/Currencies';
import Treasury from '@/pages/Treasury';
import Escrow from '@/pages/Escrow';
import Paymaster from '@/pages/Paymaster';
import SettingsPage from '@/pages/Settings';
import Logs from '@/pages/Logs';
import Registration from '@/pages/Registration';
import Contracts from '@/pages/Contracts';
import Assets from '@/pages/Assets';
import About from '@/pages/About';
import DocsLayout from '@/pages/docs/DocsLayout';
import DocsConcepts from '@/pages/docs/Concepts';
import DocsPayments from '@/pages/docs/Payments';
import DocsGasFees from '@/pages/docs/GasFees';
import DocsMerchant from '@/pages/docs/Merchant';
import DocsContracts from '@/pages/docs/Contracts';
import DocsApi from '@/pages/docs/Api';
import DocsFunctions from '@/pages/docs/Functions';
import DocsEvents from '@/pages/docs/Events';
import ReportsLayout from '@/pages/reports/ReportsLayout';
import ReportsSummary from '@/pages/reports/Summary';
import ReportsRegistrations from '@/pages/reports/Registrations';
import ReportsEvents from '@/pages/reports/Events';
import ReportsTransfers from '@/pages/reports/Transfers';
import ReportsBalances from '@/pages/reports/Balances';
import ReportsSales from '@/pages/reports/Sales';
import ReportsTreasury from '@/pages/reports/Treasury';
import ReportsRevenue from '@/pages/reports/Revenue';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="merchants"    element={<Merchants />} />
        <Route path="my-business"  element={<MerchantProfile />} />
        <Route path="pos"          element={<PointOfSale />} />
        <Route path="sales"        element={<MerchantSales />} />
        <Route path="products"     element={<Products />} />
        <Route path="consumers"    element={<Consumers />} />
        <Route path="countries"    element={<Countries />} />
        <Route path="currencies"   element={<Currencies />} />
        <Route path="treasury"     element={<AdminRoute page="treasury"><Treasury /></AdminRoute>} />
        <Route path="escrow"       element={<AdminRoute page="escrow"><Escrow /></AdminRoute>} />
        <Route path="paymaster"    element={<AdminRoute page="paymaster"><Paymaster /></AdminRoute>} />
        <Route path="registration" element={<AdminRoute page="registration"><Registration /></AdminRoute>} />
        <Route path="settings"     element={<SettingsPage />} />
        <Route path="logs"         element={<Logs />} />
        <Route path="contracts"    element={<Contracts />} />
        <Route path="assets"       element={<Assets />} />
        <Route path="about"        element={<About />} />
        <Route path="docs" element={<DocsLayout />}>
          <Route index element={<Navigate to="concepts" replace />} />
          <Route path="concepts"  element={<DocsConcepts />} />
          <Route path="payments"  element={<DocsPayments />} />
          <Route path="gas-fees"  element={<DocsGasFees />} />
          <Route path="merchant"  element={<DocsMerchant />} />
          <Route path="contracts" element={<DocsContracts />} />
          <Route path="functions" element={<DocsFunctions />} />
          <Route path="events"    element={<DocsEvents />} />
          <Route path="api"       element={<DocsApi />} />
        </Route>
        <Route path="reports" element={<ReportsLayout />}>
          <Route index element={<Navigate to="summary" replace />} />
          <Route path="summary"       element={<ReportsSummary />} />
          <Route path="registrations" element={<ReportsRegistrations />} />
          <Route path="events"        element={<ReportsEvents />} />
          <Route path="transfers" element={<ReportsTransfers />} />
          <Route path="balances"  element={<ReportsBalances />} />
          <Route path="sales"     element={<ReportsSales />} />
          <Route path="treasury"  element={<ReportsTreasury />} />
          <Route path="revenue"   element={<ReportsRevenue />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
