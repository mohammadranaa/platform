import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Jobs from './pages/Jobs'
import JobDetail from './pages/JobDetail'
import Campaigns from './pages/Campaigns'
import Inboxes from './pages/Inboxes'
import EmailInbox from './pages/EmailInbox'
import Templates from './pages/Templates'
import Properties from './pages/Properties'
import Invoices from './pages/Invoices'
import LeadDetail from './pages/LeadDetail'
import ColdInbox from './pages/ColdInbox'
import CalendarView from './pages/CalendarView'
import NuacomDialer from './pages/NuacomDialer'
import './index.css'

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', fontSize: 15, fontFamily: 'Inter, system-ui, sans-serif' }}>
      Loading platform…
    </div>
  )
  return session ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { profile, loading } = useAuth()
  if (loading) return null
  return profile?.role === 'admin' ? children : <Navigate to="/" replace />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="inbox" element={<EmailInbox />} />
            <Route path="templates" element={<Templates />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="documents" element={<Invoices />} />
            <Route path="properties" element={<Properties />} />
            <Route path="cold-inbox" element={<ColdInbox />} />
            <Route path="calendar" element={<CalendarView />} />
            <Route path="calls" element={<NuacomDialer />} />
            <Route path="campaigns" element={<AdminRoute><Campaigns /></AdminRoute>} />
            <Route path="inboxes" element={<AdminRoute><Inboxes /></AdminRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
